"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createCoreFixture() {
let nextSheetId = 0;
class MemoryRange {
  constructor(sheet, row, column, rows = 1, columns = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rows = rows;
    this.columns = columns;
  }
  getValues() {
    return Array.from({length: this.rows}, (_, r) =>
      Array.from({length: this.columns}, (_, c) =>
        this.sheet.formula(this.row + r, this.column + c) || this.sheet.cell(this.row + r, this.column + c)
      )
    );
  }
  getDisplayValues() {
    return Array.from({length: this.rows}, (_, r) =>
      Array.from({length: this.columns}, (_, c) => {
        const value = this.sheet.cell(this.row + r, this.column + c);
        return value == null ? "" : String(value);
      })
    );
  }
  setValues(values) {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.columns; c += 1) {
        this.sheet.setCell(this.row + r, this.column + c, values[r][c]);
      }
    }
    return this;
  }
  getFormula() {
    return this.sheet.formula(this.row, this.column);
  }
  setFormula(value) {
    this.sheet.setFormula(this.row, this.column, value);
    return this;
  }
  setFormulas(values) {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.columns; c += 1) {
        this.sheet.setFormula(this.row + r, this.column + c, values[r][c]);
      }
    }
    return this;
  }
  setValue(value) {
    this.sheet.setCell(this.row, this.column, value);
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.columns; c += 1) {
        this.sheet.setCell(this.row + r, this.column + c, "");
        this.sheet.setFormula(this.row + r, this.column + c, "");
      }
    }
    return this;
  }
  clearDataValidations() {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.columns; c += 1) this.sheet.validations.delete(`${this.row + r}:${this.column + c}`);
    }
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground(value) { this.sheet.backgrounds.set(`${this.row}:${this.column}`, value); return this; }
  setBackgrounds() { return this; }
  setFontColor() { return this; }
  setFontColors() { return this; }
  setWrap() { return this; }
  setNote(value) { this.sheet.notes.set(`${this.row}:${this.column}`, value); return this; }
  setDataValidation(value) {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.columns; c += 1) this.sheet.validations.set(`${this.row + r}:${this.column + c}`, value);
    }
    return this;
  }
  createFilter() { this.sheet.filter = {}; return this.sheet.filter; }
  getSheet() { return this.sheet; }
  getColumn() { return this.column; }
  getNumColumns() { return this.columns; }
  getRow() { return this.row; }
  getNumRows() { return this.rows; }
}

