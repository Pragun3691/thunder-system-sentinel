import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const sourceDirectory = path.join(repositoryRoot, "src");
const packageFile = path.join(repositoryRoot, "package.json");
const COMMAND_TIMEOUT_MS = 30_000;

function printStage(number, title) {
  const heading = `${number}. ${title}`;
  console.log(`\n${heading}\n${"-".repeat(heading.length)}`);
}

function quoteForDisplay(value) {
  return /^[A-Za-z0-9_./:\\-]+$/.test(value) ? value : JSON.stringify(value);
}

function displayOutput(output, stream) {
  if (!output) {
    return;
  }

  stream.write(output);

  if (!output.endsWith("\n")) {
    stream.write("\n");
  }
}

function runCli(project, args, { expectedStatus = 0 } = {}) {
  const displayedCommand = [
    process.execPath,
    path.join("src", "cli.js"),
    ...args,
  ]
    .map(quoteForDisplay)
    .join(" ");

  console.log(`\n$ ${displayedCommand}`);

  const result = spawnSync(process.execPath, [project.cliPath, ...args], {
    cwd: project.root,
    encoding: "utf8",
    shell: false,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });

  displayOutput(result.stdout, process.stdout);
  displayOutput(result.stderr, process.stderr);

  if (result.error) {
    throw new Error(`Command failed to start or timed out: ${result.error.message}`);
  }

  if (result.signal !== null) {
    throw new Error(`Command was terminated by signal ${result.signal}.`);
  }

  if (result.status !== expectedStatus) {
    throw new Error(
      `Command exited with code ${result.status}; expected ${expectedStatus}.`,
    );
  }

  if (result.stderr.trim() !== "") {
    throw new Error("Command wrote unexpected output to stderr.");
  }

  return result;
}

function requireOutput(output, pattern, description) {
  if (!pattern.test(output)) {
    throw new Error(`Command output did not include ${description}.`);
  }
}

async function runDemo() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "sentinel-demo-"));
  const temporarySource = path.join(temporaryRoot, "src");
  const uniqueId = randomUUID().replaceAll("-", "");
  const fileName = `demo-${uniqueId}.js`;
  const beforeSnapshot = `before_${uniqueId}`;
  const afterSnapshot = `after_${uniqueId}`;
  const originalCode = `const message = "Thunder says, 'Systems nominal.'";`;
  const updatedCode = `const message = "Thunder says, 'Integrity drift detected.'";`;
  const project = {
    root: temporaryRoot,
    cliPath: path.join(temporarySource, "cli.js"),
  };
  let demoError;

  console.log("Thunder System Sentinel - Isolated Project Demo");
  console.log("Every command below runs against a temporary copy of the project.");

  try {
    await cp(sourceDirectory, temporarySource, { recursive: true });
    await copyFile(packageFile, path.join(temporaryRoot, "package.json"));

    printStage(1, "Display the system-health report");
    const healthReport = runCli(project, ["info"]);
    requireOutput(healthReport.stdout, /SYSTEM SENTINEL REPORT/, "the report heading");
    requireOutput(healthReport.stdout, /Health Status/, "the health section");

    printStage(2, "Create and read a code file containing quoted JavaScript");
    runCli(project, ["create", fileName, "--content", originalCode]);
    const readResult = runCli(project, ["read", fileName]);

    if (readResult.stdout.trimEnd() !== originalCode) {
      throw new Error("The quoted JavaScript content did not round-trip unchanged.");
    }

    printStage(3, "Save a before system snapshot");
    const beforeResult = runCli(project, [
      "snapshot",
      "save",
      beforeSnapshot,
    ]);
    requireOutput(beforeResult.stdout, /Snapshot saved:/, "snapshot confirmation");

    printStage(4, "Create a SHA-256 integrity baseline");
    const baselineResult = runCli(project, ["integrity", "baseline"]);
    requireOutput(baselineResult.stdout, /Algorithm: sha256/, "the SHA-256 algorithm");

    printStage(5, "Update the code file");
    const updateResult = runCli(project, [
      "update",
      fileName,
      "--content",
      updatedCode,
    ]);
    requireOutput(updateResult.stdout, /Updated:/, "the update confirmation");

    printStage(6, "Run an integrity check and detect the expected modification");
    const driftResult = runCli(
      project,
      ["integrity", "check"],
      { expectedStatus: 1 },
    );
    requireOutput(driftResult.stdout, /Modified/, "the modified-files section");

    if (!driftResult.stdout.includes(fileName)) {
      throw new Error("The integrity report did not identify the demo file.");
    }

    console.log(`Expected integrity drift detected for ${fileName}.`);

    printStage(7, "Save an after system snapshot");
    const afterResult = runCli(project, [
      "snapshot",
      "save",
      afterSnapshot,
    ]);
    requireOutput(afterResult.stdout, /Snapshot saved:/, "snapshot confirmation");

    printStage(8, "Compare the before and after snapshots");
    const comparisonResult = runCli(project, [
      "snapshot",
      "compare",
      beforeSnapshot,
      afterSnapshot,
    ]);
    requireOutput(
      comparisonResult.stdout,
      /SNAPSHOT COMPARISON|No differences found/,
      "a snapshot comparison result",
    );

    printStage(9, "Delete the demo code file");
    const deleteResult = runCli(project, ["delete", fileName]);
    requireOutput(deleteResult.stdout, /Deleted:/, "the delete confirmation");
  } catch (error) {
    demoError = error;
    throw error;
  } finally {
    try {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    } catch (cleanupError) {
      if (demoError) {
        console.error(`Temporary-project cleanup also failed: ${cleanupError.message}`);
      } else {
        throw cleanupError;
      }
    }
  }

  printStage(10, "Demo completed successfully");
  console.log("System health, safe file CRUD, snapshots, and SHA-256 drift detection all passed.");
  console.log("The isolated temporary project was removed; the real workspace was untouched.");
}

try {
  await runDemo();
} catch (error) {
  console.error(`\nDemo failed: ${error.message}`);
  process.exitCode = 1;
}
