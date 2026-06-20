function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Unavailable";

  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes.toFixed(2)} GiB`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  return `${value.toFixed(2)}%`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  return value.toFixed(2);
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return "Unavailable";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

function createSection(title, entries) {
  const labelWidth = Math.max(...entries.map(([label]) => label.length));

  const rows = entries.map(
    ([label, value]) => `${label.padEnd(labelWidth)} : ${value}`,
  );

  return [`\n${title}`, "-".repeat(title.length), ...rows].join("\n");
}

function createListSection(title, rows, emptyMessage = "Unavailable") {
  return [
    `\n${title}`,
    "-".repeat(title.length),
    ...(rows.length ? rows : [emptyMessage]),
  ].join("\n");
}

function formatBoolean(value, trueLabel, falseLabel) {
  if (value === true) return trueLabel;
  if (value === false) return falseLabel;
  return "Unavailable";
}

function formatStatus(status) {
  return typeof status === "string" ? status.toUpperCase() : "Unavailable";
}

function formatHealthMetric(metric) {
  return `${formatStatus(metric?.status)} (${formatPercent(metric?.usagePercent)})`;
}

function formatNetworkInterfaces(network) {
  return (network?.interfaces ?? []).map((networkInterface) => {
    const internalStatus = formatBoolean(
      networkInterface.internal,
      "internal",
      "external",
    );

    return `- ${networkInterface.name} | ${networkInterface.family} | ${internalStatus}`;
  });
}

export function formatReport(report, format = "text") {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format !== "text") {
    throw new Error(`Unsupported output format: ${format}`);
  }

  const { system, health, environment } = report;
  const loadAverageEntries = [
    [
      "Supported",
      formatBoolean(system.loadAverages?.supported, "Yes", "No"),
    ],
    ["1 minute", formatNumber(system.loadAverages?.oneMinute)],
    ["5 minutes", formatNumber(system.loadAverages?.fiveMinute)],
    ["15 minutes", formatNumber(system.loadAverages?.fifteenMinute)],
  ];

  if (system.loadAverages?.note) {
    loadAverageEntries.push(["Note", system.loadAverages.note]);
  }

  return [
    "SYSTEM SENTINEL REPORT",
    `Generated at: ${report.generatedAt}`,
    createSection("Operating System", [
      ["Type", system.operatingSystem.type],
      ["Release", system.operatingSystem.release],
      ["Version", system.operatingSystem.version],
    ]),
    createSection("CPU", [
      ["Architecture", system.cpu.architecture],
      ["Model", system.cpu.model],
      ["Logical cores", system.cpu.logicalCores],
      ["CPU usage", formatPercent(system.cpu.usagePercent)],
    ]),
    createSection("Memory", [
      ["Total memory", formatBytes(system.memory.totalBytes)],
      ["Free memory", formatBytes(system.memory.freeBytes)],
      ["Used memory", formatBytes(system.memory.usedBytes)],
      ["Memory usage", formatPercent(system.memory.usagePercent)],
    ]),
    createSection("Load Averages", loadAverageEntries),
    createListSection(
      "Network Summary",
      formatNetworkInterfaces(system.network),
      "No network interfaces found.",
    ),
    createSection("Health Status", [
      ["Overall", formatStatus(health?.overallStatus)],
      ["CPU", formatHealthMetric(health?.cpu)],
      ["Memory", formatHealthMetric(health?.memory)],
    ]),
    createListSection(
      "Health Warnings",
      (health?.warnings ?? []).map((warning) => `- ${warning}`),
      "- None",
    ),
    createSection("Machine", [
      ["Hostname", system.machine.hostname],
      ["Platform", system.machine.platform],
      ["Home directory", system.machine.homeDirectory],
      ["Node.js version", system.runtime.nodeVersion],
      ["System uptime", formatDuration(system.uptimeSeconds)],
    ]),
    createSection(
      "Selected Environment Variables",
      Object.entries(environment),
    ),
  ].join("\n");
}
