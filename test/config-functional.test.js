"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const {fixture,lifecycle} = require("./helpers/functional-fixture");
test("disable test mode removes only test settings",()=>{
  const h=fixture();for(const key of ["TEST_MODE_ENABLED","TEST_TELEGRAM_ID","TEST_TELEGRAM_NAME"])h.properties.set(key,"fixture");
  const before=new Map(h.properties);h.context.disableLiveTestMode();
  for(const key of ["TEST_MODE_ENABLED","TEST_TELEGRAM_ID","TEST_TELEGRAM_NAME"])before.delete(key);
  assert.deepEqual(h.properties,before);
});
for(const method of ["syncParticipants","refreshFormIntake","applyFormIntake"])test(method+" refreshes without changing manual pairings or starts",()=>{
  const h=fixture();h.startAll();const before=h.roster.getRange(2,1,3,21).getDisplayValues();
  const result=h.context[method]();assert.equal(result.total,3);assert.equal(result.ready,3);
  const after=h.roster.getRange(2,1,3,21).getDisplayValues();
  for(let i=0;i<3;i++)for(const c of [6,18,19])assert.equal(after[i][c],before[i][c]);
});
test("configuration UI wrapper reports missing admin binding and invalid summary",()=>{
  const h=fixture();h.properties.set("WEBHOOK_GATEWAY_URL","https://gateway.example/telegram");h.properties.delete("ADMIN_TELEGRAM_ID");
  assert.equal(h.context.validateConfiguration().ok,false);assert.match(h.spreadsheet.toasts.at(-1),/ADMIN_TELEGRAM_ID/);
  h.properties.set("ADMIN_TELEGRAM_ID","90009");h.context.syncParticipants_=()=>({total:1,registered:2,review:0});
  assert.equal(h.context.validateConfiguration().ok,false);assert.match(h.spreadsheet.toasts.at(-1),/Invalid participant summary/);
});
test("menu exposes existing organizer actions; unavailable toast does not fail sync",()=>{
  const h=fixture(),items=[];h.ui.createMenu=()=>({addItem(label,handler){items.push(handler);return this;},addSeparator(){return this;},addToUi(){items.push("shown");}});
  h.context.onOpen();assert.deepEqual(items,["setupProject","syncParticipants","validateConfiguration","setupWebhooks","removeWebhooks","shown"]);
  h.context.SpreadsheetApp.getActiveSpreadsheet=()=>{throw new Error("synthetic UI unavailable");};assert.equal(h.context.syncParticipants().total,3);
  assert.ok(h.logs.some(text=>text.includes("UI notification unavailable")));
});
test("compatibility registration never accepts a code or creates new participants",()=>{
  const h=fixture(),before=h.roster.mutationCount;
  assert.equal(h.context.handleRegistration_("angel","10001","unused").name,"Alice");
  assert.equal(h.context.handleRegistration_("angel","99999","unused"),null);
  assert.equal(h.context.findParticipantByCode_("unused"),null);
  assert.equal(h.roster.mutationCount,before);assert.ok(h.sent.every(m=>/codes/i.test(m.text)));
});
for(const configured of [false,true])test("other bot hint with username configured="+configured,()=>{
  const h=fixture();if(configured)h.properties.set("MORTAL_BOT_USERNAME","MortalFixture");
  h.context.sendOtherBotHint_("angel","10001");assert.equal(h.sent.length,1);assert.equal(h.sent[0].chat,"10001");
  assert.match(h.sent[0].text,configured?/@MortalFixture/:/other Angel\/Mortal bot/);
});
test("failed cache removal retains processing marker until expiry",()=>{
  const h=fixture(),clock=lifecycle(h);h.context.beginUpdate_("angel",22);clock.faults.remove=true;
  h.context.forgetUpdate_("angel",22);assert.equal(h.context.beginUpdate_("angel",22),"processing");clock.advance(120000);assert.equal(h.context.beginUpdate_("angel",22),"new");
});
test("status storage failure does not change webhook acknowledgement",()=>{
  const h=fixture();lifecycle(h);h.propertyService.setProperties=()=>{throw new Error("synthetic status failure");};h.context.handleParticipantUpdate_=()=>{};
  assert.equal(h.context.doPost({parameter:{bot:"angel",key:h.properties.get("ANGEL_WEBHOOK_KEY")},postData:{contents:'{"update_id":13}'}}).text,"ok");
});
test("admin processing and failure-notice exceptions are contained",()=>{
  const h=fixture();h.context.syncParticipants_=()=>{throw new Error("synthetic unavailable");};
  h.context.telegramSendMessage_=()=>{throw new Error("synthetic delivery unavailable");};
  assert.doesNotThrow(()=>h.admin("/sync"));assert.ok(h.logs.some(line=>line.includes("Could not send admin failure notice")));
});
