import {
  access,
  link,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const SNAPSHOT_SCHEMA_VERSION = 1;

const SNAPSHOT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SNAPSHOT_DIRECTORY = path.resolve(
  currentDirectory,
  "../.sentinel/snapshots",
);
const MISSING = Symbol("missing");

function snapshotError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.isSnapshotError = true;
  return error;
}

export function validateSnapshotName(name) {
  if (typeof name !== "string" || !SNAPSHOT_NAME_PATTERN.test(name)) {
    throw snapshotError(
      "Invalid snapshot name. Use 1-64 letters, numbers, hyphens, or underscores.",
      "EINVAL",
    );
  }

  return name;
}

function resolveSnapshotDirectory({ storageDirectory } = {}) {
  return path.resolve(storageDirectory ?? DEFAULT_SNAPSHOT_DIRECTORY);
}

function resolveSnapshotPath(name, options) {
  const safeName = validateSnapshotName(name);
  const snapshotDirectory = resolveSnapshotDirectory(options);
  const snapshotPath = path.resolve(snapshotDirectory, `${safeName}.json`);

  if (
    snapshotPath !== snapshotDirectory &&
    !snapshotPath.startsWith(`${snapshotDirectory}${path.sep}`)
  ) {
    throw snapshotError("Snapshot path must remain inside the snapshot directory.", "EINVAL");
  }

  return {
    name: safeName,
    snapshotDirectory,
    snapshotPath,
  };
}

function validateReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw snapshotError("A system report object is required.", "EINVAL");
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidIsoDateString(value) {
  const match = typeof value === "string" && ISO_DATE_TIME_PATTERN.exec(value);

  if (!match || Number.isNaN(Date.parse(value))) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function invalidSnapshot(name, detail) {
  return snapshotError(`Snapshot is corrupt: ${name}. ${detail}`, "EINVALIDSNAPSHOT");
}

export function createSnapshotDocument(name, report) {
  const safeName = validateSnapshotName(name);
  validateReport(report);

  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    name: safeName,
    generatedAt: report.generatedAt,
    system: report.system,
    health: report.health,
    environment: report.environment,
  };

  validateSnapshotDocument(snapshot, safeName);
  return snapshot;
}

function validateSnapshotDocument(snapshot, name) {
  if (!isPlainObject(snapshot)) {
    throw invalidSnapshot(name, "Document must be a non-null plain object.");
  }

  if (
    !Object.hasOwn(snapshot, "schemaVersion") ||
    !Number.isInteger(snapshot.schemaVersion)
  ) {
    throw invalidSnapshot(name, "schemaVersion is missing or invalid.");
  }

  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw snapshotError(
      `Unsupported snapshot schema version for ${name}: ${snapshot.schemaVersion ?? "missing"}.`,
      "EUNSUPPORTEDSCHEMA",
    );
  }

  if (
    !Object.hasOwn(snapshot, "name") ||
    typeof snapshot.name !== "string" ||
    !SNAPSHOT_NAME_PATTERN.test(snapshot.name)
  ) {
    throw invalidSnapshot(name, "Embedded snapshot name is missing or invalid.");
  }

  if (snapshot.name !== name) {
    throw invalidSnapshot(
      name,
      `Embedded snapshot name ${JSON.stringify(snapshot.name)} does not match requested name ${JSON.stringify(name)}.`,
    );
  }

  if (!isValidIsoDateString(snapshot.generatedAt)) {
    throw invalidSnapshot(
      name,
      "generatedAt must be a valid non-empty ISO date string.",
    );
  }

  for (const field of ["system", "health", "environment"]) {
    if (!isPlainObject(snapshot[field])) {
      throw invalidSnapshot(name, `${field} must be a non-null plain object.`);
    }
  }
}

function createSnapshotSummary(name, snapshot) {
  return {
    name,
    createdAt: snapshot.generatedAt,
    platform: snapshot.system?.machine?.platform ?? "Unavailable",
    health: snapshot.health?.overallStatus ?? "Unavailable",
  };
}

