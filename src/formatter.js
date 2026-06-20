function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Unavailable";

  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes.toFixed(2)} GiB`;
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

export function formatReport(report, format = "text") {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format !== "text") {
    throw new Error(`Unsupported output format: ${format}`);
  }

  const { system, environment } = report;

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
    ]),
    createSection("Machine", [
      ["Hostname", system.machine.hostname],
      ["Platform", system.machine.platform],
      ["Home directory", system.machine.homeDirectory],
      ["Node.js version", system.runtime.nodeVersion],
      ["Total memory", formatBytes(system.memory.totalBytes)],
      ["Free memory", formatBytes(system.memory.freeBytes)],
      ["System uptime", formatDuration(system.uptimeSeconds)],
    ]),
    createSection(
      "Selected Environment Variables",
      Object.entries(environment),
    ),
  ].join("\n");
}