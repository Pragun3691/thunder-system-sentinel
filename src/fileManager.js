import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(currentDirectory, "../workspace");

const ALLOWED_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".ts",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".md",
  ".txt",
]);

function workspaceEscapeError() {
  return new Error("The file must remain inside the workspace directory.");
}

function isInsideDirectory(directory, candidate) {
  const relativePath = path.relative(directory, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function resolveLexicalPath(fileName) {
  if (!fileName?.trim()) {
    throw new Error("A file name is required.");
  }

  if (path.isAbsolute(fileName)) {
    throw new Error("Absolute paths are not allowed.");
  }

  const extension = path.extname(fileName).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file extension: ${extension || "none"}`);
  }

  const resolvedPath = path.resolve(WORKSPACE_ROOT, fileName);

  if (
    resolvedPath !== WORKSPACE_ROOT &&
    !resolvedPath.startsWith(`${WORKSPACE_ROOT}${path.sep}`)
  ) {
    throw workspaceEscapeError();
  }

  return resolvedPath;
}

async function findDeepestExistingPath(candidate) {
  let current = candidate;

  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
        throw error;
      }
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw workspaceEscapeError();
    }

    current = parent;
  }
}

async function assertRealPathInsideWorkspace(candidate, realWorkspaceRoot) {
  const existingPath = await findDeepestExistingPath(candidate);
  let realExistingPath;

  try {
    realExistingPath = await realpath(existingPath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ELOOP") {
      throw workspaceEscapeError();
    }

    throw error;
  }

  if (!isInsideDirectory(realWorkspaceRoot, realExistingPath)) {
    throw workspaceEscapeError();
  }
}

async function resolveSafePath(fileName) {
  const filePath = resolveLexicalPath(fileName);

  await mkdir(WORKSPACE_ROOT, { recursive: true });
  const realWorkspaceRoot = await realpath(WORKSPACE_ROOT);
  await assertRealPathInsideWorkspace(filePath, realWorkspaceRoot);

  return { filePath, realWorkspaceRoot };
}

export async function createCodeFile(fileName, content = "") {
  const { filePath, realWorkspaceRoot } = await resolveSafePath(fileName);

  await mkdir(path.dirname(filePath), { recursive: true });
  await assertRealPathInsideWorkspace(path.dirname(filePath), realWorkspaceRoot);
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });

  return `Created: ${fileName}`;
}

export async function readCodeFile(fileName) {
  const { filePath } = await resolveSafePath(fileName);
  return readFile(filePath, "utf8");
}

export async function updateCodeFile(fileName, content) {
  const { filePath } = await resolveSafePath(fileName);
  const fileHandle = await open(filePath, "r+");

  try {
    await fileHandle.truncate(0);
    await fileHandle.writeFile(content, { encoding: "utf8" });
  } finally {
    await fileHandle.close();
  }

  return `Updated: ${fileName}`;
}

export async function deleteCodeFile(fileName) {
  const { filePath } = await resolveSafePath(fileName);

  await unlink(filePath);
  return `Deleted: ${fileName}`;
}

export async function listCodeFiles() {
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  const realWorkspaceRoot = await realpath(WORKSPACE_ROOT);

  const entries = await readdir(WORKSPACE_ROOT, {
    recursive: true,
    withFileTypes: true,
  });

  const files = [];

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      continue;
    }

    const absolutePath = path.join(entry.parentPath, entry.name);
    await assertRealPathInsideWorkspace(absolutePath, realWorkspaceRoot);
    files.push(path.relative(WORKSPACE_ROOT, absolutePath));
  }

  return files;
}
