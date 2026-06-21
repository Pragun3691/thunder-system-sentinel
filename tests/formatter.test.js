import test from "node:test";
import assert from "node:assert/strict";
import {
  formatIntegrityBaseline,
  formatIntegrityReport,
  formatReport,
  formatSnapshot,
  formatSnapshotComparison,
  formatSnapshotList,
} from "../src/formatter.js";

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

test("formats snapshot show output as text and JSON", () => {
  const snapshot = {
    schemaVersion: 1,
    name: "daily",
    ...report,
  };

  const textOutput = formatSnapshot(snapshot, "text");
  assert.match(textOutput, /SNAPSHOT REPORT/);
  assert.match(textOutput, /Name: daily/);
  assert.match(textOutput, /Schema version: 1/);
  assert.match(textOutput, /SYSTEM SENTINEL REPORT/);

  assert.deepEqual(JSON.parse(formatSnapshot(snapshot, "json")), snapshot);
});

test("formats snapshot lists", () => {
  const snapshots = [
    {
      name: "daily",
      createdAt: "2026-06-20T00:00:00.000Z",
      platform: "linux",
      health: "healthy",
    },
  ];

  const textOutput = formatSnapshotList(snapshots, "text");
  assert.match(textOutput, /SNAPSHOTS/);
  assert.match(textOutput, /daily/);
  assert.match(textOutput, /Created at/);

  assert.equal(formatSnapshotList([], "text"), "No snapshots found.");
  assert.deepEqual(JSON.parse(formatSnapshotList(snapshots, "json")), snapshots);
});

test("formats snapshot comparison output", () => {
  const comparison = {
    firstName: "before",
    secondName: "after",
    changes: [
      {
        type: "added",
        path: "environment.NEW_ONLY",
        before: null,
        after: "after",
      },
      {
        type: "removed",
        path: "environment.OLD_ONLY",
        before: "before",
        after: null,
      },
      {
        type: "changed",
        path: "system.cpu.usagePercent",
        before: 25,
        after: 50,
      },
    ],
  };

  const textOutput = formatSnapshotComparison(comparison, "text");
  assert.match(textOutput, /SNAPSHOT COMPARISON: before -> after/);
  assert.match(textOutput, /Added Values/);
  assert.match(textOutput, /ADDED environment.NEW_ONLY/);
  assert.match(textOutput, /Removed Values/);
  assert.match(textOutput, /REMOVED environment.OLD_ONLY/);
  assert.match(textOutput, /Changed Values/);
  assert.match(textOutput, /CHANGED system.cpu.usagePercent: 25 -> 50/);

  assert.deepEqual(JSON.parse(formatSnapshotComparison(comparison, "json")), comparison);
});

test("formats no-difference snapshot comparisons clearly", () => {
  assert.equal(
    formatSnapshotComparison(
      {
        firstName: "first",
        secondName: "second",
        changes: [],
      },
      "text",
    ),
    "No differences found between first and second.",
  );
});

test("formats an integrity baseline summary", () => {
  const baseline = {
    schemaVersion: 1,
    algorithm: "sha256",
    generatedAt: "2026-06-20T00:00:00.000Z",
    fileCount: 2,
    files: {},
  };

  const text = formatIntegrityBaseline(baseline, "text");
  assert.match(text, /INTEGRITY BASELINE SAVED/);
  assert.match(text, /Algorithm: sha256/);
  assert.match(text, /Files fingerprinted: 2/);

  assert.deepEqual(JSON.parse(formatIntegrityBaseline(baseline, "json")), baseline);
});

test("formats an integrity check report with drift", () => {
  const report = {
    baselineGeneratedAt: "2026-06-20T00:00:00.000Z",
    algorithm: "sha256",
    summary: { added: 1, removed: 1, modified: 1, unchanged: 2 },
    added: [{ path: "new.txt", sha256: "a".repeat(64) }],
    removed: [{ path: "old.txt", sha256: "b".repeat(64) }],
    modified: [{ path: "a.txt", before: "c".repeat(64), after: "d".repeat(64) }],
    unchanged: [{ path: "keep1.txt" }, { path: "keep2.txt" }],
    hasDrift: true,
  };

  const text = formatIntegrityReport(report, "text");
  assert.match(text, /INTEGRITY CHECK/);
  assert.match(text, /2 unchanged, 1 modified, 1 added, 1 removed/);
  assert.match(text, /~ a\.txt/);
  assert.match(text, /\+ new\.txt/);
  assert.match(text, /- old\.txt/);

  assert.deepEqual(JSON.parse(formatIntegrityReport(report, "json")), report);
});

test("formats a clean integrity check report", () => {
  const report = {
    baselineGeneratedAt: "2026-06-20T00:00:00.000Z",
    algorithm: "sha256",
    summary: { added: 0, removed: 0, modified: 0, unchanged: 3 },
    added: [],
    removed: [],
    modified: [],
    unchanged: [{ path: "a.txt" }, { path: "b.txt" }, { path: "c.txt" }],
    hasDrift: false,
  };

  const text = formatIntegrityReport(report, "text");
  assert.match(text, /No changes detected/);
});
