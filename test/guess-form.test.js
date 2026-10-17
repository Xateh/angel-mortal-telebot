"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = path.join(__dirname, "..", "GuessFormSetup.gs");
const keys = ["GUESS_FORM_ID", "GUESS_PERSON_ITEM_ID", "GUESS_ANGEL_ITEM_ID", "GUESS_DEVIL_ITEM_ID", "GUESS_ANGEL_SECTION_ID", "GUESS_DEVIL_SECTION_ID"];
const sample = [
  {personId: "p3", name: "zoe", room: "03", mode: "Angel", roleToMortal: "Devil"},
  {personId: "p1", name: "amy", room: "01", mode: "Devil", roleToMortal: "Angel"},
  {personId: "p2", name: "Ben", room: "02", mode: "Angel", roleToMortal: "Angel"}
];

function harness(participants = sample.map(row => ({...row}))) {
  const properties = {};
  const forms = [];
  const triggers = [];
  const calls = {formCreates: 0, reads: 0, writes: 0, telegram: 0, rosterWrites: 0, locks: 0};
  let nextId = 1;
  class Item {
    constructor(form, type) {
      this.form = form;
      this.type = type;
      this.id = nextId++;
      this.title = "";
      this.choices = [];
      form.items.push(this);
    }
    getId() { return this.id; }
    getType() { return this.type; }
    getIndex() { return this.form.items.indexOf(this); }
    setTitle(value) { this.title = value; return this; }
    setRequired(value) { this.required = value; return this; }
    setHelpText(value) { this.helpText = value; return this; }
    setGoToPage(value) { this.goToPage = value; return this; }
    getPageNavigationType() { return this.goToPage || "CONTINUE"; }
    asMultipleChoiceItem() { assert.equal(this.type, "MULTIPLE_CHOICE"); return this; }
    asListItem() { assert.equal(this.type, "LIST"); return this; }
    asPageBreakItem() { assert.equal(this.type, "PAGE_BREAK"); return this; }
    createChoice(value, target) {
      return {getValue: () => value, getGotoPage: () => typeof target === "object" ? target : null,
        getPageNavigationType: () => typeof target === "object" ? "GO_TO_PAGE" : typeof target === "string" ? target : null};
    }
    getChoices() { return this.choices; }
    setChoices(value) {
      assert.ok(value.length > 0, "Forms rejects empty choice arrays");
      if (this.failNextWrite) { this.failNextWrite = false; throw new Error("private participant data from API"); }
      calls.writes++;
      this.choices = value;
      return this;
    }
  }
  class Form {
    constructor(title, published) {
      this.id = `form-${forms.length + 1}`;
      this.title = title;
      this.published = published;
      this.acceptingResponses = true;
      this.collectEmail = true;
      this.allowResponseEdits = true;
      this.limitOneResponse = true;
      this.quiz = true;
      this.responses = [{id: "existing-response"}];
      this.destination = {type: "existing", id: "untouched"};
      this.items = [];
    }
    getId() { return this.id; }
    getItemById(id) { return this.items.find(item => item.id === id) || null; }
    getItems() { return this.items.slice(); }
    addMultipleChoiceItem() { return new Item(this, "MULTIPLE_CHOICE"); }
    addListItem() { return new Item(this, "LIST"); }
    addPageBreakItem() { return new Item(this, "PAGE_BREAK"); }
    setAcceptingResponses(value) { this.acceptingResponses = value; return this; }
    setDescription(value) { this.description = value; return this; }
    setCollectEmail(value) { this.collectEmail = value; return this; }
    setLimitOneResponsePerUser(value) { this.limitOneResponse = value; return this; }
    setAllowResponseEdits(value) { this.allowResponseEdits = value; return this; }
    setIsQuiz(value) { this.quiz = value; return this; }
  }
  const scriptApp = {
    getProjectTriggers: () => triggers.slice(),
    newTrigger(handler) {
      assert.equal(handler, "refreshGuessingFormOptions");
      return {timeBased: () => ({everyHours(hours) {
        assert.equal(hours, 1);
        return {create() {
          const trigger = {getHandlerFunction: () => handler};
          triggers.push(trigger);
          return trigger;
        }};
      }})};
    },
    deleteTrigger(trigger) { const index = triggers.indexOf(trigger); assert.notEqual(index, -1); triggers.splice(index, 1); }
  };
  const context = vm.createContext({
    FormApp: {
      ItemType: {MULTIPLE_CHOICE: "MULTIPLE_CHOICE", LIST: "LIST", PAGE_BREAK: "PAGE_BREAK"},
      PageNavigationType: {SUBMIT: "SUBMIT", CONTINUE: "CONTINUE", GO_TO_PAGE: "GO_TO_PAGE"},
      create(title, published) { calls.formCreates++; const form = new Form(title, published); forms.push(form); return form; },
      openById(id) { const form = forms.find(candidate => candidate.id === id); if (!form) throw new Error("private bad ID"); return form; }
    },
    ScriptApp: scriptApp,
    LockService: {getScriptLock: () => ({tryLock: () => { calls.locks++; return true; }, releaseLock: () => {}})},
    getScriptProperties_: () => ({
      getProperty: name => properties[name] || null,
      setProperties(values, deleteOthers) { assert.equal(deleteOthers, false); Object.assign(properties, values); }
    }),
    readParticipants_: () => { calls.reads++; return participants; },
    validateParticipants_: () => {
      calls.reads++;
      if (participants.length < 2 || participants.some(person => person.status === "Review")) throw new Error("private roster diagnostics");
      return {participants};
    },
    telegramSendMessage_: () => { calls.telegram++; },
    setupParticipantsSheet_: () => { calls.rosterWrites++; },
    console: {log: () => { throw new Error("logging participant data is forbidden"); }}
  });
  if (fs.existsSync(source)) new vm.Script(fs.readFileSync(source, "utf8"), {filename: source}).runInContext(context);
  return {context, properties, forms, triggers, calls, participants, Item};
}

