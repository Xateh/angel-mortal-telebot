"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
    this.sheetId = Math.floor(Math.random() * 1000000) + 1;
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

const root = path.resolve(__dirname, "..");
for (const file of ["FormSetup.gs", "Config.gs", "Storage.gs", "FormImport.gs", "Telegram.gs", "Game.gs", "Admin.gs", "Code.gs"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  new vm.Script(source, {filename: file}).runInContext(context);
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

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

test("project setup creates a separate roster tab in the response workbook", () => {
  const result = setupProject();
  assert.equal(properties.get("SPREADSHEET_ID"), spreadsheet.id);
  assert.equal(properties.get("ANGEL_WEBHOOK_KEY").length, 64);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {total: 3, ready: 0, review: 3, registered: 3});
  const rosterSheet = spreadsheet.getSheetByName("Angel Mortal Roster");
  assert.ok(rosterSheet);
  const headers = rosterSheet.getRange(1, 1, 1, 21).getDisplayValues()[0];
  assert.deepEqual(Array.from(headers), Array.from(context.ROSTER_HEADERS));
  assert.equal(spreadsheet.getSheetByName("Participants"), null);
  assert.equal(spreadsheet.getSheetByName("Form Intake (Private)"), null);
});

test("roster uses one spill formula per generated column", () => {
  setupProject();
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const generatedColumns = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21];
  generatedColumns.forEach(column => {
    const formula = roster.getRange(2, column).getFormula();
    assert.notEqual(formula, "", `missing row-2 formula in column ${column}`);
    assert.equal(roster.getRange(3, column).getFormula(), "", `copied formula in row 3, column ${column}`);
    let depth = 0;
    let quoted = false;
    for (let index = 0; index < formula.length; index += 1) {
      if (formula[index] === '"') {
        if (quoted && formula[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && formula[index] === "(") depth += 1;
      else if (!quoted && formula[index] === ")") depth -= 1;
      assert.ok(depth >= 0, `unexpected closing parenthesis in column ${column}`);
    }
    assert.equal(quoted, false, `unterminated string in column ${column}`);
    assert.equal(depth, 0, `unbalanced parentheses in column ${column}`);
  });
  assert.equal(roster.getRange("N2").getFormula().includes("FILTER("), true);
  assert.equal(roster.getRange("N3").getFormula(), "");
  [7, 19, 20].forEach(column => assert.equal(roster.getRange(2, column).getFormula(), ""));
  for (let column = 8; column <= 13; column += 1) {
    assert.match(roster.getRange(2, column).getFormula(), /^=MAP\(/);
  }
  const formulas = generatedColumns.map(column => roster.getRange(2, column).getFormula()).join("\n");
  assert.match(formulas, /'Form Responses 1'![A-Z]+2:[A-Z]+/);
  assert.match(formulas, /IFNA\(|IF\(timestamp="",""/);
  assert.doesNotMatch(formulas, /Angel Mortal Roster - Snapshot/);
  assert.match(context.rosterSpillFormulas_("preserved-namespace:")[15], /"preserved-namespace:"/);
});

test("spill formulas use parser-equivalent edge normalization for Form text", () => {
  const columns = {
    timestamp: 0,
    name: 1,
    gender: 2,
    room: 3,
    telegramHandle: 4,
    telegramId: 5,
    year: 6,
    faculty: 7,
    interests: 8,
    specialRequirements: 9,
    genderPreference: 10,
    mode: 11,
    prankTolerance: 12,
    roomEntry: 13,
    boundaries: 14,
    declaration: 15
  };
  const response = context.parseFormResponse_([
    " 2026-09-04 12:00 ",
    "  Mary   Jane  ",
    "  Woman  ",
    "  #01-001  ",
    "  @example  ",
    "  123 45  ",
    "  Year  2  ",
    "  Faculty  ",
    "  Board   games  ",
    "  None  ",
    "  No preference  ",
    "  Devil and Mortal (welfare and pranks)  ",
    "  3  ",
    "  Ask first  ",
    "  No   food  ",
    "  Accepted  "
  ], 2, columns);
  assert.equal(response.name, "Mary   Jane");
  assert.equal(response.interests, "Board   games");
  assert.equal(response.telegramId, "12345");
  assert.equal(response.mode, "Devil");

  const ranges = context.formFormulaRanges_();
  const formulas = context.rosterSpillFormulas_("form:test:");
  const edgeTrimmed = source => `REGEXREPLACE(TO_TEXT(${source}),"^\\s+|\\s+$","")`;
  const expectedByColumn = {
    1: ["name"],
    2: ["name"],
    3: ["room"],
    4: ["mode"],
    5: ["prankTolerance"],
    6: ["genderPreference"],
    16: ["year", "faculty", "interests", "specialRequirements", "mode", "prankTolerance", "roomEntry", "boundaries"],
    21: ["name", "room", "mode", "declaration", "prankTolerance", "roomEntry"]
  };
  Object.entries(expectedByColumn).forEach(([column, fields]) => {
    fields.forEach(field => {
      assert.ok(
        formulas[column].includes(edgeTrimmed(ranges[field])),
        `column ${column} must edge-trim ${field}`
      );
    });
  });
  assert.doesNotMatch(formulas[21], /LOWER\(TRIM\(/);
  assert.doesNotMatch(formulas[18], /REGEXREPLACE\(TO_TEXT\(/);
  assert.match(formulas[14], /REGEXREPLACE\(TO_TEXT\([^)]*\),"\\s",""\)/);
});

test("setup installs no spreadsheet triggers", () => {
  setupProject();
  assert.deepEqual(scriptApp.createdTriggers, []);
});

test("roster keeps append-only guidance and native Sheet controls", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  assert.equal(roster.backgrounds.get("1:7"), "#f1c232");
  assert.match(roster.notes.get("1:1"), /append-only/i);
  assert.match(roster.notes.get("1:7"), /filter views/i);
  assert.equal(roster.frozenRows, 1);
  assert.ok(roster.getFilter());
  assert.deepEqual(Array.from(roster.hiddenColumns).sort((a, b) => a - b), [15, 17, 21]);
  assert.equal(roster.getConditionalFormatRules().length, 5);
  const mortalRule = roster.validations.get("2:7");
  assert.equal(mortalRule.sourceRange.getColumn(), 1);
  assert.equal(mortalRule.allowInvalid, false);
});

test("sync is read-only", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const mutations = roster.mutationCount;
  context.syncParticipants_();
  assert.equal(roster.mutationCount, mutations);
});

test("setup preserves the form-owned response columns and values", () => {
  assert.equal(liveFormSheet.getLastColumn(), 16);
  assert.deepEqual(Array.from(liveFormSheet.getRange(1, 1, 1, 16).getDisplayValues()[0]), liveFormHeaders);
  assert.equal(liveFormSheet.getRange(2, 2).getDisplayValues()[0][0], "Alice");
  assert.equal(liveFormSheet.getRange(3, 6).getDisplayValues()[0][0], "20002");
});

test("separate roster classifies Angel and Devil responses from the form", () => {
  const participants = Array.from(context.readParticipants_());
  assert.equal(participants.length, 3);
  assert.equal(participants[0].mode, "Angel");
  assert.equal(participants[1].mode, "Devil");
  assert.match(participants[0].intro, /welfare only; no pranks/i);
  assert.match(participants[1].intro, /Prank tolerance: 4\/5/);
  assert.match(participants[1].intro, /Off limits: Valuables/);
});

test("Google Form intake blocks duplicate Telegram IDs for review", () => {
  const headers = [
    "Timestamp", "What’s your name? 👀", "Gender?", "What’s your room no.! [#LL-RRR]🤌",
    "What’s your tele handle? [@…] 💅", "What’s your tele Telegram user id?",
    "What’s your year of study?", "Which faculty are you from!", "Share some of your interests! ✍️",
    "Do you have any special requirements?", "Any gender preference for A&M? 🤔",
    "Angel and Mortal (welfare only) or Devil and Mortal (welfare and pranks)?", "Level of Prank Tolerance",
    "Are you okay with your devil entering your room?", "Please specify any boundaries/things that are off limits for your devil",
    "I have looked through and understood the rules"
  ];
  const columns = context.mapFormColumns_(headers);
  const first = context.parseFormResponse_(["now", "One", "Female", "1", "@oneaa", "50001", "Year 1", "F", "I", "", "", "Angel and Mortal 👼", "", "", "", "yes"], 2, columns);
  const second = context.parseFormResponse_(["later", "Two", "Male", "2", "@twoaa", "50001", "Year 2", "F", "I", "", "", "Angel and Mortal 👼", "", "", "", "yes"], 3, columns);
  context.addDuplicateIssues_([first, second], "telegramId", "Telegram ID", value => String(value || ""));
  assert.equal(first.status, "Review");
  assert.equal(second.status, "Review");
  assert.match(first.issues.join("; "), /Duplicate Telegram ID/);
});

test("sync validates manual one-to-one pairings and derives Angel or Devil roles", () => {
  const sheet = spreadsheet.getSheetByName("Form Responses 1");
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const initial = Array.from(context.readParticipants_());
  const byNameBefore = Object.fromEntries(initial.map(p => [p.name, p]));
  roster.getRange(2, 7, 3, 1).setValues([
    [byNameBefore.Bob.key],
    [byNameBefore.Charlie.key],
    [byNameBefore.Alice.key]
  ]);
  const result = context.syncParticipants_();
  assert.equal(result.total, 3);
  assert.equal(result.ready, 3);
  const participants = Array.from(context.validateParticipants_().participants);
  assert.equal(new Set(participants.map(p => p.personId)).size, 3);
  const byName = Object.fromEntries(participants.map(p => [p.name, p]));
  assert.equal(byName.Alice.mortalId, byName.Bob.personId);
  assert.equal(byName.Alice.angelId, byName.Charlie.personId);
  assert.equal(byName.Alice.roleToMortal, "Devil");
  assert.equal(byName.Alice.mortalPrankTolerance, "4");
  assert.equal(byName.Alice.assignmentFit, "CHECK · DEVIL ?→4");
  assert.equal(byName.Bob.roleToMortal, "Angel");
  const formulaRow = roster.getRange(2, 8, 1, 6).getValues()[0];
  assert.match(formulaRow[0], /XLOOKUP/);
  assert.match(formulaRow[2], /GOOD · DEVIL/);
  assert.match(formulaRow[5], /Appears as a mortal/);
});

test("append-only roster state is preserved by Telegram ID", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const participants = context.buildParticipantsFromForm_();
  const byName = Object.fromEntries(participants.map(p => [p.name, p]));
  roster.getRange(2, 7, 3, 1).setValues([
    [byName.Bob.key],
    [byName.Charlie.key],
    [byName.Alice.key]
  ]);
  roster.getRange(2, 19, 3, 2).setValues([
    ["alice-angel", "alice-mortal"],
    ["bob-angel", "bob-mortal"],
    ["charlie-angel", "charlie-mortal"]
  ]);
  const preserved = Object.fromEntries(context.buildParticipantsFromForm_().map(p => [p.telegramId, p]));
  assert.equal(preserved["10001"].mortalSelection, byName.Bob.key);
  assert.equal(preserved["10001"].angelBotStartedAt, "alice-angel");
  assert.equal(preserved["10001"].mortalBotStartedAt, "alice-mortal");
  assert.equal(preserved["30003"].rowNumber, 4);
});

test("bot-start timestamps write to the participant's current append-only row", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  roster.getRange(2, 20, 3, 1).clearContent();
  const charlie = context.findParticipantByTelegramId_("30003", context.readParticipants_());
  try {
    context.markParticipantBotStarted_(charlie, "mortal");
    assert.equal(roster.getRange(2, 20).getValues()[0][0], "");
    assert.ok(roster.getRange(4, 20).getValues()[0][0]);
  } finally {
    roster.getRange(2, 20, 3, 1).clearContent();
  }
});

test("pairing validation rejects self-pairing, duplicate mortals, and missing mortals", () => {
  const sheet = spreadsheet.getSheetByName("Angel Mortal Roster");
  const participants = Array.from(context.readParticipants_());
  const byName = Object.fromEntries(participants.map(p => [p.name, p]));
  const mortalColumn = context.getRosterLayout_(sheet).columns.Mortal;
  sheet.getRange(2, mortalColumn, 3, 1).setValues([
    [byName.Alice.key],
    [byName.Alice.key],
    [""]
  ]);
  const invalid = context.syncParticipants_();
  assert.ok(invalid.review >= 1);
  assert.throws(() => context.validateParticipants_(), /need pairing review/i);
  const issues = context.readParticipants_().flatMap(participant => Array.from(participant.issues)).join("; ");
  assert.match(issues, /cannot be their own mortal/i);
  assert.match(issues, /Choose a mortal/i);
  assert.match(issues, /expected exactly once/i);

  sheet.getRange(2, mortalColumn, 3, 1).setValues([
    [byName.Bob.key],
    [byName.Charlie.key],
    [byName.Alice.key]
  ]);
  assert.equal(context.syncParticipants_().ready, 3);
});

function captureParticipantUpdates(bot, updates) {
  const relays = [];
  const sent = [];
  const originalRelay = context.relayTelegramMessage_;
  const originalSend = context.telegramSendMessage_;
  context.relayTelegramMessage_ = (...args) => relays.push(args);
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    updates.forEach(update => context.handleParticipantUpdate_(bot, update));
  } finally {
    context.relayTelegramMessage_ = originalRelay;
    context.telegramSendMessage_ = originalSend;
  }
  return {relays, sent};
}

test("support guidance reads trimmed Script Property handles with a generic fallback", () => {
  try {
    properties.delete("SUPPORT_HANDLES");
    assert.deepEqual(Array.from(context.supportHandles_()), ["@organiser"]);
    assert.equal(context.organiserHelpText_(), "If you face any issues, message @organiser.");

    properties.set("SUPPORT_HANDLES", " @helper_one, , @helper_two ");
    assert.deepEqual(Array.from(context.supportHandles_()), ["@helper_one", "@helper_two"]);
    assert.equal(context.organiserHelpText_(), "If you face any issues, message @helper_one or @helper_two.");

    properties.set("SUPPORT_HANDLES", "@first, @second, @third");
    assert.equal(context.organiserHelpText_(), "If you face any issues, message @first, @second, or @third.");

    properties.set("SUPPORT_HANDLES", " , ");
    assert.deepEqual(Array.from(context.supportHandles_()), ["@organiser"]);
  } finally {
    properties.delete("SUPPORT_HANDLES");
  }
});

test("duplicate sender Telegram IDs cannot relay or write bot-start state", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const originalBotState = roster.getRange(2, 19, 3, 2).getValues();
  liveFormSheet.getRange(5, 1, 1, 16).setValues([[
    "8/27/2026 08:03:00", "Duplicate", "Female", "21-04", "@duplicate", "10001", "Year 1", "Computing", "", "", "", "Angel and Mortal 👼", "", "", "", "I have understood the rules."
  ]]);
  roster.getRange(2, 19).clearContent();
  roster.getRange(4, 20).setValue("ready");
  const mutations = roster.mutationCount;
  try {
    const result = captureParticipantUpdates("angel", [
      {update_id: 901, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/start"}},
      {update_id: 902, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "ambiguous sender"}}
    ]);
    assert.equal(result.relays.length, 0);
    assert.equal(result.sent.length, 2);
    assert.equal(roster.mutationCount, mutations);
    assert.equal(roster.getRange(2, 19).getValues()[0][0], "");
    assert.match(result.sent.map(entry => entry[2]).join("\n"), /could not match|ambiguous/i);
    assert.match(result.sent.map(entry => entry[2]).join("\n"), /@organiser/);
  } finally {
    liveFormSheet.getRange(5, 1, 1, 16).clearContent();
    roster.getRange(2, 19, 3, 2).setValues(originalBotState);
  }
});

for (const [bot, targetRow, targetId, receivingBot] of [
  ["mortal", 3, "20002", "angel"],
  ["angel", 4, "30003", "mortal"]
]) {
  test(`${bot} bot blocks duplicate recipient IDs until the next current lookup is unique`, () => {
    const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
    const originalMappings = roster.getRange(2, 7, 3, 1).getValues();
    const originalBotState = roster.getRange(2, 19, 3, 2).getValues();
    const duplicate = liveFormSheet.getRange(targetRow, 1, 1, 16).getValues()[0];
    duplicate[1] = "Duplicate recipient";
    roster.getRange(2, 7, 3, 1).setValues([["Bob [20002]"], ["Charlie [30003]"], ["Alice [10001]"]]);
    roster.getRange(2, 19, 3, 2).setValues([["ready", "ready"], ["ready", "ready"], ["ready", "ready"]]);
    const update = text => ({update_id: 903, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text}});
    try {
      const before = captureParticipantUpdates(bot, [update("before duplicate")]);
      assert.equal(before.relays.length, 1);
      assert.deepEqual(before.relays[0].slice(0, 3), [bot, receivingBot, targetId]);

      liveFormSheet.getRange(5, 1, 1, 16).setValues([duplicate]);
      roster.setDisplayedValue(5, 14, targetId);
      roster.setDisplayedValue(5, 15, "form:spreadsheet-test-id:5");
      const mutations = roster.mutationCount;
      for (const text of bot === "mortal" ? ["blocked message", "/start", "/mortal"] : ["blocked message", "/start"]) {
        const blocked = captureParticipantUpdates(bot, [update(text)]);
        assert.equal(blocked.relays.length, 0, `${text} must not reach an ambiguous recipient`);
        assert.equal(blocked.sent.length, 1, "send one failure to the sender, not a partner notification");
        assert.deepEqual(blocked.sent[0].slice(0, 2), [bot, "10001"]);
        assert.match(blocked.sent[0][2], /pairing.*updated/i);
        assert.match(blocked.sent[0][2], /@organiser/);
        assert.equal(roster.mutationCount, mutations, "do not register a bot start for an ambiguous route");
      }

      liveFormSheet.getRange(5, 1, 1, 16).clearContent();
      roster.getRange(5, 14, 1, 2).clearContent();
      const restored = captureParticipantUpdates(bot, [update("after duplicate resolved")]);
      assert.equal(restored.relays.length, 1);
      assert.deepEqual(restored.relays[0].slice(0, 3), [bot, receivingBot, targetId]);
    } finally {
      liveFormSheet.getRange(5, 1, 1, 16).clearContent();
      roster.getRange(5, 14, 1, 2).clearContent();
      roster.getRange(2, 7, 3, 1).setValues(originalMappings);
      roster.getRange(2, 19, 3, 2).setValues(originalBotState);
    }
  });
}

test("public health errors omit participant names and pairing diagnostics", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const originalMappings = roster.getRange(2, 7, 3, 1).getValues();
  roster.getRange(2, 7, 3, 1).clearContent();
  try {
    assert.throws(() => context.validateParticipants_(), /Alice:/, "organizer validation keeps details");
    const response = JSON.parse(context.doGet().text);
    assert.equal(response.ok, false);
    assert.equal(response.service, "angel-mortal");
    assert.ok(response.error);
    assert.doesNotMatch(JSON.stringify(response), /Alice|Bob|Charlie|Choose a mortal|10001|20002|30003/);
  } finally {
    roster.getRange(2, 7, 3, 1).setValues(originalMappings);
  }
});