class MemorySheet {
  constructor(name) {
    this.name = name;
    this.values = [];
    this.formulas = [];
    this.maxColumns = 26;
    this.sheetId = ++nextSheetId;
    this.conditionalFormatRules = [];
    this.filter = null;
    this.backgrounds = new Map();
    this.notes = new Map();
    this.validations = new Map();
    this.frozenRows = 0;
    this.hiddenColumns = new Set();
    this.mutationCount = 0;
  }
  cell(row, column) {
    return (this.values[row - 1] || [])[column - 1] ?? "";
  }
  setDisplayedValue(row, column, value) {
    while (this.values.length < row) this.values.push([]);
    while (this.values[row - 1].length < column) this.values[row - 1].push("");
    this.values[row - 1][column - 1] = value;
  }
  setCell(row, column, value) {
    while (this.values.length < row) this.values.push([]);
    while (this.values[row - 1].length < column) this.values[row - 1].push("");
    this.values[row - 1][column - 1] = value;
    this.setFormula(row, column, "");
    this.mutationCount += 1;
  }
  formula(row, column) {
    return (this.formulas[row - 1] || [])[column - 1] || "";
  }
  setFormula(row, column, value) {
    while (this.formulas.length < row) this.formulas.push([]);
    while (this.formulas[row - 1].length < column) this.formulas[row - 1].push("");
    this.formulas[row - 1][column - 1] = value;
    this.mutationCount += 1;
  }
  getRange(row, column, rows, columns) {
    if (typeof row === "string") {
      const letter = row.match(/[A-Z]+/)[0];
      const rowNumber = Number(row.match(/\d+/)[0]);
      let col = 0;
      for (const char of letter) col = col * 26 + char.charCodeAt(0) - 64;
      return new MemoryRange(this, rowNumber, col, 1, 1);
    }
    return new MemoryRange(this, row, column, rows || 1, columns || 1);
  }
  getLastRow() {
    for (let row = this.values.length; row >= 1; row -= 1) {
      if ((this.values[row - 1] || []).some(value => value !== "" && value != null)) return row;
    }
    return 0;
  }
  getLastColumn() {
    let result = 0;
    this.values.forEach(row => {
      for (let column = row.length; column >= 1; column -= 1) {
        if (row[column - 1] !== "" && row[column - 1] != null) {
          result = Math.max(result, column);
          break;
        }
      }
    });
    return result;
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), this.maxColumns); }
  getMaxColumns() { return this.maxColumns; }
  getMaxRows() { return 1000; }
  getName() { return this.name; }
  getSheetId() { return this.sheetId; }
  insertColumnsAfter(_after, count) { this.maxColumns += count; }
  insertRowsAfter() {}
  getConditionalFormatRules() { return this.conditionalFormatRules.slice(); }
  setConditionalFormatRules(rules) { this.conditionalFormatRules = rules.slice(); }
  getFilter() { return this.filter; }
  setFrozenRows(value) { this.frozenRows = value; }
  showColumns() {}
  hideColumns(column, count = 1) {
    for (let offset = 0; offset < count; offset += 1) this.hiddenColumns.add(column + offset);
  }
  autoResizeColumns() {}
  setColumnWidth() {}
}

class MemorySpreadsheet {
  constructor(id = "spreadsheet-test-id") {
    this.id = id;
    this.sheets = new Map();
    this.toasts = [];
  }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const sheet = new MemorySheet(name);
    sheet.spreadsheet = this;
    this.sheets.set(name, sheet);
    return sheet;
  }
  toast(message) { this.toasts.push(message); }
}

const spreadsheet = new MemorySpreadsheet();
const spreadsheets = new Map([[spreadsheet.id, spreadsheet]]);
const properties = new Map();
const cache = new Map();
const createdTriggers = [];
let uuidCounter = 0;

const liveFormHeaders = [
  "Timestamp", "What’s your name? 👀", "Gender?", "What’s your room no.! [#LL-RRR]🤌",
  "What’s your tele handle? [@…] 💅", "What’s your tele Telegram user id?",
  "What’s your year of study?", "Which faculty are you from!", "Share some of your interests! ✍️",
  "Do you have any special requirements? (e.g. allergies, etc.) ", "Any gender preference for A&M? 🤔",
  "Angel and Mortal (welfare only) or Devil and Mortal (welfare and pranks)?", "Level of Prank Tolerance",
  "Are you okay with your devil entering your room?", "Please specify any boundaries/things that are off limits for your devil [Tick to indicate OFF LIMIT]",
  "I have looked through and understood the rules of this event and agree to respect the boundaries set by my mortal."
];
const liveFormSheet = spreadsheet.insertSheet("Form Responses 1");
liveFormSheet.getRange(1, 1, 4, 16).setValues([
  liveFormHeaders,
  ["8/27/2026 08:00:00", "Alice", "Female", "21-01", "@alice", "10001", "Year 1", "Computing", "Tea", "", "", "Angel and Mortal 👼", "", "", "", "I have understood the rules."],
  ["8/27/2026 08:01:00", "Bob", "Male", "21-02", "@bob", "20002", "Year 2", "Science", "Cats", "", "", "Devil and Mortal 😈", "4", "heck yea", "Valuables", "I have understood the rules."],
  ["8/27/2026 08:02:00", "Charlie", "Male", "21-03", "@charlie", "30003", "Year 3", "Arts", "Chess", "", "", "Angel and Mortal 👼", "", "", "", "I have understood the rules."]
]);
properties.set("SPREADSHEET_ID", spreadsheet.id);
properties.set("FORM_RESPONSES_SPREADSHEET_ID", spreadsheet.id);
properties.set("FORM_RESPONSES_SHEET_NAME", "Form Responses 1");

