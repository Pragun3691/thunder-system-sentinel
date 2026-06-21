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

function formatValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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

function formatReportSections(report) {
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
  ];
}

export function formatReport(report, format = "text") {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format !== "text") {
    throw new Error(`Unsupported output format: ${format}`);
  }

  return ["SYSTEM SENTINEL REPORT", ...formatReportSections(report)].join("\n");
}

export function formatSnapshot(snapshot, format = "text") {
  if (format === "json") {
    return JSON.stringify(snapshot, null, 2);
  }

  if (format !== "text") {
    throw new Error(`Unsupported output format: ${format}`);
  }

  return [
    "SNAPSHOT REPORT",
    `Name: ${snapshot.name}`,
    `Schema version: ${snapshot.schemaVersion}`,
    ...formatReportSections(snapshot),
  ].join("\n");
}

export function formatSnapshotList(snapshots, format = "text") {
  if (format === "json") {
    return JSON.stringify(snapshots, null, 2);
  }

  if (format !== "text") {
    throw new Error(`Unsupported output format: ${format}`);
  }

  if (snapshots.length === 0) {
    return "No snapshots found.";
  }

  const headers = ["Name", "Created at", "Platform", "Health"];
  const rows = snapshots.map((snapshot) => [
    snapshot.name,
    snapshot.createdAt,
    snapshot.platform,
    snapshot.health,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const formatRow = (row) =>
    row.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ");

  return [
    "SNAPSHOTS",
    "---------",
    formatRow(headers),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map(formatRow),
  ].join("\n");
}

function formatSnapshotChange(change) {
  if (change.type === "added") {
    return `- ADDED ${change.path}: ${formatValue(change.after)}`;
  }

  if (change.type === "removed") {
    return `- REMOVED ${change.path}: ${formatValue(change.before)}`;
  }

  return `- CHANGED ${change.path}: ${formatValue(change.before)} -> ${formatValue(change.after)}`;
}

export function formatSnapshotComparison(comparison, format = "text") {
  if (format === "json") {
    return JSON.stringify(comparison, null, 2);
  }

  if (format !== "text") {
    throw new Error(`Unsupported output format: ${format}`);
  }

  if (comparison.changes.length === 0) {
    return `No differences found between ${comparison.firstName} and ${comparison.secondName}.`;
  }

  const sections = [
    ["Added Values", comparison.changes.filter((change) => change.type === "added")],
    ["Removed Values", comparison.changes.filter((change) => change.type === "removed")],
    ["Changed Values", comparison.changes.filter((change) => change.type === "changed")],
  ]
    .filter(([, changes]) => changes.length > 0)
    .map(([title, changes]) =>
      [`\n${title}`, "-".repeat(title.length), ...changes.map(formatSnapshotChange)].join("\n"),
    );

  return [
    `SNAPSHOT COMPARISON: ${comparison.firstName} -> ${comparison.secondName}`,
    ...sections,
  ].join("\n");
}

export function formatIntegrityBaseline(baseline, format = "text") {
  if (format === "json") {
    return JSON.stringify(baseline, null, 2);
  }

  if (format !== "text") {
    throw new Error(`Unsupported output format: ${format}`);
  }

  return [
    "INTEGRITY BASELINE SAVED",
    `Algorithm: ${baseline.algorithm}`,
    `Files fingerprinted: ${baseline.fileCount}`,
    `Generated at: ${baseline.generatedAt}`,
  ].join("\n");
}

function formatIntegritySection(title, rows) {
  if (rows.length === 0) {
    return null;
  }

  return [`\n${title}`, "-".repeat(title.length), ...rows].join("\n");
}

export function formatIntegrityReport(report, format = "text") {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format !== "text") {
    throw new Error(`Unsupported output format: ${format}`);
  }

  const lines = [
    "INTEGRITY CHECK",
    `Baseline from: ${report.baselineGeneratedAt}`,
    `Summary: ${report.summary.unchanged} unchanged, ${report.summary.modified} modified, ${report.summary.added} added, ${report.summary.removed} removed`,
  ];

  const sections = [
    formatIntegritySection(
      "Modified",
      report.modified.map((change) => `~ ${change.path}`),
    ),
    formatIntegritySection(
      "Added",
      report.added.map((change) => `+ ${change.path}`),
    ),
    formatIntegritySection(
      "Removed",
      report.removed.map((change) => `- ${change.path}`),
    ),
  ].filter((section) => section !== null);

  for (const section of sections) {
    lines.push(section);
  }

  if (!report.hasDrift) {
    lines.push("\nNo changes detected. All files match the baseline.");
  }

  return lines.join("\n");
}