function json(value) { return JSON.parse(JSON.stringify(value)); }
function options(item) { return item.getChoices().map(choice => choice.getValue()); }

test("plan sorts a copy and derives candidate role from giver's roleToMortal", () => {
  const h = harness();
  const plan = h.context.buildGuessChoicePlan_(sample);
  assert.deepEqual(json(plan), {
    people: [
      {personId: "p1", label: "amy — 01", mode: "Devil"},
      {personId: "p2", label: "Ben — 02", mode: "Angel"},
      {personId: "p3", label: "zoe — 03", mode: "Angel"}
    ],
    angel: [{personId: "p1", label: "amy — 01"}, {personId: "p2", label: "Ben — 02"}],
    devil: [{personId: "p3", label: "zoe — 03"}]
  });
  assert.equal(sample[0].personId, "p3");
  assert.deepEqual(h.calls, {formCreates: 0, reads: 0, writes: 0, telegram: 0, rosterWrites: 0, locks: 0});
});

test("plan uses English case-insensitive names then room then exact ID without changing spelling", () => {
  const h = harness();
  const rows = [
    {personId: "z", name: "Émile", room: "02", mode: "Angel", roleToMortal: "Angel"},
    {personId: "c", name: "Alex", room: "02", mode: "Angel", roleToMortal: "Angel"},
    {personId: "b", name: "alex", room: "01", mode: "Angel", roleToMortal: "Angel"},
    {personId: "a", name: "alex", room: "02", mode: "Angel", roleToMortal: "Angel"},
    {personId: "r", name: "constructor", room: "04", mode: "Angel", roleToMortal: "Angel"}
  ];
  assert.deepEqual(json(h.context.buildGuessChoicePlan_(rows).people.map(person => person.personId)), ["b", "a", "c", "r", "z"]);
  assert.equal(rows[0].name, "Émile");
});

test("plan rejects ambiguous labels, invalid IDs/modes, and unresolved pairings", () => {
  const h = harness();
  const bad = (change, pattern) => {
    const rows = sample.map(row => ({...row}));
    change(rows);
    assert.throws(() => h.context.buildGuessChoicePlan_(rows), pattern);
  };
  bad(rows => { rows[1].personId = rows[0].personId; }, /DUPLICATE_ID/);
  bad(rows => { rows[1].personId = " "; }, /INVALID_ID/);
  bad(rows => { rows[1].name = rows[0].name; rows[1].room = rows[0].room; }, /AMBIGUOUS_LABEL/);
  bad(rows => { rows[1].mode = "Unknown"; }, /INVALID_MODE/);
  bad(rows => { rows[1].roleToMortal = ""; }, /PAIRING_NOT_READY/);
  bad(rows => { rows[1].status = "Review"; }, /PAIRING_NOT_READY/);
});

