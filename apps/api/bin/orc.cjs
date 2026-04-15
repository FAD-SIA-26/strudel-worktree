#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const tsx = resolve(__dirname, "../node_modules/.bin/tsx");
const cli = resolve(__dirname, "../src/cli.ts");

const result = spawnSync(tsx, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 0);
