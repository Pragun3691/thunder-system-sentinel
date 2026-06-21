import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compareSnapshots,
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
} from "../src/snapshotManager.js";

const baseReport = {
  generatedAt: "2026-06-20T00:00:00.000Z",
  system: {
    operatingSystem: {
      type: "TestOS",
      release: "1.0",
      version: "Test Version",
    },
    cpu: {
      architecture: "x64",
      model: "Test CPU",
      logicalCores: 4,
      usagePercent: 25,
    },
    machine: {
      hostname: "test-machine",
      platform: "linux",
      homeDirectory: "/home/test",
    },
    runtime: {
      nodeVersion: "v22.0.0",
    },
    memory: {
      totalBytes: 100,
      freeBytes: 60,
      usedBytes: 40,
      usagePercent: 40,
    },
    loadAverages: {
      oneMinute: 1,
      fiveMinute: 2,
      fifteenMinute: 3,
      supported: true,
      note: null,
    },
    network: {
      interfaces: [
        {
          name: "lo",
          family: "IPv4",
          internal: true,
        },
      ],
    },
    uptimeSeconds: 120,
  },
  health: {
    overallStatus: "healthy",
    cpu: {
      status: "healthy",
      usagePercent: 25,
    },
    memory: {
      status: "healthy",
      usagePercent: 40,
    },
    warnings: [],
  },
  environment: {
    NODE_ENV: "test",
  },
};

function createReport(update) {
  const report = JSON.parse(JSON.stringify(baseReport));
  update?.(report);
  return report;
}