test("public health errors omit private backend exception details", () => {
  const originalOpen = context.SpreadsheetApp.openById;
  context.SpreadsheetApp.openById = () => { throw new Error("private-resource-diagnostic"); };
  try {
    const response = JSON.parse(context.doGet().text);
    assert.equal(response.ok, false);
    assert.ok(response.error);
    assert.doesNotMatch(JSON.stringify(response), /private-resource-diagnostic/);
  } finally {
    context.SpreadsheetApp.openById = originalOpen;
  }
});

test("public health still reports aggregate readiness for a valid roster", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const originalMappings = roster.getRange(2, 7, 3, 1).getValues();
  roster.getRange(2, 7, 3, 1).setValues([["Bob [20002]"], ["Charlie [30003]"], ["Alice [10001]"]]);
  try {
    assert.deepEqual(JSON.parse(context.doGet().text), {ok: true, service: "angel-mortal", participants: 3, registered: 3});
  } finally {
    roster.getRange(2, 7, 3, 1).setValues(originalMappings);
  }
});

function assertInvalidMortalSelectionFailsClosed(selection) {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const originalMappings = roster.getRange(2, 7, 3, 1).getValues();
  const originalBotState = roster.getRange(2, 19, 3, 2).getValues();
  const participants = context.readParticipants_();
  const byName = Object.fromEntries(participants.map(participant => [participant.name, participant]));
  roster.getRange(2, 7, 3, 1).setValues([[selection], [byName.Charlie.key], [byName.Alice.key]]);
  roster.getRange(2, 20).clearContent();
  roster.getRange(3, 19).setValue("ready");
  const mutations = roster.mutationCount;
  try {
    const result = captureParticipantUpdates("mortal", [
      {update_id: 910, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/start"}},
      {update_id: 911, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "invalid selection"}}
    ]);
    assert.equal(result.relays.length, 0);
    assert.equal(result.sent.length, 2);
    assert.equal(roster.mutationCount, mutations);
    assert.equal(roster.getRange(2, 20).getValues()[0][0], "");
    const feedback = result.sent.map(entry => entry[2]).join("\n");
    assert.match(feedback, /not sent|being updated/i);
    assert.match(feedback, /@organiser/);
  } finally {
    roster.getRange(2, 7, 3, 1).setValues(originalMappings);
    roster.getRange(2, 19, 3, 2).setValues(originalBotState);
  }
}

