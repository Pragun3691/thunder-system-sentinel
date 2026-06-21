import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const sourceDirectory = path.join(repositoryRoot, "src");
const packageFile = path.join(repositoryRoot, "package.json");

async function withTemporaryProject(run) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "sentinel-cli-"));
  const temporarySource = path.join(projectRoot, "src");

  try {
    await cp(sourceDirectory, temporarySource, { recursive: true });
    await copyFile(packageFile, path.join(projectRoot, "package.json"));

    await run({
      projectRoot,
      cliPath: path.join(temporarySource, "cli.js"),
      workspaceDirectory: path.join(projectRoot, "workspace"),
    });
  } finally {
    await rm(projectRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}

function runCli(project, args = []) {
  const result = spawnSync(process.execPath, [project.cliPath, ...args], {
    cwd: project.projectRoot,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  return result;
}

function parseJsonOutput(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("--help exits successfully with useful command text", async () => {
  await withTemporaryProject(async (project) => {
    const result = runCli(project, ["--help"]);

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /System Sentinel/);
    assert.match(result.stdout, /snapshot save/);
    assert.match(result.stdout, /integrity check/);
    assert.match(result.stdout, /create <file>/);
  });
});

test("default and explicit info commands return stable text output", async () => {
  await withTemporaryProject(async (project) => {
    for (const args of [[], ["info"]]) {
      const result = runCli(project, args);

      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /SYSTEM SENTINEL REPORT/);
      assert.match(result.stdout, /Operating System/);
      assert.match(result.stdout, /Health Status/);
    }
  });
});

test("info JSON output is parseable and structurally complete", async () => {
  await withTemporaryProject(async (project) => {
    const result = runCli(project, ["info", "--format", "json"]);

    assert.equal(result.status, 0);
    const report = parseJsonOutput(result);
    assert.equal(typeof report.generatedAt, "string");
    assert.equal(typeof report.system, "object");
    assert.equal(typeof report.system.operatingSystem, "object");
    assert.equal(typeof report.system.cpu, "object");
    assert.equal(typeof report.health, "object");
    assert.equal(typeof report.environment, "object");
  });
});

test("unknown commands and invalid formats fail through stderr", async () => {
  await withTemporaryProject(async (project) => {
    const unknown = runCli(project, ["not-a-command"]);
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stdout, "");
    assert.match(unknown.stderr, /Unknown command: not-a-command/);

    const invalidFormat = runCli(project, ["info", "--format", "yaml"]);
    assert.equal(invalidFormat.status, 1);
    assert.equal(invalidFormat.stdout, "");
    assert.match(invalidFormat.stderr, /Unsupported output format: yaml/);
  });
});

test("CLI performs a complete CRUD lifecycle and preserves quoted content", async () => {
  await withTemporaryProject(async (project) => {
    const fileName = "cli-lifecycle.txt";
    const originalContent = `const message = "Hello, 'Sentinel'!";`;
    const updatedContent = `console.log('Updated "directly"');`;

    const created = runCli(project, [
      "create",
      fileName,
      "--content",
      originalContent,
    ]);
    assert.equal(created.status, 0);
    assert.equal(created.stderr, "");
    assert.match(created.stdout, /Created: cli-lifecycle\.txt/);

    const read = runCli(project, ["read", fileName, "--format", "json"]);
    assert.equal(read.status, 0);
    const readResult = parseJsonOutput(read);
    assert.equal(readResult.operation, "read");
    assert.equal(readResult.result, originalContent);

    const updated = runCli(project, [
      "update",
      fileName,
      "--content",
      updatedContent,
    ]);
    assert.equal(updated.status, 0);
    assert.match(updated.stdout, /Updated: cli-lifecycle\.txt/);

    const readUpdated = runCli(project, ["read", fileName]);
    assert.equal(readUpdated.status, 0);
    assert.equal(readUpdated.stdout.trimEnd(), updatedContent);

    const listed = runCli(project, ["list", "--format", "json"]);
    assert.equal(listed.status, 0);
    const listResult = parseJsonOutput(listed);
    assert.equal(listResult.operation, "list");
    assert.match(listResult.result, /cli-lifecycle\.txt/);

    const deleted = runCli(project, ["delete", fileName, "--format", "json"]);
    assert.equal(deleted.status, 0);
    const deleteResult = parseJsonOutput(deleted);
    assert.equal(deleteResult.operation, "delete");
    assert.match(deleteResult.result, /Deleted: cli-lifecycle\.txt/);

    const missing = runCli(project, ["read", fileName]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /requested file does not exist/);
  });
});

test("CLI performs the snapshot save, list, show, compare, and delete lifecycle", async () => {
  await withTemporaryProject(async (project) => {
    const firstName = "integration_first";
    const secondName = "integration_second";

    const firstSave = runCli(project, [
      "snapshot",
      "save",
      firstName,
      "--format",
      "json",
    ]);
    assert.equal(firstSave.status, 0);
    const firstSaveResult = parseJsonOutput(firstSave);
    assert.equal(firstSaveResult.operation, "snapshot save");
    assert.equal(firstSaveResult.result.name, firstName);

    const secondSave = runCli(project, ["snapshot", "save", secondName]);
    assert.equal(secondSave.status, 0);
    assert.match(secondSave.stdout, /Snapshot saved: integration_second/);

    const listed = runCli(project, ["snapshot", "list", "--format", "json"]);
    assert.equal(listed.status, 0);
    const snapshots = parseJsonOutput(listed);
    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.name).sort(),
      [firstName, secondName],
    );

    const shown = runCli(project, [
      "snapshot",
      "show",
      firstName,
      "--format",
      "json",
    ]);
    assert.equal(shown.status, 0);
    const snapshot = parseJsonOutput(shown);
    assert.equal(snapshot.name, firstName);
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(typeof snapshot.system, "object");
    assert.equal(typeof snapshot.health, "object");

    const compared = runCli(project, [
      "snapshot",
      "compare",
      firstName,
      secondName,
      "--format",
      "json",
    ]);
    assert.equal(compared.status, 0);
    const comparison = parseJsonOutput(compared);
    assert.equal(comparison.firstName, firstName);
    assert.equal(comparison.secondName, secondName);
    assert.equal(Array.isArray(comparison.changes), true);

    const firstDelete = runCli(project, [
      "snapshot",
      "delete",
      firstName,
      "--format",
      "json",
    ]);
    assert.equal(firstDelete.status, 0);
    const firstDeleteResult = parseJsonOutput(firstDelete);
    assert.equal(firstDeleteResult.result.name, firstName);
    assert.equal(firstDeleteResult.result.deleted, true);

    const secondDelete = runCli(project, ["snapshot", "delete", secondName]);
    assert.equal(secondDelete.status, 0);
    assert.match(secondDelete.stdout, /Snapshot deleted: integration_second/);
  });
});

