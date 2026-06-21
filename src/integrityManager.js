import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const INTEGRITY_SCHEMA_VERSION = 1;
const HASH_ALGORITHM = "sha256";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
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

  const manifest = {};

  for (const absolutePath of files) {
    const key = toPortableKey(path.relative(workspaceDirectory, absolutePath));
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

  if (!isPlainObject(document.files)) {
    throw integrityError("Baseline is corrupt: files must be a non-null object.", "EINVALIDBASELINE");
  }

  for (const [name, entry] of Object.entries(document.files)) {
    if (
      !isPlainObject(entry) ||
      typeof entry.sha256 !== "string" ||
      !SHA256_PATTERN.test(entry.sha256)
    ) {
      throw integrityError(`Baseline is corrupt: invalid hash entry for ${name}.`, "EINVALIDBASELINE");
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

  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, baselinePath);

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
    const before = baseline.files[name];
    const after = current[name];

    if (!before) {
      added.push({ path: name, sha256: after.sha256 });
    } else if (!after) {
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