test("stale mortal labels fail closed", () => {
  assertInvalidMortalSelectionFailsClosed("Former Bob [20002]");
});

test("raw mortal IDs fail closed", () => {
  assertInvalidMortalSelectionFailsClosed("20002");
  assertInvalidMortalSelectionFailsClosed("form:spreadsheet-test-id:3");
});

test("mortal names fail closed", () => {
  assertInvalidMortalSelectionFailsClosed("Bob");
});

test("timestampless partial rows do not shift bot-start writes", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const originalMappings = roster.getRange(2, 7, 3, 1).getValues();
  const originalBotState = roster.getRange(2, 19, 3, 2).getValues();
  liveFormSheet.getRange(5, 1, 2, 16).setValues([
    ["", "Ignored partial", "Female", "21-04", "@ignored", "49999", "Year 1", "Computing", "", "", "", "Angel and Mortal 👼", "", "", "", "I have understood the rules."],
    ["8/27/2026 08:04:00", "Delta", "Female", "21-05", "@delta", "40004", "Year 1", "Computing", "", "", "", "Angel and Mortal 👼", "", "", "", "I have understood the rules."]
  ]);
  roster.setDisplayedValue(5, 14, "40004");
  roster.setDisplayedValue(5, 15, "form:spreadsheet-test-id:6");
  const current = context.readParticipants_();
  const byName = Object.fromEntries(current.map(participant => [participant.name, participant]));
  roster.getRange(2, 7, 4, 1).setValues([
    [byName.Bob.key],
    [byName.Charlie.key],
    ["Delta [40004]"],
    [byName.Alice.key]
  ]);
  roster.getRange(5, 19, 2, 2).clearContent();
  try {
    captureParticipantUpdates("mortal", [
      {update_id: 920, message: {from: {id: 40004}, chat: {id: 40004, type: "private"}, text: "/start"}}
    ]);
    assert.ok(roster.getRange(5, 20).getValues()[0][0]);
    assert.equal(roster.getRange(6, 20).getValues()[0][0], "");
  } finally {
    liveFormSheet.getRange(5, 1, 2, 16).clearContent();
    roster.getRange(2, 7, 3, 1).setValues(originalMappings);
    roster.getRange(2, 19, 3, 2).setValues(originalBotState);
    roster.getRange(5, 7, 2, 14).clearContent();
  }
});