test("explicit setup creates closed unpublished isolated skeleton and is idempotent", () => {
  const h = harness();
  const result = h.context.createGuessingForm();
  assert.equal(result.formId, h.forms[0].id);
  assert.equal(h.calls.formCreates, 1);
  assert.equal(h.forms[0].published, false);
  assert.equal(h.forms[0].acceptingResponses, false);
  assert.deepEqual(Object.keys(h.properties).sort(), keys.slice().sort());
  assert.equal(h.forms[0].items.length, 5);
  assert.ok(h.forms[0].items.every(item => item.getChoices().length > 0 || item.type === "PAGE_BREAK"));
  assert.equal(h.forms[0].getItemById(Number(h.properties.GUESS_ANGEL_SECTION_ID)).goToPage, "SUBMIT");
  h.context.createGuessingForm();
  assert.equal(h.calls.formCreates, 1);
  assert.equal(h.triggers.length, 0);
  assert.equal(h.calls.rosterWrites, 0);
  assert.equal(h.calls.telegram, 0);
});

test("setup failure leaves no private bindings or scheduled trigger", () => {
  const h = harness();
  h.context.FormApp.create = () => { throw new Error("private create error"); };
  assert.throws(() => h.context.createGuessingForm(), /GUESS_SETUP_FAILED/);
  assert.deepEqual(h.properties, {});
  assert.equal(h.triggers.length, 0);
});

test("refresh updates choices with branch routing, then skips identical writes and preserves form state", () => {
  const h = harness();
  h.context.createGuessingForm();
  const form = h.forms[0];
  form.responses.push({id: "response-2"});
  form.collectEmail = false;
  form.allowResponseEdits = false;
  form.limitOneResponse = false;
  form.quiz = false;
  const before = json({published: form.published, acceptingResponses: form.acceptingResponses,
    responses: form.responses, collectEmail: form.collectEmail, allowResponseEdits: form.allowResponseEdits,
    limitOneResponse: form.limitOneResponse, quiz: form.quiz, destination: form.destination});
  const first = json(h.context.refreshGuessingFormOptions());
  assert.deepEqual(first, {ok: true, changed: true, participantCount: 3, angelCount: 2, devilCount: 1});
  const person = form.getItemById(Number(h.properties.GUESS_PERSON_ITEM_ID));
  const angel = form.getItemById(Number(h.properties.GUESS_ANGEL_ITEM_ID));
  const devil = form.getItemById(Number(h.properties.GUESS_DEVIL_ITEM_ID));
  assert.deepEqual(options(person), ["amy — 01", "Ben — 02", "zoe — 03"]);
  assert.deepEqual(options(angel), ["amy — 01", "Ben — 02"]);
  assert.deepEqual(options(devil), ["zoe — 03"]);
  assert.equal(person.getChoices()[0].getGotoPage().getId(), Number(h.properties.GUESS_DEVIL_SECTION_ID));
  assert.equal(person.getChoices()[1].getGotoPage().getId(), Number(h.properties.GUESS_ANGEL_SECTION_ID));
  const writes = h.calls.writes;
  assert.deepEqual(json(h.context.refreshGuessingFormOptions()), {ok: true, changed: false, participantCount: 3, angelCount: 2, devilCount: 1});
  assert.equal(h.calls.writes, writes);
  assert.deepEqual(json({published: form.published, acceptingResponses: form.acceptingResponses,
    responses: form.responses, collectEmail: form.collectEmail, allowResponseEdits: form.allowResponseEdits,
    limitOneResponse: form.limitOneResponse, quiz: form.quiz, destination: form.destination}), before);
  assert.equal(h.calls.rosterWrites, 0);
  assert.equal(h.calls.telegram, 0);
  assert.equal(h.triggers.length, 0);
});

test("refresh rejects last-page participant question and deleted or wrong-type items before writes", () => {
  const h = harness();
  h.context.createGuessingForm();
  const form = h.forms[0];
  form.items.reverse();
  const writes = h.calls.writes;
  assert.throws(() => h.context.refreshGuessingFormOptions(), /GUESS_ITEMS_INVALID/);
  assert.equal(h.calls.writes, writes);
  form.items.reverse();
  const person = form.getItemById(Number(h.properties.GUESS_PERSON_ITEM_ID));
  form.items.splice(form.items.indexOf(person), 1);
  assert.throws(() => h.context.refreshGuessingFormOptions(), /GUESS_ITEMS_INVALID/);
  assert.equal(h.calls.writes, writes);
  form.items.push(person);
  person.type = "LIST";
  assert.throws(() => h.context.refreshGuessingFormOptions(), /GUESS_ITEMS_INVALID/);
  assert.equal(h.calls.writes, writes);
});

