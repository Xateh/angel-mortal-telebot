"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "config", "form-schema.json");
const builderPath = path.join(root, "FormSetup.gs");

function loadSchema() {
  assert.equal(fs.existsSync(schemaPath), true, "config/form-schema.json is missing");
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

class MockItem {
  constructor(form, type) {
    this.form = form;
    this.type = type;
    this.title = "";
    this.helpText = "";
    this.required = false;
    form.items.push(this);
  }
  setTitle(value) { this.title = value; return this; }
  setHelpText(value) { this.helpText = value; return this; }
  setRequired(value) { this.required = value; return this; }
  getIndex() { return this.form.items.indexOf(this); }
}

class MockChoiceItem extends MockItem {
  createChoice(value, target) { return {value, target}; }
  setChoices(value) { this.choices = value; return this; }
}

class MockTextItem extends MockItem {
  setValidation(value) { this.validation = value; return this; }
}

class MockCheckboxItem extends MockChoiceItem {
  showOtherOption(value) { this.other = value; return this; }
}

class MockScaleItem extends MockItem {
  setBounds(lower, upper) { this.bounds = [lower, upper]; return this; }
  setLabels(lower, upper) { this.labels = [lower, upper]; return this; }
}

class MockPageBreakItem extends MockItem {
  setGoToPage(value) { this.goToPage = value; return this; }
}

class MockForm {
  constructor(title) {
    this.title = title;
    this.items = [];
    this.responses = [];
  }
  addTextItem() { return new MockTextItem(this, "short_answer"); }
  addMultipleChoiceItem() { return new MockChoiceItem(this, "multiple_choice"); }
  addCheckboxItem() { return new MockCheckboxItem(this, "checkboxes"); }
  addScaleItem() { return new MockScaleItem(this, "linear_scale"); }
  addPageBreakItem() { return new MockPageBreakItem(this, "section"); }
  moveItem(from, index) {
    // Google rejects typed question items here; exercise its integer overload.
    assert.equal(Number.isInteger(from), true, "moveItem needs an index, not a typed Form item");
    assert.equal(Number.isInteger(index), true);
    assert.ok(from >= 0 && from < this.items.length);
    assert.ok(index >= 0 && index < this.items.length);
    const [item] = this.items.splice(from, 1);
    this.items.splice(index, 0, item);
    return item;
  }
  setDescription(value) { this.description = value; return this; }
  setCollectEmail(value) { this.collectEmail = value; return this; }
  setLimitOneResponsePerUser(value) { this.limitOneResponse = value; return this; }
  setDestination(type, id) { this.destination = {type, id}; return this; }
  getId() { return "fixture-form"; }
  getEditUrl() { return "fixture-edit-location"; }
  getPublishedUrl() { return "fixture-published-location"; }
}

function loadBuilder(schema) {
  assert.equal(fs.existsSync(builderPath), true, "FormSetup.gs is missing");
  const forms = [];
  const spreadsheets = [];
  const propertyWrites = [];
  let rosterSetupCalls = 0;
  let triggerCalls = 0;
  let logCalls = 0;

  const formApp = {
    DestinationType: {SPREADSHEET: "spreadsheet"},
    PageNavigationType: {CONTINUE: "continue", SUBMIT: "submit"},
    create(title, isPublished) {
      const form = new MockForm(title);
      form.isPublished = isPublished;
      forms.push(form);
      return form;
    },
    createTextValidation() {
      const validation = {};
      return {
        setHelpText(value) { validation.helpText = value; return this; },
        requireTextContainsPattern(value) { validation.type = "text_contains"; validation.value = value; return this; },
        requireNumberGreaterThan(value) { validation.type = "number_greater_than"; validation.value = value; return this; },
        build() { return validation; }
      };
    }
  };
  const context = vm.createContext({
    FORM_SCHEMA: schema,
    FormApp: formApp,
    SpreadsheetApp: {
      create(name) {
        const spreadsheet = {name, getId: () => "fixture-spreadsheet"};
        spreadsheets.push(spreadsheet);
        return spreadsheet;
      }
    },
    getScriptProperties_: () => ({
      setProperties(values, deleteAllOthers) {
        propertyWrites.push({values: {...values}, deleteAllOthers});
        return this;
      }
    }),
    setupParticipantsSheet_: () => { rosterSetupCalls += 1; },
    ScriptApp: {newTrigger: () => { triggerCalls += 1; throw new Error("triggers are forbidden"); }},
    Logger: {log: () => { logCalls += 1; }},
    console: {log: () => { logCalls += 1; }}
  });
  new vm.Script(fs.readFileSync(builderPath, "utf8"), {filename: "FormSetup.gs"}).runInContext(context);
  return {
    context,
    formApp,
    forms,
    spreadsheets,
    propertyWrites,
    rosterSetupCalls: () => rosterSetupCalls,
    triggerCalls: () => triggerCalls,
    logCalls: () => logCalls
  };
}

test("schema preserves the approved public-safe Form contract", () => {
  const schema = loadSchema();
  const keys = [
    "name", "gender", "room", "telegramHandle", "telegramId", "year", "faculty", "interests",
    "specialRequirements", "genderPreference", "mode", "prankTolerance", "roomEntry", "boundaries", "declaration"
  ];
  assert.equal(schema.title, "Angel/Devil Mortal");
  assert.equal(
    schema.description,
    "Sign up for a one-to-one Angel/Devil and Mortal event. Your numeric Telegram user ID lets the relay bots identify you without a registration code."
  );
  assert.deepEqual(schema.questions.map(question => question.key), keys);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(
    schema.questions.map(question => question.type),
    [
      "short_answer", "multiple_choice", "short_answer", "short_answer", "short_answer",
      "multiple_choice", "short_answer", "short_answer", "short_answer", "multiple_choice",
      "multiple_choice", "linear_scale", "multiple_choice", "checkboxes", "multiple_choice"
    ]
  );
  assert.equal(schema.questions.every(question => question.required === true), true);
  assert.deepEqual(schema.defaultResponses, []);
  assert.equal(
    digest(schema.sections.map(section => [section.key, section.title || "", section.description || "", section.after || ""])),
    "f40f08e75154090ea2388f150b40851cba070714c9e6da1cc03e8ae360d08369"
  );
  assert.equal(
    digest(schema.questions.map(question => [question.key, question.title, question.description || "", question.choices || []])),
    "0efc5552d1b94050e1cfd849e5c948840df7e65c9d4994dad82e1a296ebf62f9"
  );
  // Digests pin approved wording without copying question text outside the schema.
  assert.equal(
    digest(schema.questions.map(question => [question.key, question.validation || null, question.scale || null, !!question.other])),
    "d99b94ef2f4e77e566f189727ac42cf4dfc5b960d924e9ad8d70f3772db27a5f"
  );
  const serialized = JSON.stringify(schema);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\b\d{7,20}\b/);
  assert.deepEqual(
    [...new Set(serialized.match(/@[A-Za-z0-9_]+/g) || [])].sort(),
    ["@handle", "@userinfobot", "@username"]
  );
});

