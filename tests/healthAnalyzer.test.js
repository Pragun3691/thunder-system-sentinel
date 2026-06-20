import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHealth } from "../src/healthAnalyzer.js";

test("analyzeHealth reports healthy when CPU and memory are below thresholds", () => {
  const health = analyzeHealth({
    cpu: {
      usagePercent: 40,
    },
    memory: {
      usagePercent: 60,
    },
  });

  assert.deepEqual(health, {
    overallStatus: "healthy",
    cpu: {
      status: "healthy",
      usagePercent: 40,
    },
    memory: {
      status: "healthy",
      usagePercent: 60,
    },
    warnings: [],
  });
});

test("analyzeHealth reports warning when CPU reaches the warning threshold", () => {
  const health = analyzeHealth({
    cpu: {
      usagePercent: 75,
    },
    memory: {
      usagePercent: 60,
    },
  });

  assert.equal(health.overallStatus, "warning");
  assert.deepEqual(health.cpu, {
    status: "warning",
    usagePercent: 75,
  });
  assert.deepEqual(health.memory, {
    status: "healthy",
    usagePercent: 60,
  });
  assert.deepEqual(health.warnings, [
    "CPU usage is 75.00%, at or above the warning threshold of 75%.",
  ]);
});

test("analyzeHealth reports critical when memory reaches the critical threshold", () => {
  const health = analyzeHealth({
    cpu: {
      usagePercent: 40,
    },
    memory: {
      usagePercent: 90,
    },
  });

  assert.equal(health.overallStatus, "critical");
  assert.deepEqual(health.cpu, {
    status: "healthy",
    usagePercent: 40,
  });
  assert.deepEqual(health.memory, {
    status: "critical",
    usagePercent: 90,
  });
  assert.deepEqual(health.warnings, [
    "Memory usage is 90.00%, at or above the critical threshold of 90%.",
  ]);
});

test("analyzeHealth reports unknown when both metrics are unavailable", () => {
  const health = analyzeHealth({
    cpu: {
      usagePercent: "Unavailable",
    },
    memory: {},
  });

  assert.deepEqual(health, {
    overallStatus: "unknown",
    cpu: {
      status: "unknown",
      usagePercent: "Unavailable",
    },
    memory: {
      status: "unknown",
      usagePercent: "Unavailable",
    },
    warnings: [],
  });
});

test("analyzeHealth reports unknown when one metric is healthy and one is unavailable", () => {
  const health = analyzeHealth({
    cpu: {
      usagePercent: 35,
    },
    memory: {
      usagePercent: "Unavailable",
    },
  });

  assert.deepEqual(health, {
    overallStatus: "unknown",
    cpu: {
      status: "healthy",
      usagePercent: 35,
    },
    memory: {
      status: "unknown",
      usagePercent: "Unavailable",
    },
    warnings: [],
  });
});

test("analyzeHealth reports unknown for out-of-range usage percentages", () => {
  const health = analyzeHealth({
    cpu: {
      usagePercent: -0.01,
    },
    memory: {
      usagePercent: 100.01,
    },
  });

  assert.deepEqual(health, {
    overallStatus: "unknown",
    cpu: {
      status: "unknown",
      usagePercent: "Unavailable",
    },
    memory: {
      status: "unknown",
      usagePercent: "Unavailable",
    },
    warnings: [],
  });
});
