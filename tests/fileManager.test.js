import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCodeFile,
  deleteCodeFile,
  listCodeFiles,
  readCodeFile,
  updateCodeFile,
} from "../src/fileManager.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(testDirectory, "../workspace");

async function createLinkOrSkip(t, target, linkPath, type) {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("This platform does not permit creating links for this test.");
      return false;
    }

    throw error;
  }
}

test("performs create, read, update, list, and delete operations", async () => {
  const fileName = `crud-test-${Date.now()}.js`;

  try {
    assert.equal(
      await createCodeFile(fileName, "const value = 1;"),
      `Created: ${fileName}`,
    );

    assert.equal(await readCodeFile(fileName), "const value = 1;");

    await assert.rejects(
      createCodeFile(fileName, "duplicate"),
      { code: "EEXIST" },
    );

    assert.equal(
      await updateCodeFile(fileName, "const value = 2;"),
      `Updated: ${fileName}`,
    );

    assert.equal(await readCodeFile(fileName), "const value = 2;");
    assert.equal((await listCodeFiles()).includes(fileName), true);

    assert.equal(await deleteCodeFile(fileName), `Deleted: ${fileName}`);
    await assert.rejects(readCodeFile(fileName), { code: "ENOENT" });
  } finally {
    await deleteCodeFile(fileName).catch(() => {});
  }
});

test("blocks paths outside the workspace", async () => {
  await assert.rejects(
    readCodeFile("../package.json"),
    /must remain inside the workspace/,
  );
});

test("rejects unsupported file extensions", async () => {
  await assert.rejects(
    createCodeFile("unsafe.exe", ""),
    /Unsupported file extension/,
  );
});

test("rejects an existing file symlink that resolves outside the workspace", async (t) => {
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "sentinel-file-link-"));
  const linkName = `file-link-escape-${process.pid}.txt`;
  const linkPath = path.join(workspaceDirectory, linkName);
  const outsideFile = path.join(outsideDirectory, "outside.txt");

  await mkdir(workspaceDirectory, { recursive: true });
  await rm(linkPath, { force: true });
  await writeFile(outsideFile, "outside", "utf8");

  try {
    if (!(await createLinkOrSkip(t, outsideFile, linkPath, "file"))) {
      return;
    }

    await assert.rejects(readCodeFile(linkName), /must remain inside the workspace/);
    await assert.rejects(updateCodeFile(linkName, "changed"), /must remain inside the workspace/);
    await assert.rejects(deleteCodeFile(linkName), /must remain inside the workspace/);
    assert.equal(await readFile(outsideFile, "utf8"), "outside");
  } finally {
    await rm(linkPath, { force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("rejects nested directory link escapes for existing and new files", async (t) => {
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "sentinel-dir-link-"));
  const testRootName = `nested-link-escape-${process.pid}`;
  const testRoot = path.join(workspaceDirectory, testRootName);
  const linkPath = path.join(testRoot, "redirect");
  const nestedOutsideDirectory = path.join(outsideDirectory, "nested");

  await rm(testRoot, { recursive: true, force: true });
  await mkdir(testRoot, { recursive: true });
  await mkdir(nestedOutsideDirectory, { recursive: true });
  await writeFile(path.join(nestedOutsideDirectory, "existing.txt"), "outside", "utf8");

  try {
    const linkType = process.platform === "win32" ? "junction" : "dir";

    if (!(await createLinkOrSkip(t, outsideDirectory, linkPath, linkType))) {
      return;
    }

    const existingName = `${testRootName}/redirect/nested/existing.txt`;
    const newName = `${testRootName}/redirect/nested/new.txt`;

    await assert.rejects(readCodeFile(existingName), /must remain inside the workspace/);
    await assert.rejects(createCodeFile(newName, "blocked"), /must remain inside the workspace/);
    await assert.rejects(updateCodeFile(existingName, "blocked"), /must remain inside the workspace/);
    await assert.rejects(deleteCodeFile(existingName), /must remain inside the workspace/);
    await assert.rejects(access(path.join(nestedOutsideDirectory, "new.txt")), { code: "ENOENT" });
  } finally {
    await rm(testRoot, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});
