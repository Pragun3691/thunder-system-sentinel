import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const INTEGRITY_SCHEMA_VERSION = 1;
const HASH_ALGORITHM = "sha256";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const BASELINE_FILENAME = "baseline.json";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE_DIRECTORY = path.resolve(currentDirectory, "../workspace");
const DEFAULT_STORAGE_DIRECTORY = path.resolve(
  currentDirectory,
  "../.sentinel/integrity",
);

function integrityError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.isIntegrityError = true;
  return error;
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

function isSafeManifestPath(name) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.includes("\\") ||
    name.includes("\0") ||
    path.posix.isAbsolute(name) ||
    path.win32.parse(name).root !== ""
  ) {
    return false;
  }

  const segments = name.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !UNSAFE_PATH_SEGMENTS.has(segment),
  );
}

function invalidManifestPathError(name) {
  return integrityError(
    `Baseline is corrupt: invalid manifest path ${JSON.stringify(name)}.`,
    "EINVALIDBASELINE",
  );
}

function resolveWorkspaceDirectory({ workspaceDirectory } = {}) {
  return path.resolve(workspaceDirectory ?? DEFAULT_WORKSPACE_DIRECTORY);
}

function resolveBaselinePath({ storageDirectory } = {}) {
  const directory = path.resolve(storageDirectory ?? DEFAULT_STORAGE_DIRECTORY);
  return { storageDirectory: directory, baselinePath: path.join(directory, BASELINE_FILENAME) };
}

// Normalise to forward slashes so a baseline made on Windows still
// compares correctly on Linux/macOS and vice versa.
function toPortableKey(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function collectFileManifest(workspaceDirectory) {
  await mkdir(workspaceDirectory, { recursive: true });

  const entries = await readdir(workspaceDirectory, {
    recursive: true,
    withFileTypes: true,
  });

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort((first, second) => first.localeCompare(second));

  const manifest = Object.create(null);

  for (const absolutePath of files) {
    const key = toPortableKey(path.relative(workspaceDirectory, absolutePath));

    if (!isSafeManifestPath(key)) {
      throw invalidManifestPathError(key);
    }

    const data = await readFile(absolutePath);
    manifest[key] = {
      sha256: createHash(HASH_ALGORITHM).update(data).digest("hex"),
      sizeBytes: data.length,
    };
  }

  return manifest;
}

export async function createBaselineDocument(workspaceDirectory) {
  const files = await collectFileManifest(workspaceDirectory);

  return {
    schemaVersion: INTEGRITY_SCHEMA_VERSION,
    algorithm: HASH_ALGORITHM,
    generatedAt: new Date().toISOString(),
    fileCount: Object.keys(files).length,
    files,
  };
}

function validateBaselineDocument(document) {
  if (!isPlainObject(document)) {
    throw integrityError("Baseline is corrupt: document must be a non-null object.", "EINVALIDBASELINE");
  }

  if (document.schemaVersion !== INTEGRITY_SCHEMA_VERSION) {
    throw integrityError(
      `Unsupported integrity baseline schema version: ${document.schemaVersion ?? "missing"}.`,
      "EUNSUPPORTEDSCHEMA",
    );
  }

  if (document.algorithm !== HASH_ALGORITHM) {
    throw integrityError(
      `Unsupported integrity hash algorithm: ${document.algorithm ?? "missing"}.`,
      "EINVALIDBASELINE",
    );
  }

  if (!isValidIsoDateString(document.generatedAt)) {
    throw integrityError(
      "Baseline is corrupt: generatedAt must be a valid ISO date string.",
      "EINVALIDBASELINE",
    );
  }

  if (!isPlainObject(document.files)) {
    throw integrityError("Baseline is corrupt: files must be a non-null object.", "EINVALIDBASELINE");
  }

  const fileNames = Object.keys(document.files);

  if (
    !Number.isInteger(document.fileCount) ||
    document.fileCount < 0 ||
    document.fileCount !== fileNames.length
  ) {
    throw integrityError(
      "Baseline is corrupt: fileCount must be a non-negative integer matching the files count.",
      "EINVALIDBASELINE",
    );
  }

  for (const [name, entry] of Object.entries(document.files)) {
    if (!isSafeManifestPath(name)) {
      throw invalidManifestPathError(name);
    }

    if (
      !isPlainObject(entry) ||
      typeof entry.sha256 !== "string" ||
      !SHA256_PATTERN.test(entry.sha256)
    ) {
      throw integrityError(`Baseline is corrupt: invalid hash entry for ${name}.`, "EINVALIDBASELINE");
    }

    if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
      throw integrityError(
        `Baseline is corrupt: invalid sizeBytes for ${name}.`,
        "EINVALIDBASELINE",
      );
    }
  }
}

export async function saveBaseline(options = {}) {
  const workspaceDirectory = resolveWorkspaceDirectory(options);
  const { storageDirectory, baselinePath } = resolveBaselinePath(options);
  const document = await createBaselineDocument(workspaceDirectory);
  validateBaselineDocument(document);

  await mkdir(storageDirectory, { recursive: true });

  // Atomic overwrite via temp file + rename: portable across NTFS, OneDrive,
  // and network drives (unlike a hard link), and re-baselining is allowed.
  const temporaryPath = path.join(
    storageDirectory,
    `.baseline.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  const fileOperations = {
    writeFile,
    rename,
    unlink,
    ...options.fileOperations,
  };
  let operationFailed = false;

  try {
    await fileOperations.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await fileOperations.rename(temporaryPath, baselinePath);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await fileOperations.unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT" && !operationFailed) {
        throw cleanupError;
      }
    }
  }

  return document;
}

export async function loadBaseline(options = {}) {
  const { baselinePath } = resolveBaselinePath(options);
  let raw;

  try {
    raw = await readFile(baselinePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw integrityError(
        "No integrity baseline found. Run 'integrity baseline' first.",
        "ENOBASELINE",
      );
    }

    throw error;
  }

  let document;

  try {
    document = JSON.parse(raw);
  } catch {
    throw integrityError("Baseline is corrupt: invalid JSON.", "EINVALIDBASELINE");
  }

  validateBaselineDocument(document);
  return document;
}

export async function checkIntegrity(options = {}) {
  const workspaceDirectory = resolveWorkspaceDirectory(options);
  const baseline = await loadBaseline(options);
  const current = await collectFileManifest(workspaceDirectory);

  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  const names = [
    ...new Set([...Object.keys(baseline.files), ...Object.keys(current)]),
  ].sort((first, second) => first.localeCompare(second));

  for (const name of names) {
    const hasBefore = Object.hasOwn(baseline.files, name);
    const hasAfter = Object.hasOwn(current, name);
    const before = baseline.files[name];
    const after = current[name];

    if (!hasBefore) {
      added.push({ path: name, sha256: after.sha256 });
    } else if (!hasAfter) {
      removed.push({ path: name, sha256: before.sha256 });
    } else if (before.sha256 !== after.sha256) {
      modified.push({ path: name, before: before.sha256, after: after.sha256 });
    } else {
      unchanged.push({ path: name });
    }
  }

  return {
    baselineGeneratedAt: baseline.generatedAt,
    algorithm: baseline.algorithm,
    summary: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      unchanged: unchanged.length,
    },
    added,
    removed,
    modified,
    unchanged,
    hasDrift: added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}