test("refresh rejects a question moved into the wrong section before choices change", () => {
  const h = harness();
  h.context.createGuessingForm();
  const form = h.forms[0];
  [form.items[2], form.items[4]] = [form.items[4], form.items[2]];
  const writes = h.calls.writes;
  assert.throws(() => h.context.refreshGuessingFormOptions(), /GUESS_ITEMS_INVALID/);
  assert.equal(h.calls.writes, writes);
});

test("refresh rejects Devil page no longer submitting before choices change", () => {
  const h = harness();
  h.context.createGuessingForm();
  h.context.refreshGuessingFormOptions();
  const form = h.forms[0];
  const angelSection = form.getItemById(Number(h.properties.GUESS_ANGEL_SECTION_ID));
  angelSection.setGoToPage("CONTINUE");
  const writes = h.calls.writes;
  assert.throws(() => h.context.refreshGuessingFormOptions(), /GUESS_ITEMS_INVALID/);
  assert.equal(h.calls.writes, writes);
});

test("refresh rejects an unexpected trailing page before choices change", () => {
  const h = harness();
  h.context.createGuessingForm();
  h.forms[0].addPageBreakItem();
  const writes = h.calls.writes;
  assert.throws(() => h.context.refreshGuessingFormOptions(), /GUESS_ITEMS_INVALID/);
  assert.equal(h.calls.writes, writes);
});

test("refresh rejects invalid or unexpectedly empty roster before any Form mutation", () => {
  const h = harness();
  h.context.createGuessingForm();
  h.context.refreshGuessingFormOptions();
  const writes = h.calls.writes;
  h.participants.length = 0;
  assert.throws(() => h.context.refreshGuessingFormOptions(), /GUESS_ROSTER_EMPTY/);
  assert.equal(h.calls.writes, writes);
  assert.equal(h.forms[0].acceptingResponses, false);
});

test("failed Form write restores prior choices and exposes only fixed error codes", () => {
  const h = harness();
  h.context.createGuessingForm();
  const form = h.forms[0];
  const person = form.getItemById(Number(h.properties.GUESS_PERSON_ITEM_ID));
  const before = options(person);
  const devil = form.getItemById(Number(h.properties.GUESS_DEVIL_ITEM_ID));
  devil.failNextWrite = true;
  assert.throws(() => h.context.refreshGuessingFormOptions(), error =>
    /GUESS_REFRESH_FAILED/.test(error.message) && !/private participant data|amy|zoe/.test(error.message));
  assert.deepEqual(options(person), before);
});

test("scheduled refresh sanitizes configuration and lock service failures", () => {
  const h = harness();
  h.context.createGuessingForm();
  h.context.getScriptProperties_ = () => { throw new Error("private participant list"); };
  assert.throws(() => h.context.refreshGuessingFormOptions(), error =>
    /GUESS_CONFIG_UNAVAILABLE/.test(error.message) && !/private participant list/.test(error.message));
  h.context.LockService.getScriptLock = () => { throw new Error("private participant list"); };
  assert.throws(() => h.context.refreshGuessingFormOptions(), error =>
    /GUESS_LOCK_UNAVAILABLE/.test(error.message) && !/private participant list/.test(error.message));
});

test("timer is opt-in, single-owner idempotent, and removes only matching trigger", () => {
  const h = harness();
  assert.throws(() => h.context.installGuessingFormRefreshTrigger(), /GUESS_NOT_CONFIGURED/);
  assert.equal(h.triggers.length, 0);
  h.context.createGuessingForm();
  const other = {getHandlerFunction: () => "setupProject"};
  h.triggers.push(other);
  h.context.installGuessingFormRefreshTrigger();
  h.context.installGuessingFormRefreshTrigger();
  assert.equal(h.triggers.filter(trigger => trigger.getHandlerFunction() === "refreshGuessingFormOptions").length, 1);
  h.context.removeGuessingFormRefreshTrigger();
  assert.deepEqual(h.triggers, [other]);
});

test("timer installer waits for script lock before checking or creating triggers", () => {
  const h = harness();
  h.context.createGuessingForm();
  h.context.LockService.getScriptLock = () => ({tryLock: () => false, releaseLock: () => {}});
  assert.throws(() => h.context.installGuessingFormRefreshTrigger(), /GUESS_BUSY/);
  assert.equal(h.triggers.length, 0);
});

