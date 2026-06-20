#!/usr/bin/env node

import { parseArgs } from "node:util";
import { collectSystemInfo } from "./systemInfo.js";
import { collectEnvironmentVariables } from "./environment.js";
import { formatReport } from "./formatter.js";

function showHelp() {
  console.log(`
System Sentinel

Usage:
  npm start
  npm start -- --format json

Options:
  -f, --format <text|json>   Select output format
  -h, --help                 Show this help message
`);
}

function main() {
  const { values } = parseArgs({
    options: {
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

  const report = {
    generatedAt: new Date().toISOString(),
    system: collectSystemInfo(),
    environment: collectEnvironmentVariables(),
  };

  console.log(formatReport(report, values.format));
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}