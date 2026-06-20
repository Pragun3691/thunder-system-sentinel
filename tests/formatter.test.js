import test from "node:test";
import assert from "node:assert/strict";
import { formatReport } from "../src/formatter.js";

const report = {
  generatedAt: "2026-06-20T00:00:00.000Z",
  system: {
    operatingSystem: {
      type: "TestOS",
      release: "1.0",
      version: "Test Version",
    },
    cpu: {
      architecture: "x64",
      model: "Test CPU",
      logicalCores: 4,
      usagePercent: 42.5,
    },
    machine: {
      hostname: "test-machine",
      platform: "test",
      homeDirectory: "/home/test",
    },
    runtime: {
      nodeVersion: "v22.0.0",
    },
    memory: {
      totalBytes: 8 * 1024 ** 3,
      freeBytes: 4 * 1024 ** 3,
      usedBytes: 4 * 1024 ** 3,
      usagePercent: 50,
    },
    loadAverages: {
      oneMinute: 1.23,
      fiveMinute: 2.34,
      fifteenMinute: 3.45,
      supported: true,
      note: null,
    },
    network: {
      interfaces: [
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
      ],
    },
    uptimeSeconds: 3660,
  },
  health: {
    overallStatus: "warning",
    cpu: {
      status: "healthy",
      usagePercent: 42.5,
    },
    memory: {
      status: "warning",
      usagePercent: 75,
    },
    warnings: [
      "Memory usage is 75.00%, at or above the warning threshold of 75%.",
    ],
  },
  environment: {
    NODE_ENV: "test",
  },
};

test("formats a readable text report", () => {
  const output = formatReport(report, "text");

  assert.match(output, /SYSTEM SENTINEL REPORT/);
  assert.match(output, /TestOS/);
  assert.match(output, /CPU usage\s+: 42.50%/);
  assert.match(output, /8.00 GiB/);
  assert.match(output, /Used memory\s+: 4.00 GiB/);
  assert.match(output, /Memory usage\s+: 50.00%/);
  assert.match(output, /Load Averages/);
  assert.match(output, /1 minute\s+: 1.23/);
  assert.match(output, /Network Summary/);
  assert.match(output, /- lo \| IPv4 \| internal/);
  assert.match(output, /- eth0 \| IPv6 \| external/);
  assert.doesNotMatch(output, /(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/);
  assert.match(output, /Health Status/);
  assert.match(output, /Overall\s+: WARNING/);
  assert.match(output, /Memory\s+: WARNING \(75.00%\)/);
  assert.match(output, /Health Warnings/);
  assert.match(output, /Memory usage is 75.00%/);
  assert.match(output, /0d 1h 1m/);
});

test("formats a valid JSON report", () => {
  const output = formatReport(report, "json");
  assert.deepEqual(JSON.parse(output), report);
});

test("rejects an unsupported output format", () => {
  assert.throws(
    () => formatReport(report, "xml"),
    /Unsupported output format/,
  );
});
