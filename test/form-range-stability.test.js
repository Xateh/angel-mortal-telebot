"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");

function fixture(name, columns) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "FormImport.gs"), "utf8"), context);
  context.getFormResponseSheet_ = () => ({getName: () => name});
  context.readHeaderRow_ = () => [];
  context.mapFormColumns_ = () => columns;
  return context;
}

test("Form source ranges are string references anchored at row 2", () => {
  const context = fixture("Form Responses 1", {timestamp: 0, name: 1, telegramId: 26});
  const ranges = context.formFormulaRanges_();
  assert.equal(ranges.timestamp, 'INDIRECT("\'Form Responses 1\'!A2:A")');
  assert.equal(ranges.name, 'INDIRECT("\'Form Responses 1\'!B2:B")');
  assert.equal(ranges.telegramId, 'INDIRECT("\'Form Responses 1\'!AA2:AA")');
  // Native Sheets may rewrite direct A1 references on Form insertion. A string
  // argument has no rewritable A1 reference; live recalculation is a separate check.
  for (const range of Object.values(ranges)) {
    assert.match(range, /^INDIRECT\(".*2:[A-Z]+"\)$/);
  }
});

test("Form range literals escape sheet apostrophes and formula double quotes", () => {
  const context = fixture('Intake O\'Brien "A"', {timestamp: 2, name: 3});
  const ranges = context.formFormulaRanges_();
  assert.equal(ranges.timestamp, 'INDIRECT("\'Intake O\'\'Brien ""A""\'!C2:C")');
  assert.equal(ranges.name, 'INDIRECT("\'Intake O\'\'Brien ""A""\'!D2:D")');
});

test("Missing optional fields retain timestamp-shaped blank arrays", () => {
  const context = fixture("Responses", {timestamp: 0, name: 1, boundaries: -1});
  const ranges = context.formFormulaRanges_();
  assert.equal(ranges.boundaries, 'IF(ROW(INDIRECT("\'Responses\'!A2:A")),"","")');
});

test("Public room guidance uses symbolic placeholders, not event room examples", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config/form-schema.json"), "utf8"));
  const question = schema.questions.find(item => item.key === "room");
  assert.match(question.description, /#LL-RRR/);
  assert.doesNotMatch(question.description, /#\d{2}-\d{3}/);
});