test("Devil tolerance fit is advisory and highlights good, check, and mismatch gaps", () => {
  const participants = [
    {personId:"a", key:"A [40001]", name:"A", telegramId:"40001", mode:"Devil", prankTolerance:"1", mortalSelection:"B [40002]", issues:[]},
    {personId:"b", key:"B [40002]", name:"B", telegramId:"40002", mode:"Devil", prankTolerance:"5", mortalSelection:"C [40003]", issues:[]},
    {personId:"c", key:"C [40003]", name:"C", telegramId:"40003", mode:"Angel", prankTolerance:"", mortalSelection:"A [40001]", issues:[]}
  ];
  const result = context.analyzePairings_(participants).participants;
  const byId = Object.fromEntries(result.map(p => [p.personId, p]));
  assert.equal(byId.a.assignmentFit, "MISMATCH · DEVIL 1→5");
  assert.equal(byId.b.assignmentFit, "READY · ANGEL");
  assert.equal(byId.c.assignmentFit, "CHECK · DEVIL ?→1");
  assert.ok(result.every(p => p.status === "Ready"));
});

test("Telegram identity comes directly from the signup form without codes", () => {
  assert.equal(context.registerParticipant_("unused", "10001").status, "already-user");
  assert.equal(context.registerParticipant_("unused", "9999").status, "invalid-code");
});

test("commands tolerate Telegram bot username suffixes", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.extractCommand_("/register@TestAngelBot 123456789"))), {name: "register", argument: "123456789"});
  assert.deepEqual(JSON.parse(JSON.stringify(context.extractCommand_("/start 123456789"))), {name: "start", argument: "123456789"});
  assert.equal(context.extractCommand_("hello"), null);
});