test("schema keeps validation and Angel/Devil routing semantics", () => {
  const schema = loadSchema();
  const byKey = Object.fromEntries(schema.questions.map(question => [question.key, question]));
  assert.equal(byKey.boundaries.other, true);
  assert.deepEqual([byKey.room.validation.type, byKey.room.validation.value], ["text_contains", "#"]);
  assert.deepEqual([byKey.telegramHandle.validation.type, byKey.telegramHandle.validation.value], ["text_contains", "@"]);
  assert.deepEqual([byKey.telegramId.validation.type, byKey.telegramId.validation.value], ["number_greater_than", 1]);
  assert.deepEqual(byKey.mode.choices.map(choice => choice.target), ["declaration", "devil_details"]);
  assert.deepEqual([byKey.prankTolerance.scale.lower, byKey.prankTolerance.scale.upper], [1, 5]);
});

test("builder creates the final section order and applies item settings", () => {
  const schema = loadSchema();
  const harness = loadBuilder(schema);
  const form = new MockForm(schema.title);
  harness.context.buildFormItems_(form, schema);

  const questionKeyByTitle = new Map(schema.questions.map(question => [question.title, question.key]));
  const sectionKeyByTitle = new Map(schema.sections.filter(section => section.key !== "main").map(section => [section.title, section.key]));
  const actualOrder = form.items.map(item => item.type === "section"
    ? `section:${sectionKeyByTitle.get(item.title)}`
    : questionKeyByTitle.get(item.title));
  assert.deepEqual(actualOrder, [
    "name", "gender", "room", "telegramHandle", "telegramId", "year", "faculty", "interests",
    "specialRequirements", "genderPreference", "mode", "section:devil_details", "prankTolerance",
    "roomEntry", "boundaries", "section:declaration", "declaration", "section:channel"
  ]);

  for (const question of schema.questions) {
    const item = form.items.find(candidate => candidate.title === question.title);
    assert.ok(item, `missing item for ${question.key}`);
    assert.equal(item.required, true, `${question.key} is not required`);
    assert.equal(item.helpText, question.description || "", `${question.key} help text differs`);
    if (question.choices) {
      assert.deepEqual(item.choices.map(choice => choice.value), question.choices.map(choice => typeof choice === "string" ? choice : choice.value));
    }
  }
  const itemByKey = key => form.items.find(item => item.title === schema.questions.find(question => question.key === key).title);
  for (const key of ["room", "telegramHandle", "telegramId"]) {
    const validation = schema.questions.find(question => question.key === key).validation;
    assert.deepEqual(itemByKey(key).validation, {type: validation.type, value: validation.value, helpText: validation.error});
  }
  assert.deepEqual(itemByKey("prankTolerance").bounds, [schema.questions[11].scale.lower, schema.questions[11].scale.upper]);
  assert.deepEqual(itemByKey("prankTolerance").labels, [schema.questions[11].scale.lowLabel, schema.questions[11].scale.highLabel]);
  assert.equal(itemByKey("boundaries").other, true);

  const pages = Object.fromEntries(form.items.filter(item => item.type === "section").map(item => [sectionKeyByTitle.get(item.title), item]));
  const modeChoices = itemByKey("mode").choices;
  assert.equal(modeChoices[0].target, pages.declaration);
  assert.equal(modeChoices[1].target, pages.devil_details);
  assert.equal(pages.devil_details.goToPage, undefined, "the first page break must not override main-page choice routing");
  assert.equal(pages.declaration.goToPage, harness.formApp.PageNavigationType.CONTINUE);
  assert.equal(pages.channel.goToPage, harness.formApp.PageNavigationType.CONTINUE);
  assert.equal(form.responses.length, 0);
});

