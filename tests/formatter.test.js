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
    },
    uptimeSeconds: 3660,
  },
  environment: {
    NODE_ENV: "test",
  },
};

test("formats a readable text report", () => {
  const output = formatReport(report, "text");

  assert.match(output, /SYSTEM SENTINEL REPORT/);
  assert.match(output, /TestOS/);
  assert.match(output, /8.00 GiB/);
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