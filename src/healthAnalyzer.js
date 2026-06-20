const WARNING_THRESHOLD = 75;
const CRITICAL_THRESHOLD = 90;
const UNAVAILABLE = "Unavailable";

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function evaluateUsage(metricName, usagePercent) {
  if (!Number.isFinite(usagePercent)) {
    return {
      status: "unknown",
      usagePercent: UNAVAILABLE,
    };
  }

  if (usagePercent < 0 || usagePercent > 100) {
    return {
      status: "unknown",
      usagePercent: UNAVAILABLE,
    };
  }

  const roundedUsage = roundToTwo(usagePercent);

  if (roundedUsage >= CRITICAL_THRESHOLD) {
    return {
      status: "critical",
      usagePercent: roundedUsage,
      reason: `${metricName} usage is ${roundedUsage.toFixed(2)}%, at or above the critical threshold of ${CRITICAL_THRESHOLD}%.`,
    };
  }

  if (roundedUsage >= WARNING_THRESHOLD) {
    return {
      status: "warning",
      usagePercent: roundedUsage,
      reason: `${metricName} usage is ${roundedUsage.toFixed(2)}%, at or above the warning threshold of ${WARNING_THRESHOLD}%.`,
    };
  }

  return {
    status: "healthy",
    usagePercent: roundedUsage,
  };
}

function selectOverallStatus(statuses) {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  if (statuses.includes("unknown")) return "unknown";
  return "healthy";
}

function publicMetric(metric) {
  return {
    status: metric.status,
    usagePercent: metric.usagePercent,
  };
}

export function analyzeHealth(systemInfo = {}) {
  const cpu = evaluateUsage("CPU", systemInfo.cpu?.usagePercent);
  const memory = evaluateUsage("Memory", systemInfo.memory?.usagePercent);

  return {
    overallStatus: selectOverallStatus([cpu.status, memory.status]),
    cpu: publicMetric(cpu),
    memory: publicMetric(memory),
    warnings: [cpu.reason, memory.reason].filter(Boolean),
  };
}