test("integrity check without a baseline exits with an error", async () => {
  await withTemporaryProject(async (project) => {
    const result = runCli(project, ["integrity", "check"]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /No integrity baseline found/);
  });
});

test("integrity baseline and clean check both exit successfully", async () => {
  await withTemporaryProject(async (project) => {
    await mkdir(project.workspaceDirectory, { recursive: true });
    await writeFile(
      path.join(project.workspaceDirectory, "tracked.txt"),
      "stable",
      "utf8",
    );

    const baseline = runCli(project, [
      "integrity",
      "baseline",
      "--format",
      "json",
    ]);
    assert.equal(baseline.status, 0);
    const baselineDocument = parseJsonOutput(baseline);
    assert.equal(baselineDocument.algorithm, "sha256");
    assert.equal(baselineDocument.fileCount, 1);

    const check = runCli(project, ["integrity", "check"]);
    assert.equal(check.status, 0);
    assert.equal(check.stderr, "");
    assert.match(check.stdout, /No changes detected/);
  });
});

const driftCases = [
  {
    type: "modified",
    prepare: async (workspaceDirectory) => {
      await writeFile(path.join(workspaceDirectory, "tracked.txt"), "before", "utf8");
    },
    mutate: async (workspaceDirectory) => {
      await writeFile(path.join(workspaceDirectory, "tracked.txt"), "after", "utf8");
    },
    outputPattern: /Modified[\s\S]*tracked\.txt/,
  },
  {
    type: "added",
    prepare: async () => {},
    mutate: async (workspaceDirectory) => {
      await writeFile(path.join(workspaceDirectory, "added.txt"), "added", "utf8");
    },
    outputPattern: /Added[\s\S]*added\.txt/,
  },
  {
    type: "removed",
    prepare: async (workspaceDirectory) => {
      await writeFile(path.join(workspaceDirectory, "removed.txt"), "remove", "utf8");
    },
    mutate: async (workspaceDirectory) => {
      await unlink(path.join(workspaceDirectory, "removed.txt"));
    },
    outputPattern: /Removed[\s\S]*removed\.txt/,
  },
];

for (const driftCase of driftCases) {
  test(`${driftCase.type} integrity drift exits with code 1`, async () => {
    await withTemporaryProject(async (project) => {
      await mkdir(project.workspaceDirectory, { recursive: true });
      await driftCase.prepare(project.workspaceDirectory);

      const baseline = runCli(project, ["integrity", "baseline"]);
      assert.equal(baseline.status, 0);

      await driftCase.mutate(project.workspaceDirectory);
      const check = runCli(project, ["integrity", "check"]);
      assert.equal(check.status, 1);
      assert.equal(check.stderr, "");
      assert.match(check.stdout, driftCase.outputPattern);
    });
  });
}

test("integrity JSON reports exact modified, added, and removed summary fields", async () => {
  await withTemporaryProject(async (project) => {
    await mkdir(project.workspaceDirectory, { recursive: true });
    await writeFile(path.join(project.workspaceDirectory, "modified.txt"), "before", "utf8");
    await writeFile(path.join(project.workspaceDirectory, "removed.txt"), "remove", "utf8");
    await writeFile(path.join(project.workspaceDirectory, "unchanged.txt"), "same", "utf8");

    const baseline = runCli(project, ["integrity", "baseline"]);
    assert.equal(baseline.status, 0);

    await writeFile(path.join(project.workspaceDirectory, "modified.txt"), "after", "utf8");
    await unlink(path.join(project.workspaceDirectory, "removed.txt"));
    await writeFile(path.join(project.workspaceDirectory, "added.txt"), "add", "utf8");

    const check = runCli(project, [
      "integrity",
      "check",
      "--format",
      "json",
    ]);
    assert.equal(check.status, 1);
    const report = parseJsonOutput(check);
    assert.equal(report.hasDrift, true);
    assert.deepEqual(report.summary, {
      added: 1,
      removed: 1,
      modified: 1,
      unchanged: 1,
    });
    assert.deepEqual(report.added.map((entry) => entry.path), ["added.txt"]);
    assert.deepEqual(report.removed.map((entry) => entry.path), ["removed.txt"]);
    assert.deepEqual(report.modified.map((entry) => entry.path), ["modified.txt"]);
    assert.deepEqual(report.unchanged.map((entry) => entry.path), ["unchanged.txt"]);
  });
});
