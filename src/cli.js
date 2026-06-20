#!/usr/bin/env node

import { parseArgs } from "node:util";
import { collectSystemInfo } from "./systemInfo.js";
import { collectEnvironmentVariables } from "./environment.js";
import {
  createCodeFile,
  deleteCodeFile,
  listCodeFiles,
  readCodeFile,
  updateCodeFile,
} from "./fileManager.js";
import { formatReport } from "./formatter.js";

function showHelp() {
  console.log(`
System Sentinel

Usage:
  npm start -- info
  npm start -- info --format json
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
  const [command = "info", fileName] = positionals;

  switch (command) {
    case "info": {
      const report = {
        generatedAt: new Date().toISOString(),
        system: collectSystemInfo(),
        environment: collectEnvironmentVariables(),
      };

      console.log(formatReport(report, values.format));
      break;
    }

    case "create":
      printOperation(
        "create",
        await createCodeFile(fileName, values.content ?? ""),
        values.format,
      );
      break;

    case "read":
      printOperation(
        "read",
        await readCodeFile(fileName),
        values.format,
      );
      break;

    case "update":
      printOperation(
        "update",
        await updateCodeFile(fileName, values.content ?? ""),
        values.format,
      );
      break;

    case "delete":
      printOperation(
        "delete",
        await deleteCodeFile(fileName),
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
  if (error.code === "ENOENT") {
    console.error("Error: The requested file does not exist.");
  } else if (error.code === "EEXIST") {
    console.error("Error: The file already exists.");
  } else {
    console.error(`Error: ${error.message}`);
  }

  process.exitCode = 1;
}