test("plain start identifies the form participant and tracks the joined bot", () => {
  const originalSend = context.telegramSendMessage_;
  const sent = [];
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {
      message: {from: {id: 30003}, chat: {id: 30003, type: "private"}, text: "/start"}
    });
  } finally {
    context.telegramSendMessage_ = originalSend;
  }
  const registered = context.readParticipants_().find(p => p.name === "Charlie");
  assert.equal(registered.telegramId, "30003");
  assert.ok(registered.mortalBotStartedAt);
  assert.match(sent.map(entry => entry[2]).join("\n"), /Your mortal is Alice/);
});

test("bot starts report readiness and notify the relevant partner", () => {
  const originalSend = context.telegramSendMessage_;
  const sent = [];
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {
      message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/start"}
    });
    context.handleParticipantUpdate_("angel", {
      message: {from: {id: 20002}, chat: {id: 20002, type: "private"}, text: "/start"}
    });
  } finally {
    context.telegramSendMessage_ = originalSend;
  }
  const participants = context.readParticipants_();
  assert.ok(participants.find(p => p.name === "Alice").mortalBotStartedAt);
  assert.ok(participants.find(p => p.name === "Bob").angelBotStartedAt);
  assert.match(sent.map(entry => entry[2]).join("\n"), /Your mortal Bob has joined the Angel bot/);
});

test("routing matches the original two-bot semantics", () => {
  const alice = context.readParticipants_().find(p => p.name === "Alice");
  const viaAngel = context.resolveRelayDirection_(alice, "angel");
  const viaMortal = context.resolveRelayDirection_(alice, "mortal");
  assert.equal(viaAngel.targetId, alice.angelId);
  assert.equal(viaAngel.targetBot, "mortal");
  assert.equal(viaMortal.targetId, alice.mortalId);
  assert.equal(viaMortal.targetBot, "angel");
});

test("relay transport strips Telegram sender identity instead of forwarding it", () => {
  const sent = [];
  const originalSend = context.telegramSendMessage_;
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    context.relayTelegramMessage_("mortal", "angel", "20002", {
      text: "Anonymous hello",
      from: {id: 10001, username: "alice_secret", first_name: "Alice"},
      chat: {id: 10001, type: "private"}
    });
  } finally {
    context.telegramSendMessage_ = originalSend;
  }
  assert.deepEqual(sent, [["angel", "20002", "Anonymous hello"]]);
  assert.doesNotMatch(JSON.stringify(sent), /alice_secret|10001|Alice/);
});

test("participant help enforces the two-bot privacy directions", () => {
  const mortalHelp = context.participantHelpText_("mortal");
  const angelHelp = context.participantHelpText_("angel");
  assert.match(mortalHelp, /Angel\/Devil: send messages here in the Mortal bot/);
  assert.match(mortalHelp, /mortal receives them in the Angel bot/);
  assert.match(angelHelp, /Mortal: send messages here in the Angel bot/);
  assert.match(angelHelp, /angel receives them in the Mortal bot/);
  assert.match(angelHelp, /identity stays secret/);
});

test("participant text is relayed anonymously through the opposite bot", () => {
  const relays = [];
  const notices = [];
  const originalRelay = context.relayTelegramMessage_;
  const originalSend = context.telegramSendMessage_;
  context.relayTelegramMessage_ = (...args) => relays.push(args);
  context.telegramSendMessage_ = (...args) => notices.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {
      update_id: 77,
      message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "Hello mortal"}
    });
  } finally {
    context.relayTelegramMessage_ = originalRelay;
    context.telegramSendMessage_ = originalSend;
  }
  assert.equal(relays.length, 1);
  assert.equal(relays[0][0], "mortal");
  assert.equal(relays[0][1], "angel");
  assert.equal(relays[0][2], "20002");
  assert.equal(relays[0][3].text, "Hello mortal");
  assert.equal(notices.length, 0);
});

function assertCurrentMappingWinsWithoutSync() {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const mortalColumn = context.getRosterLayout_(roster).columns.Mortal;
  const participants = context.readParticipants_();
  const byName = Object.fromEntries(participants.map(p => [p.name, p]));
  roster.getRange(2, mortalColumn, 3, 1).setValues([
    [byName.Bob.key],
    [byName.Charlie.key],
    [byName.Alice.key]
  ]);
  roster.getRange(2, 19, 3, 2).setValues([["yes", "yes"], ["yes", "yes"], ["yes", "yes"]]);
  const relays = [];
  const originalRelay = context.relayTelegramMessage_;
  context.relayTelegramMessage_ = (...args) => relays.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {update_id: 801, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "first"}});
    roster.getRange(2, mortalColumn, 3, 1).setValues([
      [byName.Charlie.key],
      [byName.Alice.key],
      [byName.Bob.key]
    ]);
    context.handleParticipantUpdate_("mortal", {update_id: 802, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "second"}});
  } finally {
    context.relayTelegramMessage_ = originalRelay;
  }
  assert.deepEqual(relays.map(entry => entry[2]), ["20002", "30003"]);
}

test("server-side validation still reads current mapping on every message", () => {
  assertCurrentMappingWinsWithoutSync();
});

test("a complete pair relays while unrelated mappings remain unfinished", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const mortalColumn = context.getRosterLayout_(roster).columns.Mortal;
  const participants = context.readParticipants_();
  const byName = Object.fromEntries(participants.map(p => [p.name, p]));
  roster.getRange(2, mortalColumn, 3, 1).setValues([
    [byName.Bob.key],
    [""],
    [""]
  ]);
  roster.getRange(3, 19).setValue("yes");
  const relays = [];
  const originalRelay = context.relayTelegramMessage_;
  context.relayTelegramMessage_ = (...args) => relays.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {update_id: 8021, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "pair-only"}});
  } finally {
    context.relayTelegramMessage_ = originalRelay;
  }
  assert.equal(relays.length, 1);
  assert.deepEqual(relays[0].slice(0, 3), ["mortal", "angel", "20002"]);
});

test("an in-progress remap fails closed with simple organiser guidance", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const mortalColumn = context.getRosterLayout_(roster).columns.Mortal;
  const originalMapping = roster.getRange(2, mortalColumn).getValues()[0][0];
  roster.getRange(2, mortalColumn).clearContent();
  const relays = [];
  const sent = [];
  const originalRelay = context.relayTelegramMessage_;
  const originalSend = context.telegramSendMessage_;
  context.relayTelegramMessage_ = (...args) => relays.push(args);
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {update_id: 803, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "during remap"}});
  } finally {
    context.relayTelegramMessage_ = originalRelay;
    context.telegramSendMessage_ = originalSend;
    roster.getRange(2, mortalColumn).setValue(originalMapping);
  }
  assert.equal(relays.length, 0);
  assert.equal(sent.length, 1);
  const feedback = sent.map(entry => entry[2]).join("\n");
  assert.match(feedback, /was not sent/i);
  assert.match(feedback, /@organiser/);
});

