#!/usr/bin/env node

import { parseArgs } from "node:util";
import { collectSystemInfo } from "./systemInfo.js";
import { collectEnvironmentVariables } from "./environment.js";
import { analyzeHealth } from "./healthAnalyzer.js";
import {
  compareSnapshots,
  deleteSnapshot,
  listSnapshots,
  saveSnapshot,
  loadSnapshot,
} from "./snapshotManager.js";
import {
  checkIntegrity,
  saveBaseline,
} from "./integrityManager.js";
import {
  createCodeFile,
  deleteCodeFile,
  listCodeFiles,
  readCodeFile,
  updateCodeFile,
} from "./fileManager.js";
import {
  formatIntegrityBaseline,
  formatIntegrityReport,
  formatReport,
  formatSnapshot,
  formatSnapshotComparison,
  formatSnapshotList,
} from "./formatter.js";

function showHelp() {
  console.log(`
System Sentinel

Usage:
  npm start -- info
  npm start -- info --format json
  npm start -- snapshot save <name>
  npm start -- snapshot list
  npm start -- snapshot show <name>
  npm start -- snapshot compare <firstName> <secondName>
  npm start -- snapshot delete <name>
  npm start -- integrity baseline
  npm start -- integrity check
  npm start -- create <file> --content "<code>"
  npm start -- read <file>
  npm start -- update <file> --content "<code>"
  npm start -- delete <file>
  npm start -- list

Options:
  -c, --content <text>       Content for create or update
  -f, --format <text|json>   Select output format
  -h, --help                 Show this help message
`);
}

function printOperation(operation, result, format) {
  if (format === "json") {
    console.log(JSON.stringify({ success: true, operation, result }, null, 2));
    return;
  }

  console.log(result);
}

async function collectReport() {
  const system = await collectSystemInfo();

  return {
    generatedAt: new Date().toISOString(),
    system,
    health: analyzeHealth(system),
    environment: collectEnvironmentVariables(),
  };
}

function requireArgument(value, message) {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function formatSnapshotSave(snapshot, format) {
  const result = {
    name: snapshot.name,
    createdAt: snapshot.generatedAt,
    platform: snapshot.system?.machine?.platform ?? "Unavailable",
    health: snapshot.health?.overallStatus ?? "Unavailable",
  };

  if (format === "json") {
    return JSON.stringify(
      {
        success: true,
        operation: "snapshot save",
        result,
      },
      null,
      2,
    );
  }

  return [
    `Snapshot saved: ${result.name}`,
    `Created at: ${result.createdAt}`,
    `Platform: ${result.platform}`,
    `Health: ${result.health}`,
  ].join("\n");
}

function formatSnapshotDelete(result, format) {
  if (format === "json") {
    return JSON.stringify(
      {
        success: true,
        operation: "snapshot delete",
        result,
      },
      null,
      2,
    );
  }

  return `Snapshot deleted: ${result.name}`;
}

async function handleSnapshotCommand(action, firstName, secondName, format) {
  switch (action) {
    case "save": {
      const name = requireArgument(firstName, "A snapshot name is required.");
      const snapshot = await saveSnapshot(name, await collectReport());
      console.log(formatSnapshotSave(snapshot, format));
      break;
    }

    case "list":
      console.log(formatSnapshotList(await listSnapshots(), format));
      break;

    case "show": {
      const name = requireArgument(firstName, "A snapshot name is required.");
      console.log(formatSnapshot(await loadSnapshot(name), format));
      break;
    }

    case "compare": {
      const first = requireArgument(firstName, "The first snapshot name is required.");
      const second = requireArgument(secondName, "The second snapshot name is required.");
      console.log(formatSnapshotComparison(await compareSnapshots(first, second), format));
      break;
    }

    case "delete": {
      const name = requireArgument(firstName, "A snapshot name is required.");
      console.log(formatSnapshotDelete(await deleteSnapshot(name), format));
      break;
    }

    default:
      throw new Error(`Unknown snapshot command: ${action ?? "none"}`);
  }
}

async function handleIntegrityCommand(action, format) {
  switch (action) {
    case "baseline":
      console.log(formatIntegrityBaseline(await saveBaseline(), format));
      break;

    case "check": {
      const report = await checkIntegrity();
      console.log(formatIntegrityReport(report, format));

      if (report.hasDrift) {
        process.exitCode = 1;
      }

      break;
    }

    default:
      throw new Error(`Unknown integrity command: ${action ?? "none"}`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      content: {
        type: "string",
        short: "c",
      },
      format: {
        type: "string",
        short: "f",
        default: "text",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
  });

  if (values.help) {
    showHelp();
    return;
  }

  if (!["text", "json"].includes(values.format)) {
    throw new Error(`Unsupported output format: ${values.format}`);
  }
  const [command = "info", firstArg, secondArg, thirdArg] = positionals;

  switch (command) {
    case "info": {
      console.log(formatReport(await collectReport(), values.format));
      break;
    }

    case "snapshot":
      await handleSnapshotCommand(firstArg, secondArg, thirdArg, values.format);
      break;

    case "integrity":
      await handleIntegrityCommand(firstArg, values.format);
      break;

    case "create":
      printOperation(
        "create",
        await createCodeFile(firstArg, values.content ?? ""),
        values.format,
      );
      break;

    case "read":
      printOperation(
        "read",
        await readCodeFile(firstArg),
        values.format,
      );
      break;

    case "update":
      printOperation(
        "update",
        await updateCodeFile(firstArg, values.content ?? ""),
        values.format,
      );
      break;

    case "delete":
      printOperation(
        "delete",
        await deleteCodeFile(firstArg),
        values.format,
      );
      break;

    case "list": {
      const files = await listCodeFiles();
      const result = files.length ? files.join("\n") : "No code files found.";
      printOperation("list", result, values.format);
      break;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

try {
  await main();
} catch (error) {
  const isFriendlyError =
    error.isSnapshotError === true || error.isIntegrityError === true;

  if (isFriendlyError) {
    console.error(`Error: ${error.message}`);
  } else if (error.code === "ENOENT") {
    console.error("Error: The requested file does not exist.");
  } else if (error.code === "EEXIST") {
    console.error("Error: The file already exists.");
  } else {
    console.error(`Error: ${error.message}`);
  }

  process.exitCode = 1;
}