async function withStorage(run) {
  const storageDirectory = await mkdtemp(
    path.join(os.tmpdir(), "sentinel-snapshots-"),
  );

  try {
    await run(storageDirectory);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
}

async function writeSnapshotFile(storageDirectory, name, snapshot) {
  await mkdir(storageDirectory, { recursive: true });
  await writeFile(
    path.join(storageDirectory, `${name}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

function createSnapshot(name, update) {
  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    name,
    ...createReport(),
  };
  update?.(snapshot);
  return snapshot;
}

async function assertInvalidSnapshot(operation, messagePattern) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, "EINVALIDSNAPSHOT");
    assert.match(error.message, messagePattern);
    return true;
  });
}

test("saves, lists, shows, and deletes a snapshot", async () => {
  await withStorage(async (storageDirectory) => {
    const snapshot = await saveSnapshot("daily_1", createReport(), {
      storageDirectory,
    });

    assert.equal(snapshot.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
    assert.equal(snapshot.name, "daily_1");

    const rawSnapshot = await readFile(
      path.join(storageDirectory, "daily_1.json"),
      "utf8",
    );
    assert.equal(JSON.parse(rawSnapshot).name, "daily_1");

    assert.deepEqual(await listSnapshots({ storageDirectory }), [
      {
        name: "daily_1",
        createdAt: "2026-06-20T00:00:00.000Z",
        platform: "linux",
        health: "healthy",
      },
    ]);
    assert.deepEqual(await loadSnapshot("daily_1", { storageDirectory }), snapshot);
    assert.deepEqual(await deleteSnapshot("daily_1", { storageDirectory }), {
      name: "daily_1",
      deleted: true,
    });
    assert.deepEqual(await listSnapshots({ storageDirectory }), []);
  });
});

test("rejects duplicate snapshot names", async () => {
  await withStorage(async (storageDirectory) => {
    await saveSnapshot("duplicate", createReport(), { storageDirectory });

    await assert.rejects(
      saveSnapshot("duplicate", createReport(), { storageDirectory }),
      /already exists/,
    );
  });
});

test("rejects invalid names, traversal attempts, and absolute path attempts", async () => {
  await withStorage(async (storageDirectory) => {
    for (const name of [
      "",
      "../escape",
      "nested/name",
      "name.json",
      "C:\\absolute",
      "a".repeat(65),
    ]) {
      await assert.rejects(
        saveSnapshot(name, createReport(), { storageDirectory }),
        /Invalid snapshot name/,
      );
      await assert.rejects(
        loadSnapshot(name, { storageDirectory }),
        /Invalid snapshot name/,
      );
      await assert.rejects(
        deleteSnapshot(name, { storageDirectory }),
        /Invalid snapshot name/,
      );
    }
  });
});

test("rejects missing snapshots", async () => {
  await withStorage(async (storageDirectory) => {
    await assert.rejects(
      loadSnapshot("missing", { storageDirectory }),
      /Snapshot not found/,
    );
    await assert.rejects(
      deleteSnapshot("missing", { storageDirectory }),
      /Snapshot not found/,
    );
  });
});

test("rejects corrupt snapshot JSON", async () => {
  await withStorage(async (storageDirectory) => {
    await mkdir(storageDirectory, { recursive: true });
    await writeFile(path.join(storageDirectory, "corrupt.json"), "{not json", "utf8");

    await assertInvalidSnapshot(
      loadSnapshot("corrupt", { storageDirectory }),
      /Snapshot is corrupt/,
    );
    await assertInvalidSnapshot(
      listSnapshots({ storageDirectory }),
      /Snapshot is corrupt/,
    );
  });
});

test("rejects unsupported snapshot schema versions", async () => {
  await withStorage(async (storageDirectory) => {
    await writeSnapshotFile(storageDirectory, "future", {
      ...createReport(),
      schemaVersion: 2,
      name: "future",
    });

    await assert.rejects(
      loadSnapshot("future", { storageDirectory }),
      /Unsupported snapshot schema version/,
    );
  });
});

test("rejects a snapshot whose embedded name differs from its filename", async () => {
  await withStorage(async (storageDirectory) => {
    await writeSnapshotFile(
      storageDirectory,
      "requested",
      createSnapshot("different"),
    );

    await assertInvalidSnapshot(
      loadSnapshot("requested", { storageDirectory }),
      /Embedded snapshot name "different" does not match requested name "requested"/,
    );
  });
});

test("rejects missing and invalid embedded snapshot names", async () => {
  await withStorage(async (storageDirectory) => {
    const cases = [
      ["missing-name", undefined],
      ["invalid-name", "invalid.name"],
    ];

    for (const [fileName, embeddedName] of cases) {
      const snapshot = createSnapshot(fileName);

      if (embeddedName === undefined) {
        delete snapshot.name;
      } else {
        snapshot.name = embeddedName;
      }

      await writeSnapshotFile(storageDirectory, fileName, snapshot);
      await assertInvalidSnapshot(
        loadSnapshot(fileName, { storageDirectory }),
        /Embedded snapshot name is missing or invalid/,
      );
    }
  });
});

test("rejects invalid snapshot generatedAt values", async () => {
  await withStorage(async (storageDirectory) => {
    const invalidValues = ["", "not-a-date", "2026-02-30T00:00:00.000Z", null];

    for (const [index, generatedAt] of invalidValues.entries()) {
      const name = `invalid-date-${index}`;
      await writeSnapshotFile(
        storageDirectory,
        name,
        createSnapshot(name, (snapshot) => {
          snapshot.generatedAt = generatedAt;
        }),
      );

      await assertInvalidSnapshot(
        loadSnapshot(name, { storageDirectory }),
        /generatedAt must be a valid non-empty ISO date string/,
      );
    }
  });
});

test("rejects array and null snapshot report sections", async () => {
  await withStorage(async (storageDirectory) => {
    for (const field of ["system", "health", "environment"]) {
      for (const [valueName, value] of [["array", []], ["null", null]]) {
        const name = `${field}-${valueName}`;
        await writeSnapshotFile(
          storageDirectory,
          name,
          createSnapshot(name, (snapshot) => {
            snapshot[field] = value;
          }),
        );

        await assertInvalidSnapshot(
          loadSnapshot(name, { storageDirectory }),
          new RegExp(`${field} must be a non-null plain object`),
        );
      }
    }
  });
});

test("validates snapshot content before saving", async () => {
  await withStorage(async (storageDirectory) => {
    const invalidReports = [
      createReport((report) => {
        report.generatedAt = "not-a-date";
      }),
      ...["system", "health", "environment"].flatMap((field) =>
        [[], null].map((value) =>
          createReport((report) => {
            report[field] = value;
          }),
        ),
      ),
    ];

    for (const [index, report] of invalidReports.entries()) {
      await assertInvalidSnapshot(
        saveSnapshot(`invalid-save-${index}`, report, { storageDirectory }),
        /generatedAt must be|must be a non-null plain object/,
      );
    }
  });
});

test("compares added, removed, and changed report values", async () => {
  await withStorage(async (storageDirectory) => {
    await saveSnapshot(
      "before",
      createReport((report) => {
        report.environment.NODE_ENV = "test";
        report.environment.OLD_ONLY = "before";
      }),
      { storageDirectory },
    );
    await saveSnapshot(
      "after",
      createReport((report) => {
        report.environment.NODE_ENV = "production";
        report.environment.NEW_ONLY = "after";
        report.system.cpu.usagePercent = 65;
        delete report.environment.OLD_ONLY;
      }),
      { storageDirectory },
    );

    const comparison = await compareSnapshots("before", "after", {
      storageDirectory,
    });

    assert.deepEqual(comparison, {
      firstName: "before",
      secondName: "after",
      changes: [
        {
          type: "added",
          path: "environment.NEW_ONLY",
          before: null,
          after: "after",
        },
        {
          type: "changed",
          path: "environment.NODE_ENV",
          before: "test",
          after: "production",
        },
        {
          type: "removed",
          path: "environment.OLD_ONLY",
          before: "before",
          after: null,
        },
        {
          type: "changed",
          path: "system.cpu.usagePercent",
          before: 25,
          after: 65,
        },
      ],
    });
  });
});

test("ignores snapshot metadata when comparing snapshots", async () => {
  await withStorage(async (storageDirectory) => {
    await saveSnapshot(
      "first",
      createReport((report) => {
        report.generatedAt = "2026-06-20T00:00:00.000Z";
      }),
      { storageDirectory },
    );
    await saveSnapshot(
      "second",
      createReport((report) => {
        report.generatedAt = "2026-06-21T00:00:00.000Z";
      }),
      { storageDirectory },
    );

    assert.deepEqual(await compareSnapshots("first", "second", { storageDirectory }), {
      firstName: "first",
      secondName: "second",
      changes: [],
    });
  });
});
