import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkIntegrity,
  createBaselineDocument,
  loadBaseline,
  saveBaseline,
  INTEGRITY_SCHEMA_VERSION,
} from "../src/integrityManager.js";

async function withDirs(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sentinel-integrity-"));
  const workspaceDirectory = path.join(root, "workspace");
  const storageDirectory = path.join(root, "storage");
  await mkdir(workspaceDirectory, { recursive: true });
  await mkdir(storageDirectory, { recursive: true });

  try {
    await run({ workspaceDirectory, storageDirectory });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeBaselineFile(storageDirectory, document) {
  await writeFile(
    path.join(storageDirectory, "baseline.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}

const VALID_HASH = "a".repeat(64);

function createValidBaseline(overrides = {}) {
  return {
    schemaVersion: INTEGRITY_SCHEMA_VERSION,
    algorithm: "sha256",
    generatedAt: "2026-06-20T00:00:00.000Z",
    fileCount: 1,
    files: { "a.txt": { sha256: VALID_HASH, sizeBytes: 1 } },
    ...overrides,
  };
}

async function assertIntegrityError(operation, code, messagePattern) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.isIntegrityError, true);
    assert.match(error.message, messagePattern);
    return true;
  });
}

test("saves a baseline and reports no drift when nothing changed", async () => {
  await withDirs(async (options) => {
    await writeFile(path.join(options.workspaceDirectory, "a.txt"), "hello", "utf8");

    const baseline = await saveBaseline(options);
    assert.equal(baseline.schemaVersion, INTEGRITY_SCHEMA_VERSION);
    assert.equal(baseline.algorithm, "sha256");
    assert.equal(baseline.fileCount, 1);
    assert.match(baseline.files["a.txt"].sha256, /^[a-f0-9]{64}$/);

    const report = await checkIntegrity(options);
    assert.equal(report.hasDrift, false);
    assert.equal(report.summary.unchanged, 1);
    assert.deepEqual(report.modified, []);
    assert.deepEqual(report.added, []);
    assert.deepEqual(report.removed, []);
  });
});

test("normal integrity checks work with collision-safe manifests", async () => {
  await withDirs(async (options) => {
    const file = path.join(options.workspaceDirectory, "normal.txt");
    await writeFile(file, "original", "utf8");

    const baseline = await saveBaseline(options);
    assert.equal(Object.getPrototypeOf(baseline.files), null);

    const cleanReport = await checkIntegrity(options);
    assert.equal(cleanReport.hasDrift, false);
    assert.equal(cleanReport.summary.unchanged, 1);

    await writeFile(file, "changed", "utf8");
    const changedReport = await checkIntegrity(options);
    assert.equal(changedReport.hasDrift, true);
    assert.equal(changedReport.summary.modified, 1);
    assert.equal(changedReport.modified[0].path, "normal.txt");
  });
});

test("rejects prototype-sensitive filenames and path segments explicitly", async (t) => {
  const unsafePaths = [
    "__proto__",
    "constructor",
    "prototype",
    path.join("nested", "__proto__", "file.txt"),
    path.join("nested", "constructor", "file.txt"),
    path.join("nested", "prototype", "file.txt"),
  ];

  for (const unsafePath of unsafePaths) {
    await t.test(unsafePath, async () => {
      await withDirs(async ({ workspaceDirectory }) => {
        const absolutePath = path.join(workspaceDirectory, unsafePath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, "unsafe key test", "utf8");

        await assertIntegrityError(
          createBaselineDocument(workspaceDirectory),
          "EINVALIDBASELINE",
          /invalid manifest path/,
        );
      });
    });
  }
});

test("detects a modified file", async () => {
  await withDirs(async (options) => {
    const file = path.join(options.workspaceDirectory, "a.txt");
    await writeFile(file, "original", "utf8");
    await saveBaseline(options);
    await writeFile(file, "tampered", "utf8");

    const report = await checkIntegrity(options);
    assert.equal(report.hasDrift, true);
    assert.equal(report.summary.modified, 1);
    assert.equal(report.modified[0].path, "a.txt");
    assert.notEqual(report.modified[0].before, report.modified[0].after);
  });
});

test("detects an added file", async () => {
  await withDirs(async (options) => {
    await writeFile(path.join(options.workspaceDirectory, "a.txt"), "x", "utf8");
    await saveBaseline(options);
    await writeFile(path.join(options.workspaceDirectory, "new.txt"), "y", "utf8");

    const report = await checkIntegrity(options);
    assert.equal(report.hasDrift, true);
    assert.equal(report.summary.added, 1);
    assert.equal(report.added[0].path, "new.txt");
  });
});

test("detects a removed file", async () => {
  await withDirs(async (options) => {
    const file = path.join(options.workspaceDirectory, "a.txt");
    await writeFile(file, "x", "utf8");
    await saveBaseline(options);
    await rm(file);

    const report = await checkIntegrity(options);
    assert.equal(report.hasDrift, true);
    assert.equal(report.summary.removed, 1);
    assert.equal(report.removed[0].path, "a.txt");
  });
});

test("normalizes nested paths to forward slashes", async () => {
  await withDirs(async (options) => {
    const nested = path.join(options.workspaceDirectory, "sub", "deep");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "b.txt"), "z", "utf8");

    const baseline = await saveBaseline(options);
    assert.ok(
      Object.keys(baseline.files).includes("sub/deep/b.txt"),
      `expected portable key, got ${JSON.stringify(Object.keys(baseline.files))}`,
    );
  });
});