test("unreadable participant Sheet sends one failure and no target traffic", () => {
  const originalDirectory = context.currentParticipantDirectory_;
  const originalReadParticipants = context.readParticipants_;
  const originalRelay = context.relayTelegramMessage_;
  const originalSend = context.telegramSendMessage_;
  const sent = [];
  let targetSends = 0;
  context.currentParticipantDirectory_ = () => { throw new Error("sheet unavailable"); };
  context.readParticipants_ = () => { throw new Error("sheet unavailable"); };
  context.relayTelegramMessage_ = () => { targetSends += 1; };
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {
      update_id: 830,
      message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/start"}
    });
  } finally {
    context.currentParticipantDirectory_ = originalDirectory;
    context.readParticipants_ = originalReadParticipants;
    context.relayTelegramMessage_ = originalRelay;
    context.telegramSendMessage_ = originalSend;
  }
  assert.equal(targetSends, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].slice(0, 2), ["mortal", "10001"]);
  assert.match(sent[0][2], /not sent|could not read|unavailable/i);
  assert.match(sent[0][2], /@organiser/);
});

test("recipient not started sends one failure and no target traffic or state write", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const originalMappings = roster.getRange(2, 7, 3, 1).getValues();
  const originalBotState = roster.getRange(2, 19, 3, 2).getValues();
  const participants = context.readParticipants_();
  const byName = Object.fromEntries(participants.map(participant => [participant.name, participant]));
  roster.getRange(2, 7, 3, 1).setValues([[byName.Bob.key], [byName.Charlie.key], [byName.Alice.key]]);
  roster.getRange(3, 19).clearContent();
  const mutations = roster.mutationCount;
  try {
    const result = captureParticipantUpdates("mortal", [{
      update_id: 831,
      message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "hello"}
    }]);
    assert.equal(result.relays.length, 0);
    assert.equal(result.sent.length, 1);
    assert.deepEqual(result.sent[0].slice(0, 2), ["mortal", "10001"]);
    assert.match(result.sent[0][2], /not opened the receiving bot/i);
    assert.match(result.sent[0][2], /@organiser/);
    assert.equal(roster.mutationCount, mutations);
  } finally {
    roster.getRange(2, 7, 3, 1).setValues(originalMappings);
    roster.getRange(2, 19, 3, 2).setValues(originalBotState);
  }
});

test("exhausted target-bot retries send one sender failure without changing state", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const originalMappings = roster.getRange(2, 7, 3, 1).getValues();
  const originalBotState = roster.getRange(2, 19, 3, 2).getValues();
  const originalFetch = context.UrlFetchApp.fetch;
  const participants = context.readParticipants_();
  const byName = Object.fromEntries(participants.map(participant => [participant.name, participant]));
  const calls = [];
  roster.getRange(2, 7, 3, 1).setValues([[byName.Bob.key], [byName.Charlie.key], [byName.Alice.key]]);
  roster.getRange(3, 19).setValue("ready");
  properties.set("ANGEL_BOT_TOKEN", "test-angel-token");
  properties.set("MORTAL_BOT_TOKEN", "test-mortal-token");
  properties.set("SUPPORT_HANDLES", "@helper_one, @helper_two");
  context.UrlFetchApp.fetch = (url, options) => {
    const target = String(url).includes("test-angel-token");
    calls.push({target, payload: options.payload});
    return {
      getResponseCode: () => target ? 500 : 200,
      getContentText: () => JSON.stringify(target ? {ok: false, description: "server busy"} : {ok: true, result: {message_id: 1}})
    };
  };
  const mutations = roster.mutationCount;
  try {
    context.handleParticipantUpdate_("mortal", {
      update_id: 832,
      message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "retry me"}
    });
    assert.equal(calls.filter(call => call.target).length, 3, JSON.stringify(calls));
    const senderCalls = calls.filter(call => !call.target);
    assert.equal(senderCalls.length, 1);
    assert.equal(senderCalls[0].payload.chat_id, "10001");
    assert.match(senderCalls[0].payload.text, /could not send/i);
    assert.match(senderCalls[0].payload.text, /@helper_one or @helper_two/);
    assert.equal(roster.mutationCount, mutations);
  } finally {
    context.UrlFetchApp.fetch = originalFetch;
    properties.delete("ANGEL_BOT_TOKEN");
    properties.delete("MORTAL_BOT_TOKEN");
    properties.delete("SUPPORT_HANDLES");
    roster.getRange(2, 7, 3, 1).setValues(originalMappings);
    roster.getRange(2, 19, 3, 2).setValues(originalBotState);
  }
});

test("a failed sender notice is attempted once and does not re-enter webhook feedback", () => {
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  const originalMappings = roster.getRange(2, 7, 3, 1).getValues();
  const originalBotState = roster.getRange(2, 19, 3, 2).getValues();
  const originalRelay = context.relayTelegramMessage_;
  const originalSend = context.telegramSendMessage_;
  const participants = context.readParticipants_();
  const byName = Object.fromEntries(participants.map(participant => [participant.name, participant]));
  let senderAttempts = 0;
  roster.getRange(2, 7, 3, 1).setValues([[byName.Bob.key], [byName.Charlie.key], [byName.Alice.key]]);
  roster.getRange(3, 19).setValue("ready");
  context.relayTelegramMessage_ = () => { throw new Error("target unavailable"); };
  context.telegramSendMessage_ = () => {
    senderAttempts += 1;
    throw new Error("sender unavailable");
  };
  try {
    const response = context.doPost({
      parameter: {bot: "mortal", key: properties.get("MORTAL_WEBHOOK_KEY")},
      postData: {contents: JSON.stringify({
        update_id: 833,
        message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "one notice only"}
      })}
    });
    assert.equal(response.text, "ok");
    assert.equal(senderAttempts, 1);
  } finally {
    context.relayTelegramMessage_ = originalRelay;
    context.telegramSendMessage_ = originalSend;
    roster.getRange(2, 7, 3, 1).setValues(originalMappings);
    roster.getRange(2, 19, 3, 2).setValues(originalBotState);
  }
});

