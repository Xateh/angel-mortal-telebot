"use strict";
// One c8 parent keeps coverage from the legacy runner and both Node test suites.
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const files = dir => fs.readdirSync(path.join(root, dir)).filter(name => /\.test\.(?:js|mjs)$/.test(name)).sort().map(name => path.join(dir,name));
for (const args of [["test/run-tests.js"], ["--test", ...files("test")], ["--test", ...files("gateway/test")]]) {
  const result = spawnSync(process.execPath, args, {cwd:root, stdio:"inherit"});
  if (result.status !== 0) process.exit(result.status || 1);
}
