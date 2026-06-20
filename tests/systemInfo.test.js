import test from "node:test";
import assert from "node:assert/strict";
import { collectSystemInfo } from "../src/systemInfo.js";
import { collectEnvironmentVariables } from "../src/environment.js";

function createMockOs(platform = "linux") {
  const startCpus = [
    {
      model: "Test CPU",
      times: {
        user: 100,
        nice: 0,
        sys: 100,
        idle: 800,
        irq: 0,
      },
    },
  ];
  const endCpus = [
    {
      model: "Test CPU",
      times: {
        user: 150,
        nice: 0,
        sys: 150,
        idle: 900,
        irq: 0,
      },
    },
  ];
  let cpuCallCount = 0;

  return {
    type: () => "TestOS",
    release: () => "1.0",
    version: () => "Test Version",
    arch: () => "x64",
    cpus: () => (cpuCallCount++ === 0 ? startCpus : endCpus),
    hostname: () => "test-host",
    platform: () => platform,
    homedir: () => "/home/test",
    totalmem: () => 1000,
    freemem: () => 250,
    loadavg: () => [1.234, 2.345, 3.456],
    networkInterfaces: () => ({
      lo: [
        {
          address: "127.0.0.1",
          family: "IPv4",
          internal: true,
          mac: "00:00:00:00:00:00",
        },
      ],
      eth0: [
        {
          address: "192.0.2.10",
          family: "IPv6",
          internal: false,
          mac: "11:22:33:44:55:66",
        },
      ],
    }),
    uptime: () => 3660,
  };
}

test("collectSystemInfo returns richer system dashboard details", async () => {
  const sampleDelays = [];
  const info = await collectSystemInfo({
    osModule: createMockOs(),
    wait: async (milliseconds) => {
      sampleDelays.push(milliseconds);
    },
  });

  assert.equal(typeof info.operatingSystem.type, "string");
  assert.equal(typeof info.cpu.architecture, "string");
  assert.equal(info.cpu.model, "Test CPU");
  assert.equal(info.cpu.logicalCores, 1);
  assert.equal(info.cpu.usagePercent, 50);
  assert.equal(typeof info.machine.hostname, "string");
  assert.equal(typeof info.machine.platform, "string");
  assert.equal(typeof info.machine.homeDirectory, "string");
  assert.match(info.runtime.nodeVersion, /^v\d+/);
  assert.deepEqual(sampleDelays, [200]);
  assert.deepEqual(info.memory, {
    totalBytes: 1000,
    freeBytes: 250,
    usedBytes: 750,
    usagePercent: 75,
  });
  assert.deepEqual(info.loadAverages, {
    oneMinute: 1.23,
    fiveMinute: 2.35,
    fifteenMinute: 3.46,
    supported: true,
    note: null,
  });
  assert.deepEqual(info.network.interfaces, [
    {
      name: "lo",
      family: "IPv4",
      internal: true,
    },
    {
      name: "eth0",
      family: "IPv6",
      internal: false,
    },
  ]);
  assert.equal(Object.hasOwn(info.network.interfaces[0], "mac"), false);
});

test("collectSystemInfo marks Windows load averages as unsupported", async () => {
  const info = await collectSystemInfo({
    osModule: createMockOs("win32"),
    wait: async () => {},
  });

  assert.equal(info.loadAverages.oneMinute, "Unavailable");
  assert.equal(info.loadAverages.fiveMinute, "Unavailable");
  assert.equal(info.loadAverages.fifteenMinute, "Unavailable");
  assert.equal(info.loadAverages.supported, false);
  assert.equal(
    info.loadAverages.note,
    "Load averages are not supported on Windows.",
  );
});

test("environment collection uses a safe allowlist", () => {
  const environment = collectEnvironmentVariables();

  assert.equal(Object.hasOwn(environment, "OS"), true);
  assert.equal(Object.hasOwn(environment, "PATH"), false);
  assert.equal(Object.hasOwn(environment, "API_KEY"), false);
  assert.equal(Object.hasOwn(environment, "PASSWORD"), false);
});
