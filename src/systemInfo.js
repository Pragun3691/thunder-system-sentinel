import os from "node:os";

const CPU_SAMPLE_INTERVAL_MS = 200;
const UNAVAILABLE = "Unavailable";

const fallback = (value) =>
  typeof value === "string" ? value.trim() || UNAVAILABLE : value || UNAVAILABLE;

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function safeCpus(osModule) {
  try {
    const cpus = osModule.cpus();
    return Array.isArray(cpus) ? cpus : [];
  } catch {
    return [];
  }
}

function safeLoadAverages(osModule) {
  try {
    const loadAverages = osModule.loadavg();
    return Array.isArray(loadAverages) ? loadAverages : [];
  } catch {
    return [];
  }
}

function safeNetworkInterfaces(osModule) {
  try {
    const interfaces = osModule.networkInterfaces();
    return interfaces && typeof interfaces === "object" ? interfaces : {};
  } catch {
    return {};
  }
}

function sumCpuTimes(times = {}) {
  return Object.values(times).reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  );
}

export function calculateCpuUsagePercent(startCpus = [], endCpus = []) {
  const sampleSize = Math.min(startCpus.length, endCpus.length);

  if (sampleSize === 0) {
    return UNAVAILABLE;
  }

  let totalDelta = 0;
  let idleDelta = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const startTimes = startCpus[index]?.times;
    const endTimes = endCpus[index]?.times;

    if (!startTimes || !endTimes) {
      continue;
    }

    const currentTotalDelta = sumCpuTimes(endTimes) - sumCpuTimes(startTimes);
    const currentIdleDelta = (endTimes.idle ?? 0) - (startTimes.idle ?? 0);

    if (currentTotalDelta > 0 && currentIdleDelta >= 0) {
      totalDelta += currentTotalDelta;
      idleDelta += currentIdleDelta;
    }
  }

  if (totalDelta <= 0) {
    return UNAVAILABLE;
  }

  const busyDelta = Math.max(0, totalDelta - idleDelta);
  return roundToTwo(Math.min(100, (busyDelta / totalDelta) * 100));
}

function collectMemoryInfo(osModule) {
  const totalBytes = osModule.totalmem();
  const freeBytes = osModule.freemem();

  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) {
    return {
      totalBytes: fallback(totalBytes),
      freeBytes: fallback(freeBytes),
      usedBytes: UNAVAILABLE,
      usagePercent: UNAVAILABLE,
    };
  }

  const usedBytes = Math.max(0, totalBytes - freeBytes);

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: roundToTwo(Math.min(100, (usedBytes / totalBytes) * 100)),
  };
}

function collectLoadAverages(osModule, platform) {
  const supported = platform !== "win32";

  if (!supported) {
    return {
      oneMinute: UNAVAILABLE,
      fiveMinute: UNAVAILABLE,
      fifteenMinute: UNAVAILABLE,
      supported,
      note: "Load averages are not supported on Windows.",
    };
  }

  const [oneMinute, fiveMinute, fifteenMinute] = safeLoadAverages(osModule);
  const valueOrUnavailable = (value) =>
    Number.isFinite(value) ? roundToTwo(value) : UNAVAILABLE;

  return {
    oneMinute: valueOrUnavailable(oneMinute),
    fiveMinute: valueOrUnavailable(fiveMinute),
    fifteenMinute: valueOrUnavailable(fifteenMinute),
    supported,
    note: null,
  };
}

function normalizeAddressFamily(family) {
  if (family === 4 || family === "IPv4") return "IPv4";
  if (family === 6 || family === "IPv6") return "IPv6";
  return fallback(family);
}

function collectNetworkSummary(osModule) {
  const interfaces = safeNetworkInterfaces(osModule);

  return {
    interfaces: Object.entries(interfaces).flatMap(([name, addresses]) =>
      (Array.isArray(addresses) ? addresses : []).map((address) => ({
        name: fallback(name),
        family: normalizeAddressFamily(address?.family),
        internal:
          typeof address?.internal === "boolean" ? address.internal : UNAVAILABLE,
      })),
    ),
  };
}

export async function collectSystemInfo({
  osModule = os,
  sampleDelayMs = CPU_SAMPLE_INTERVAL_MS,
  wait = sleep,
} = {}) {
  const startCpus = safeCpus(osModule);
  await wait(sampleDelayMs);
  const endCpus = safeCpus(osModule);
  const platform = fallback(osModule.platform());

  return {
    operatingSystem: {
      type: fallback(osModule.type()),
      release: fallback(osModule.release()),
      version: fallback(osModule.version()),
    },
    cpu: {
      architecture: fallback(osModule.arch()),
      model: fallback(endCpus[0]?.model ?? startCpus[0]?.model),
      logicalCores: endCpus.length || startCpus.length || UNAVAILABLE,
      usagePercent: calculateCpuUsagePercent(startCpus, endCpus),
    },
    machine: {
      hostname: fallback(osModule.hostname()),
      platform,
      homeDirectory: fallback(osModule.homedir()),
    },
    runtime: {
      nodeVersion: fallback(process.version),
    },
    memory: collectMemoryInfo(osModule),
    loadAverages: collectLoadAverages(osModule, platform),
    network: collectNetworkSummary(osModule),
    uptimeSeconds: Math.floor(osModule.uptime()),
  };
}