test("check fails clearly when no baseline exists", async () => {
  await withDirs(async (options) => {
    await assertIntegrityError(
      checkIntegrity(options),
      "ENOBASELINE",
      /No integrity baseline found/,
    );
  });
});

test("rejects corrupt baseline JSON", async () => {
  await withDirs(async (options) => {
    await writeFile(
      path.join(options.storageDirectory, "baseline.json"),
      "{not json",
      "utf8",
    );

    await assertIntegrityError(
      loadBaseline(options),
      "EINVALIDBASELINE",
      /invalid JSON/,
    );
  });
});

test("rejects an unsupported baseline schema version", async () => {
  await withDirs(async (options) => {
    await writeBaselineFile(options.storageDirectory, {
      schemaVersion: 2,
      algorithm: "sha256",
      generatedAt: "2026-06-20T00:00:00.000Z",
      fileCount: 0,
      files: {},
    });

    await assertIntegrityError(
      loadBaseline(options),
      "EUNSUPPORTEDSCHEMA",
      /Unsupported integrity baseline schema version/,
    );
  });
});

test("rejects a baseline with an invalid hash entry", async () => {
  await withDirs(async (options) => {
    await writeBaselineFile(options.storageDirectory, {
      schemaVersion: INTEGRITY_SCHEMA_VERSION,
      algorithm: "sha256",
      generatedAt: "2026-06-20T00:00:00.000Z",
      fileCount: 1,
      files: { "a.txt": { sha256: "not-a-real-hash", sizeBytes: 1 } },
    });

    await assertIntegrityError(
      loadBaseline(options),
      "EINVALIDBASELINE",
      /invalid hash entry/,
    );
  });
});

test("rejects a baseline that uses a different hash algorithm", async () => {
  await withDirs(async (options) => {
    await writeBaselineFile(options.storageDirectory, {
      schemaVersion: INTEGRITY_SCHEMA_VERSION,
      algorithm: "md5",
      generatedAt: "2026-06-20T00:00:00.000Z",
      fileCount: 1,
      files: { "a.txt": { sha256: VALID_HASH, sizeBytes: 1 } },
    });

    await assertIntegrityError(
      loadBaseline(options),
      "EINVALIDBASELINE",
      /Unsupported integrity hash algorithm/,
    );
  });
});

