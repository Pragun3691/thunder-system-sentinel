import test from "node:test";
import assert from "node:assert/strict";
import { collectSystemInfo } from "../src/systemInfo.js";
import { collectEnvironmentVariables } from "../src/environment.js";

test("collectSystemInfo returns the required system details", () => {
  const info = collectSystemInfo();

  assert.equal(typeof info.operatingSystem.type, "string");
  assert.equal(typeof info.cpu.architecture, "string");
  assert.equal(typeof info.machine.hostname, "string");
  assert.equal(typeof info.machine.platform, "string");
  assert.equal(typeof info.machine.homeDirectory, "string");
  assert.match(info.runtime.nodeVersion, /^v\d+/);
});

test("environment collection uses a safe allowlist", () => {
  const environment = collectEnvironmentVariables();

  assert.equal(Object.hasOwn(environment, "OS"), true);
  assert.equal(Object.hasOwn(environment, "PATH"), false);
  assert.equal(Object.hasOwn(environment, "API_KEY"), false);
  assert.equal(Object.hasOwn(environment, "PASSWORD"), false);
});