test("new guessing form with empty roster keeps placeholders without writes",()=>{
  const h=harness([]);h.context.createGuessingForm();const writes=h.calls.writes;
  assert.deepEqual(json(h.context.refreshGuessingFormOptions()),{ok:true,changed:false,participantCount:0,angelCount:0,devilCount:0});assert.equal(h.calls.writes,writes);
});
for(const role of ["Angel","Devil"])test("missing "+role+" candidates uses nonempty placeholder",()=>{
  const h=harness(sample.map(p=>({...p,roleToMortal:role==="Angel"?"Devil":"Angel"})));
  h.context.createGuessingForm();h.context.refreshGuessingFormOptions();
  const item=h.forms[0].getItemById(Number(h.properties[role==="Angel"?"GUESS_ANGEL_ITEM_ID":"GUESS_DEVIL_ITEM_ID"]));
  assert.deepEqual(json(options(item)),["No candidates available"]);
});
for(const field of ["GUESS_PERSON_ITEM_ID","GUESS_ANGEL_ITEM_ID","GUESS_DEVIL_ITEM_ID"])test("rollback after "+field+" failure restores all three lists",()=>{
  const h=harness();h.context.createGuessingForm();h.context.refreshGuessingFormOptions();
  const lists=["GUESS_PERSON_ITEM_ID","GUESS_ANGEL_ITEM_ID","GUESS_DEVIL_ITEM_ID"].map(key=>h.forms[0].getItemById(Number(h.properties[key])));
  const before=lists.map(item=>item.getChoices().slice());
  h.participants.forEach(p=>{p.name+=" revised";});h.forms[0].getItemById(Number(h.properties[field])).failNextWrite=true;
  assert.throws(()=>h.context.refreshGuessingFormOptions(),/GUESS_REFRESH_FAILED/);
  lists.forEach((item,i)=>assert.deepEqual(item.getChoices(),before[i]));assert.equal(h.calls.telegram,0);assert.equal(h.calls.rosterWrites,0);
});
test("rollback restoration failure has distinct fixed error and releases lock",()=>{
  const h=harness();h.context.createGuessingForm();h.context.refreshGuessingFormOptions();let releases=0;
  h.context.LockService.getScriptLock=()=>({tryLock:()=>true,releaseLock:()=>releases++});
  h.participants.forEach(p=>{p.name+=" revised";});
  const item=h.forms[0].getItemById(Number(h.properties.GUESS_DEVIL_ITEM_ID));item.setChoices=()=>{throw new Error("synthetic upstream details");};
  assert.throws(()=>h.context.refreshGuessingFormOptions(),e=>/GUESS_RESTORE_FAILED/.test(e.message)&&!e.message.includes("synthetic upstream"));assert.equal(releases,1);
});
for(const [stage,code] of [["form","FORM_UNAVAILABLE"],["roster","ROSTER_UNAVAILABLE"],["validation","PAIRING_NOT_READY"],["lock","LOCK_UNAVAILABLE"]])test("guessing "+stage+" failure leaves choice lists unchanged",()=>{
  const h=harness();h.context.createGuessingForm();const writes=h.calls.writes;
  const fail=()=>{throw new Error("synthetic upstream details");};
  if(stage==="form")h.context.FormApp.openById=fail;
  if(stage==="roster")h.context.readParticipants_=fail;
  if(stage==="validation")h.context.validateParticipants_=fail;
  if(stage==="lock")h.context.LockService.getScriptLock=fail;
  assert.throws(()=>h.context.refreshGuessingFormOptions(),new RegExp("GUESS_"+code));assert.equal(h.calls.writes,writes);
});
for(const method of ["installGuessingFormRefreshTrigger","removeGuessingFormRefreshTrigger"])for(const stage of ["list","mutation"])test(method+" handles "+stage+" failure and releases lock",()=>{
  const h=harness();h.context.createGuessingForm();h.context.installGuessingFormRefreshTrigger();let releases=0;
  h.context.LockService.getScriptLock=()=>({tryLock:()=>true,releaseLock:()=>releases++});
  const fail=()=>{throw new Error("synthetic trigger details");};
  if(stage==="list")h.context.ScriptApp.getProjectTriggers=fail;
  else if(method.startsWith("install")){h.triggers.length=0;h.context.ScriptApp.newTrigger=fail;}
  else h.context.ScriptApp.deleteTrigger=fail;
  assert.throws(()=>h.context[method](),/GUESS_TRIGGER_FAILED/);assert.equal(releases,1);
});