async function assertSnapshotDoesNotExist(snapshotPath, name) {
  try {
    await access(snapshotPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  throw snapshotError(`Snapshot already exists: ${name}.`, "EEXIST");
}

export async function saveSnapshot(name, report, options = {}) {
  const {
    name: safeName,
    snapshotDirectory,
    snapshotPath,
  } = resolveSnapshotPath(name, options);
  const snapshot = createSnapshotDocument(safeName, report);
  const temporaryPath = path.join(
    snapshotDirectory,
    `.${safeName}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  await mkdir(snapshotDirectory, { recursive: true });
  await assertSnapshotDoesNotExist(snapshotPath, safeName);

  try {
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await link(temporaryPath, snapshotPath);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw snapshotError(`Snapshot already exists: ${safeName}.`, "EEXIST");
    }

    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }

  return snapshot;
}

export async function loadSnapshot(name, options = {}) {
  const { name: safeName, snapshotPath } = resolveSnapshotPath(name, options);
  let rawSnapshot;

  try {
    rawSnapshot = await readFile(snapshotPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw snapshotError(`Snapshot not found: ${safeName}.`, "ENOENT");
    }

    throw error;
  }

  let snapshot;

  try {
    snapshot = JSON.parse(rawSnapshot);
  } catch {
    throw snapshotError(`Snapshot is corrupt: ${safeName}.`, "EINVALIDSNAPSHOT");
  }

  validateSnapshotDocument(snapshot, safeName);
  return snapshot;
}

export async function listSnapshots(options = {}) {
  const snapshotDirectory = resolveSnapshotDirectory(options);

  await mkdir(snapshotDirectory, { recursive: true });

  const entries = await readdir(snapshotDirectory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name) === ".json")
    .map((entry) => path.basename(entry.name, ".json"))
    .sort((first, second) => first.localeCompare(second));

  return Promise.all(
    names.map(async (name) => {
      validateSnapshotName(name);
      return createSnapshotSummary(name, await loadSnapshot(name, options));
    }),
  );
}

function appendPath(basePath, key, parentIsArray) {
  if (parentIsArray) {
    return `${basePath}[${key}]`;
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return basePath ? `${basePath}.${key}` : key;
  }

  return `${basePath}[${JSON.stringify(key)}]`;
}

function missingToNull(value) {
  return value === MISSING ? null : value;
}

function createChange(type, pathName, before, after) {
  return {
    type,
    path: pathName,
    before: missingToNull(before),
    after: missingToNull(after),
  };
}

function compareValues(before, after, basePath = "") {
  if (Object.is(before, after)) {
    return [];
  }

  const beforeIsContainer = isPlainObject(before) || Array.isArray(before);
  const afterIsContainer = isPlainObject(after) || Array.isArray(after);

  if (beforeIsContainer && afterIsContainer) {
    const beforeIsArray = Array.isArray(before);
    const afterIsArray = Array.isArray(after);

    if (beforeIsArray !== afterIsArray) {
      return [createChange("changed", basePath, before, after)];
    }

    const keys = [
      ...new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ]),
    ].sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));

    return keys.flatMap((key) => {
      const hasBefore = Object.hasOwn(before, key);
      const hasAfter = Object.hasOwn(after, key);
      const pathName = appendPath(basePath, key, beforeIsArray);

      if (!hasBefore) {
        return [createChange("added", pathName, MISSING, after[key])];
      }

      if (!hasAfter) {
        return [createChange("removed", pathName, before[key], MISSING)];
      }

      return compareValues(before[key], after[key], pathName);
    });
  }

  return [createChange("changed", basePath, before, after)];
}

function comparableSnapshot(snapshot) {
  return {
    system: snapshot.system,
    health: snapshot.health,
    environment: snapshot.environment,
  };
}

export async function compareSnapshots(firstName, secondName, options = {}) {
  const firstSnapshot = await loadSnapshot(firstName, options);
  const secondSnapshot = await loadSnapshot(secondName, options);

  return {
    firstName: validateSnapshotName(firstName),
    secondName: validateSnapshotName(secondName),
    changes: compareValues(
      comparableSnapshot(firstSnapshot),
      comparableSnapshot(secondSnapshot),
    ),
  };
}

export async function deleteSnapshot(name, options = {}) {
  const { name: safeName, snapshotPath } = resolveSnapshotPath(name, options);

  try {
    await unlink(snapshotPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw snapshotError(`Snapshot not found: ${safeName}.`, "ENOENT");
    }

    throw error;
  }

  return {
    name: safeName,
    deleted: true,
  };
}