test("empty-stack setup links the response Sheet and writes no triggers or logs", () => {
  const schema = loadSchema();
  const harness = loadBuilder(schema);
  const result = harness.context.createEmptyAngelMortalStack();
  const form = harness.forms[0];

  assert.equal(harness.spreadsheets[0].name, `${schema.title} (Responses)`);
  assert.equal(form.title, schema.title);
  assert.equal(form.description, schema.description);
  assert.equal(form.collectEmail, false);
  assert.equal(form.limitOneResponse, false);
  assert.equal(form.isPublished, true);
  assert.deepEqual(form.destination, {type: "spreadsheet", id: "fixture-spreadsheet"});
  assert.deepEqual(harness.propertyWrites, [{
    values: {
      SPREADSHEET_ID: "fixture-spreadsheet",
      FORM_RESPONSES_SPREADSHEET_ID: "fixture-spreadsheet",
      FORM_RESPONSES_SHEET_NAME: "Form Responses 1"
    },
    deleteAllOthers: false
  }]);
  assert.equal(harness.rosterSetupCalls(), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    formId: "fixture-form",
    spreadsheetId: "fixture-spreadsheet",
    editUrl: "fixture-edit-location",
    publishedUrl: "fixture-published-location"
  });
  assert.equal(harness.triggerCalls(), 0);
  assert.equal(harness.logCalls(), 0);
  assert.equal(form.responses.length, 0);
});

test("builder rejects unsupported item types and missing navigation targets", () => {
  const schema = loadSchema();
  const harness = loadBuilder(schema);
  const unsupported = JSON.parse(JSON.stringify(schema));
  unsupported.questions[0].type = "unsupported";
  assert.throws(() => harness.context.buildFormItems_(new MockForm(schema.title), unsupported), /Unsupported form item type/);

  const missingTarget = JSON.parse(JSON.stringify(schema));
  missingTarget.questions.find(question => question.key === "mode").choices[0].target = "missing";
  assert.throws(() => harness.context.buildFormItems_(new MockForm(schema.title), missingTarget), /Unknown Form navigation target/);
});

test("build injects one schema declaration before the Form builder", () => {
  const result = childProcess.spawnSync(process.execPath, [path.join(root, "build.mjs")], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const bundle = fs.readFileSync(path.join(root, "dist", "Code.gs"), "utf8");
  assert.equal((bundle.match(/var FORM_SCHEMA\s*=/g) || []).length, 1);
  assert.ok(bundle.indexOf("var FORM_SCHEMA") < bundle.indexOf("// ===== FormSetup.gs ====="));
  assert.ok(bundle.indexOf("// ===== FormSetup.gs =====") < bundle.indexOf("// ===== Config.gs ====="));
  assert.deepEqual(JSON.parse(bundle.match(/var FORM_SCHEMA = Object\.freeze\((\{.*\})\);/)[1]), loadSchema());
});

test("Apps Script manifest keeps relay scopes and adds Forms access", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "appsscript.json"), "utf8"));
  assert.deepEqual(manifest.oauthScopes, [
    "https://www.googleapis.com/auth/forms",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ]);
});

test("schema titles map to every real Form importer field", () => {
  const schema = loadSchema();
  const context = vm.createContext({});
  new vm.Script(fs.readFileSync(path.join(root, "FormImport.gs"), "utf8"), {filename: "FormImport.gs"}).runInContext(context);
  const headers = ["Timestamp", ...schema.questions.map(question => question.title)];
  const expected = Object.fromEntries(["timestamp", ...schema.questions.map(question => question.key)].map((key, index) => [key, index]));
  assert.deepEqual(JSON.parse(JSON.stringify(context.mapFormColumns_(headers))), expected);

  const driftedHeaders = headers.slice();
  driftedHeaders[expected.telegramId] = "Changed numeric identifier title";
  assert.throws(() => context.mapFormColumns_(driftedHeaders), /missing the expected column/);
});