test("safe-test start sends one failure when bot-start registration cannot be read", () => {
  properties.set("TEST_MODE_ENABLED", "true");
  properties.set("TEST_TELEGRAM_ID", "10001");
  const originalRegister = context.registerLiveTestBotStart_;
  const originalSend = context.telegramSendMessage_;
  const sent = [];
  context.registerLiveTestBotStart_ = () => false;
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {
      update_id: 8031,
      message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/start"}
    });
  } finally {
    context.registerLiveTestBotStart_ = originalRegister;
    context.telegramSendMessage_ = originalSend;
    properties.delete("TEST_MODE_ENABLED");
    properties.delete("TEST_TELEGRAM_ID");
  }
  assert.equal(sent.length, 1);
  assert.match(sent[0][2], /could not save/i);
  assert.match(sent[0][2], /@organiser/);
});

test("isolated live-test account loops through the other bot only", () => {
  properties.set("TEST_MODE_ENABLED", "true");
  properties.set("TEST_TELEGRAM_ID", "10001");
  properties.set("TEST_TELEGRAM_NAME", "Tester");
  const relays = [];
  const sent = [];
  const originalRelay = context.relayTelegramMessage_;
  const originalSend = context.telegramSendMessage_;
  context.relayTelegramMessage_ = (...args) => relays.push(args);
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {update_id: 804, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/start"}});
    context.handleParticipantUpdate_("mortal", {update_id: 805, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "safe loopback"}});
  } finally {
    context.relayTelegramMessage_ = originalRelay;
    context.telegramSendMessage_ = originalSend;
    properties.delete("TEST_MODE_ENABLED");
    properties.delete("TEST_TELEGRAM_ID");
    properties.delete("TEST_TELEGRAM_NAME");
  }
  assert.equal(relays.length, 1);
  assert.deepEqual(relays[0].slice(0, 3), ["mortal", "angel", "10001"]);
  assert.match(sent.map(entry => entry[2]).join("\n"), /No participant will receive it/);
  assert.match(sent.map(entry => entry[2]).join("\n"), /registration is saved/i);
  const roster = spreadsheet.getSheetByName("Angel Mortal Roster");
  assert.ok(roster.getRange(2, 20).getValues()[0][0]);
  roster.getRange(2, 20).clearContent();
});

test("a leftover tester ID cannot activate safe test mode", () => {
  properties.set("TEST_TELEGRAM_ID", "10001");
  properties.set("TEST_TELEGRAM_NAME", "Stale tester");
  try {
    assert.equal(context.isLiveTestAccount_("10001"), false);
  } finally {
    properties.delete("TEST_TELEGRAM_ID");
    properties.delete("TEST_TELEGRAM_NAME");
  }
});

test("start remains responsive before the participant roster is ready", () => {
  const originalDirectory = context.currentParticipantDirectory_;
  const originalSend = context.telegramSendMessage_;
  const sent = [];
  context.currentParticipantDirectory_ = () => { throw new Error("Participant roster is unavailable."); };
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    context.handleParticipantUpdate_("mortal", {
      message: {from: {id: 9090}, chat: {id: 9090, type: "private"}, text: "/start"}
    });
  } finally {
    context.currentParticipantDirectory_ = originalDirectory;
    context.telegramSendMessage_ = originalSend;
  }
  assert.ok(sent.length >= 1);
  assert.match(sent.map(entry => entry[2]).join("\n"), /signup is linked|signup form|pairing/i);
});

test("media descriptors select the highest-resolution photo and cross-bot upload method", () => {
  const photo = context.mediaDescriptor_("photo", {photo: [{file_id: "small"}, {file_id: "large"}]});
  assert.equal(photo.fileId, "large");
  assert.equal(photo.method, "sendPhoto");
  const document = context.mediaDescriptor_("document", {document: {file_id: "doc", file_name: "notes.pdf"}});
  assert.equal(document.field, "document");
  assert.equal(document.fileName, "notes.pdf");
});

test("webhook authentication rejects a bad key and completed updates are deduplicated", () => {
  const bad = context.doPost({parameter: {bot: "angel", key: "wrong"}, postData: {contents: "{}"}});
  assert.equal(bad.text, "forbidden");
  const originalHandler = context.handleParticipantUpdate_;
  let calls = 0;
  context.handleParticipantUpdate_ = () => { calls += 1; };
  try {
    const event = {
      parameter: {bot: "angel", key: properties.get("ANGEL_WEBHOOK_KEY")},
      postData: {contents: JSON.stringify({update_id: 99, message: {}})}
    };
    assert.equal(context.doPost(event).text, "ok");
    assert.equal(context.doPost(event).text, "ok");
  } finally {
    context.handleParticipantUpdate_ = originalHandler;
  }
  assert.equal(calls, 1);
});

test("webhook failures prompt the user and remain retryable", () => {
  const originalHandler = context.handleParticipantUpdate_;
  const originalSend = context.telegramSendMessage_;
  const sent = [];
  let attempts = 0;
  context.handleParticipantUpdate_ = () => {
    attempts += 1;
    if (attempts === 1) throw new Error("controlled failure");
  };
  context.telegramSendMessage_ = (...args) => sent.push(args);
  try {
    const event = {
      parameter: {bot: "angel", key: properties.get("ANGEL_WEBHOOK_KEY")},
      postData: {contents: JSON.stringify({
        update_id: 501,
        message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "hello"}
      })}
    };
    assert.equal(context.doPost(event).text, "retry");
    assert.match(properties.get("LAST_WEBHOOK_STATUS"), /controlled failure/);
    assert.equal(context.doPost(event).text, "ok");
  } finally {
    context.handleParticipantUpdate_ = originalHandler;
    context.telegramSendMessage_ = originalSend;
  }
  assert.equal(attempts, 2);
  assert.equal(sent.length, 1);
  assert.match(sent.map(entry => entry[2]).join("\n"), /send it again/i);
  assert.match(sent.map(entry => entry[2]).join("\n"), /@organiser/);
  assert.doesNotMatch(properties.get("LAST_WEBHOOK_STATUS"), /BOT_TOKEN/);
});

test("malformed webhook payloads are acknowledged without retry loops", () => {
  const response = context.doPost({
    parameter: {bot: "angel", key: properties.get("ANGEL_WEBHOOK_KEY")},
    postData: {contents: "not-json"}
  });
  assert.equal(response.text, "ok");
});

