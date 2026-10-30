"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const root = path.join(__dirname, "..");
test("gateway manifest and lockfile declare the patched Node 22 floor", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "gateway/package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "gateway/package-lock.json"), "utf8"));
  assert.equal(manifest.engines.node, ">=22.23.4");
  assert.equal(lock.packages[""].engines.node, manifest.engines.node);
});
test("rename recovery documents updating the stored response-tab name first", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /first update the `FORM_RESPONSES_SHEET_NAME` Script Property[^\n]+then rerun `setupProject`/);
});
