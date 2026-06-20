import os from "node:os";

const fallback = (value) =>
  typeof value === "string" ? value.trim() || "Unavailable" : value || "Unavailable";

export function collectSystemInfo() {
  const cpus = os.cpus();

  return {
    operatingSystem: {
      type: fallback(os.type()),
      release: fallback(os.release()),
      version: fallback(os.version()),
    },
    cpu: {
      architecture: fallback(os.arch()),
      model: fallback(cpus[0]?.model),
      logicalCores: cpus.length || "Unavailable",
    },
    machine: {
      hostname: fallback(os.hostname()),
      platform: fallback(os.platform()),
      homeDirectory: fallback(os.homedir()),
    },
    runtime: {
      nodeVersion: fallback(process.version),
    },
    memory: {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
    },
    uptimeSeconds: Math.floor(os.uptime()),
  };
}