test("successful webhook delivery is acknowledged when dedupe completion fails", () => {
  const originalCacheFactory = context.CacheService.getScriptCache;
  const originalHandler = context.handleParticipantUpdate_;
  const originalSend = context.telegramSendMessage_;
  let handled = 0;
  context.CacheService.getScriptCache = () => ({
    get: () => null,
    put: (_key, value) => {
      if (value === "done") throw new Error("cache unavailable");
    },
    remove() {}
  });
  context.handleParticipantUpdate_ = () => { handled += 1; };
  context.telegramSendMessage_ = () => {};
  try {
    const response = context.doPost({
      parameter: {bot: "angel", key: properties.get("ANGEL_WEBHOOK_KEY")},
      postData: {contents: JSON.stringify({update_id: 502, message: {}})}
    });
    assert.equal(response.text, "ok");
  } finally {
    context.CacheService.getScriptCache = originalCacheFactory;
    context.handleParticipantUpdate_ = originalHandler;
    context.telegramSendMessage_ = originalSend;
  }
  assert.equal(handled, 1);
});

test("Telegram API retries flood-control and server failures", () => {
  const originalFetch = context.UrlFetchApp.fetch;
  const originalSleep = context.Utilities.sleep;
  properties.set("ANGEL_BOT_TOKEN", "angel-test-token");
  const responses = [
    {status: 500, body: {ok: false, description: "server busy"}},
    {status: 429, body: {ok: false, description: "Too Many Requests", parameters: {retry_after: 2}}},
    {status: 200, body: {ok: true, result: {message_id: 1}}}
  ];
  const sleeps = [];
  let calls = 0;
  context.UrlFetchApp.fetch = () => {
    const item = responses[calls++];
    return {
      getResponseCode: () => item.status,
      getContentText: () => JSON.stringify(item.body)
    };
  };
  context.Utilities.sleep = value => sleeps.push(value);
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(context.telegramApi_("angel", "sendMessage", {chat_id: "1", text: "hi"}))), {message_id: 1});
  } finally {
    context.UrlFetchApp.fetch = originalFetch;
    context.Utilities.sleep = originalSleep;
    properties.delete("ANGEL_BOT_TOKEN");
  }
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 2000]);
});

test("media larger than Telegram getFile limit fails before download", () => {
  const originalGetFile = context.telegramGetFile_;
  const originalFetch = context.UrlFetchApp.fetch;
  let downloads = 0;
  properties.set("ANGEL_BOT_TOKEN", "angel-test-token");
  context.telegramGetFile_ = () => ({file_path: "documents/large.bin", file_size: 20 * 1024 * 1024 + 1});
  context.UrlFetchApp.fetch = () => { downloads += 1; };
  try {
    assert.throws(() => context.telegramDownloadFile_("angel", "file-id", "large.bin"), /too large/i);
  } finally {
    context.telegramGetFile_ = originalGetFile;
    context.UrlFetchApp.fetch = originalFetch;
    properties.delete("ANGEL_BOT_TOKEN");
  }
  assert.equal(downloads, 0);
});

test("webhook setup caps Telegram concurrency below Apps Script user limit", () => {
  const originalApi = context.telegramApi_;
  let payload;
  context.telegramApi_ = (_bot, method, value) => {
    assert.equal(method, "setWebhook");
    payload = value;
    return true;
  };
  try {
    context.telegramSetWebhook_("angel", "https://gateway.example/telegram");
  } finally {
    context.telegramApi_ = originalApi;
  }
  assert.equal(payload.max_connections, 10);
});

test("webhook setup is independent of participant roster readiness", () => {
  const source = fs.readFileSync(path.join(root, "Telegram.gs"), "utf8");
  const setupBody = source.match(/function setupWebhooks\(\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(setupBody, /setupParticipantsSheet_/);
  assert.doesNotMatch(setupBody, /validateParticipants_/);
  assert.match(setupBody, /ANGEL_BOT_TOKEN/);
  assert.match(setupBody, /MORTAL_BOT_TOKEN/);
  assert.match(setupBody, /WEBHOOK_GATEWAY_URL/);
  assert.doesNotMatch(setupBody, /ScriptApp\.getService\(\)\.getUrl\(\)/);
});

test("webhook reset drops pending updates for every configured bot", () => {
  const source = fs.readFileSync(path.join(root, "Telegram.gs"), "utf8");
  assert.match(source, /function telegramDeleteWebhook_\(bot, dropPendingUpdates\)/);
  assert.match(source, /drop_pending_updates: !!dropPendingUpdates/);
  const removeBody = source.match(/function removeWebhooks\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(removeBody, /telegramDeleteWebhook_\(bot, true\)/);
  const resetBody = source.match(/function resetWebhooksAndDropPendingUpdates\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(resetBody, /telegramDeleteWebhook_\(bot, true\)/);
  assert.match(resetBody, /return setupWebhooks\(\)/);
});

test("the runbook scopes every Wrangler mutation to one verified-new Worker name", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /\$workerName\s*=\s*Read-Host/);
  assert.match(readme, /confirm[^\n]+does not (?:already )?exist/i);
  const mutationCommands = readme.split(/\r?\n/).filter(line =>
    /^npx wrangler (?:deploy|secret put|secret delete|delete)\b/.test(line.trim())
  );
  assert.ok(mutationCommands.length >= 9);
  mutationCommands.forEach(command => assert.match(command, /--name \$workerName(?:\s|$)/));
});

test("dependency installs stay ignored at the root and in gateway", () => {
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^node_modules\/$/m);
});

test("admin binding captures the latest private start sender without exposing the ID", () => {
  properties.delete("ADMIN_TELEGRAM_ID");
  properties.set("ADMIN_BOT_TOKEN", "admin-test-token");
  const originalApi = context.telegramApi_;
  const originalDelete = context.telegramDeleteWebhook_;
  const deleted = [];
  context.telegramDeleteWebhook_ = (...args) => deleted.push(args);
  context.telegramApi_ = (bot, method) => {
    assert.equal(bot, "admin");
    assert.equal(method, "getUpdates");
    return [
      {update_id: 1, message: {from: {id: 111}, chat: {id: 111, type: "private"}, text: "hello"}},
      {update_id: 2, message: {from: {id: 222}, chat: {id: 222, type: "private"}, text: "/start@AdminBot"}}
    ];
  };
  try {
    assert.equal(context.captureAdminTelegramId(), "Telegram organiser ID captured.");
  } finally {
    context.telegramApi_ = originalApi;
    context.telegramDeleteWebhook_ = originalDelete;
  }
  assert.deepEqual(deleted, [["admin", false]]);
  assert.equal(properties.get("ADMIN_TELEGRAM_ID"), "222");
});

test("configuration validation identifies missing secrets without exposing values", () => {
  const validation = context.validateConfiguration_();
  assert.equal(validation.ok, false);
  assert.match(validation.message, /ANGEL_BOT_TOKEN/);
  assert.doesNotMatch(validation.message, /WEBHOOK_KEY/);
});

if (process.exitCode) process.exit(process.exitCode);