const propertyService = {
  getProperty(name) { return properties.get(name) || null; },
  setProperty(name, value) { properties.set(name, String(value)); return this; },
  deleteProperty(name) { properties.delete(name); return this; },
  setProperties(values) { Object.entries(values).forEach(([k, v]) => properties.set(k, String(v))); return this; }
};

const ui = {
  ButtonSet: {OK: "OK"},
  createMenu() { return {addItem() { return this; }, addSeparator() { return this; }, addToUi() { return this; }}; },
  alert() { return "OK"; }
};

const scriptApp = {
  createdTriggers,
  getService: () => ({getUrl: () => "https://script.google.com/macros/s/test/exec"}),
  getProjectTriggers: () => [],
  deleteTrigger() {},
  newTrigger: handler => ({
    forSpreadsheet() { return this; },
    onFormSubmit() { return this; },
    onEdit() { return this; },
    create() { createdTriggers.push(handler); return {}; }
  })
};

const context = vm.createContext({
  console,
  PropertiesService: {getScriptProperties: () => propertyService},
  SpreadsheetApp: {
    getActiveSpreadsheet: () => spreadsheet,
    getActive: () => spreadsheet,
    openById: id => {
      const result = spreadsheets.get(id);
      if (!result) throw new Error(`Unknown spreadsheet: ${id}`);
      return result;
    },
    getUi: () => ui,
    newDataValidation: () => {
      const rule = {};
      return {
        requireValueInRange(range) { rule.sourceRange = range; return this; },
        setAllowInvalid(value) { rule.allowInvalid = value; return this; },
        setHelpText(value) { rule.helpText = value; return this; },
        build() { return rule; }
      };
    },
    newConditionalFormatRule: () => {
      const rule = {ranges: [], formula: ""};
      return {
        whenFormulaSatisfied(formula) { rule.formula = formula; return this; },
        setBackground() { return this; },
        setFontColor() { return this; },
        setBold() { return this; },
        setRanges(ranges) { rule.ranges = ranges; return this; },
        build() { return {getRanges: () => rule.ranges, formula: rule.formula}; }
      };
    }
  },
  Utilities: {
    getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
    sleep() {}
  },
  LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
  CacheService: {getScriptCache: () => ({
    get: key => cache.get(key) || null,
    put: (key, value) => cache.set(key, value),
    remove: key => cache.delete(key)
  })},
  ContentService: {
    MimeType: {TEXT: "text", JSON: "json"},
    createTextOutput: text => ({text, mime: null, setMimeType(mime) { this.mime = mime; return this; }})
  },
  ScriptApp: scriptApp,
  UrlFetchApp: {fetch() { throw new Error("Unexpected live network request in tests"); }}
});

const root = path.resolve(__dirname, "../..");
for (const file of ["FormSetup.gs", "Config.gs", "Storage.gs", "FormImport.gs", "Telegram.gs", "Game.gs", "Admin.gs", "Code.gs"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  new vm.Script(source, {filename: path.join(root, file)}).runInContext(context);
}

function seedCalculatedRosterIdentities() {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  if (!roster) return;
  [
    [2, "10001", "form:spreadsheet-test-id:2"],
    [3, "20002", "form:spreadsheet-test-id:3"],
    [4, "30003", "form:spreadsheet-test-id:4"]
  ].forEach(([row, telegramId, personId]) => {
    roster.setDisplayedValue(row, 14, telegramId);
    roster.setDisplayedValue(row, 15, personId);
  });
}

function setupProject() {
  const result = context.setupProject();
  seedCalculatedRosterIdentities();
  return result;
}

return {MemoryRange, MemorySheet, MemorySpreadsheet, spreadsheet, spreadsheets, properties, cache, createdTriggers, liveFormHeaders, liveFormSheet, propertyService, ui, scriptApp, context, setupProject, seedCalculatedRosterIdentities};
}
module.exports = {createCoreFixture};