test("cleans temporary baseline files when the atomic rename fails", async () => {
  await withDirs(async (options) => {
    await writeFile(path.join(options.workspaceDirectory, "a.txt"), "x", "utf8");
    await mkdir(path.join(options.storageDirectory, "baseline.json"));

    await assert.rejects(saveBaseline(options));

    const entries = await readdir(options.storageDirectory);
    assert.equal(entries.some((name) => name.endsWith(".tmp")), false);
  });
});

test("cleanup never masks the original write or rename error", async (t) => {
  for (const failingOperation of ["writeFile", "rename"]) {
    await t.test(failingOperation, async () => {
      await withDirs(async (options) => {
        await writeFile(path.join(options.workspaceDirectory, "a.txt"), "x", "utf8");

        const primaryError = Object.assign(
          new Error(`${failingOperation} primary failure`),
          { code: "EPRIMARY" },
        );
        const cleanupError = Object.assign(new Error("cleanup failure"), {
          code: "ECLEANUP",
        });
        let cleanupAttempted = false;
        let renameAttempted = false;

        const fileOperations = {
          writeFile: async () => {
            if (failingOperation === "writeFile") {
              throw primaryError;
            }
          },
          rename: async () => {
            renameAttempted = true;
            throw primaryError;
          },
          unlink: async () => {
            cleanupAttempted = true;
            throw cleanupError;
          },
        };

        await assert.rejects(
          saveBaseline({ ...options, fileOperations }),
          (error) => {
            assert.equal(error, primaryError);
            return true;
          },
        );
        assert.equal(cleanupAttempted, true);
        assert.equal(renameAttempted, failingOperation === "rename");
      });
    });
  }
});

test("rejects invalid generatedAt values", async () => {
  await withDirs(async (options) => {
    for (const generatedAt of [
      "",
      "not-a-date",
      "2026-02-30T00:00:00.000Z",
      "2026-06-20",
    ]) {
      await writeBaselineFile(
        options.storageDirectory,
        createValidBaseline({ generatedAt }),
      );
      await assertIntegrityError(
        loadBaseline(options),
        "EINVALIDBASELINE",
        /generatedAt must be a valid ISO date string/,
      );
    }
  });
});

test("rejects invalid or mismatched fileCount values", async () => {
  await withDirs(async (options) => {
    for (const fileCount of [-1, 1.5, "1", 0, 2]) {
      await writeBaselineFile(
        options.storageDirectory,
        createValidBaseline({ fileCount }),
      );
      await assertIntegrityError(
        loadBaseline(options),
        "EINVALIDBASELINE",
        /fileCount must be a non-negative integer matching the files count/,
      );
    }
  });
});

test("rejects invalid sizeBytes values", async () => {
  await withDirs(async (options) => {
    for (const sizeBytes of [-1, 1.5, "1", null]) {
      await writeBaselineFile(
        options.storageDirectory,
        createValidBaseline({
          files: { "a.txt": { sha256: VALID_HASH, sizeBytes } },
        }),
      );
      await assertIntegrityError(
        loadBaseline(options),
        "EINVALIDBASELINE",
        /invalid sizeBytes/,
      );
    }
  });
});

test("rejects unsafe manifest paths", async () => {
  await withDirs(async (options) => {
    const invalidPaths = [
      "",
      "../outside.txt",
      "nested/../outside.txt",
      "./file.txt",
      "/absolute.txt",
      "C:/absolute.txt",
      "C:drive-relative.txt",
      "nested\\file.txt",
      "nested//file.txt",
      "nested/",
      "__proto__/file.txt",
      "nested/constructor/file.txt",
      "prototype/file.txt",
    ];

    for (const invalidPath of invalidPaths) {
      await writeBaselineFile(
        options.storageDirectory,
        createValidBaseline({
          files: {
            [invalidPath]: { sha256: VALID_HASH, sizeBytes: 1 },
          },
        }),
      );
      await assertIntegrityError(
        loadBaseline(options),
        "EINVALIDBASELINE",
        /invalid manifest path/,
      );
    }
  });
});
