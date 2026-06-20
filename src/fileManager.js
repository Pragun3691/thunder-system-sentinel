import {
  access,
  mkdir,
  readFile,
  readdir,
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

function resolveSafePath(fileName) {
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
    throw new Error("The file must remain inside the workspace directory.");
  }

  return resolvedPath;
}

export async function createCodeFile(fileName, content = "") {
  const filePath = resolveSafePath(fileName);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });

  return `Created: ${fileName}`;
}

export async function readCodeFile(fileName) {
  const filePath = resolveSafePath(fileName);
  return readFile(filePath, "utf8");
}

export async function updateCodeFile(fileName, content) {
  const filePath = resolveSafePath(fileName);

  await access(filePath);
  await writeFile(filePath, content, "utf8");

  return `Updated: ${fileName}`;
}

export async function deleteCodeFile(fileName) {
  const filePath = resolveSafePath(fileName);

  await unlink(filePath);
  return `Deleted: ${fileName}`;
}

export async function listCodeFiles() {
  await mkdir(WORKSPACE_ROOT, { recursive: true });

  const entries = await readdir(WORKSPACE_ROOT, {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(WORKSPACE_ROOT, path.join(entry.parentPath, entry.name)),
    );
}