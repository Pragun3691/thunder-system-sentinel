import test from "node:test";
import assert from "node:assert/strict";
import {
  createCodeFile,
  deleteCodeFile,
  listCodeFiles,
  readCodeFile,
  updateCodeFile,
} from "../src/fileManager.js";

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