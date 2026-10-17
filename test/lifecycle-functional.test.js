"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const {fixture,lifecycle} = require("./helpers/functional-fixture");
test("processing and completion markers expire independently by bot",()=>{
  const h=fixture(),clock=lifecycle(h),c=h.context;
  assert.equal(c.beginUpdate_("angel",5),"new");assert.equal(c.beginUpdate_("angel",5),"processing");assert.equal(c.beginUpdate_("mortal",5),"new");
  c.markUpdateComplete_("angel",5);assert.equal(c.beginUpdate_("angel",5),"done");
  clock.advance(120000);assert.equal(c.beginUpdate_("mortal",5),"new");assert.equal(c.beginUpdate_("angel",5),"done");
  clock.advance(21600000);assert.equal(c.beginUpdate_("angel",5),"new");
  c.forgetUpdate_("angel",5);assert.equal(c.beginUpdate_("angel",5),"new");assert.equal(clock.held(),false);
  assert.equal(clock.calls.filter(c=>c[0]==="wait").length,clock.calls.filter(c=>c[0]==="release").length);
});
function event(h,id=7){return {parameter:{bot:"angel",key:h.properties.get("ANGEL_WEBHOOK_KEY")},postData:{contents:JSON.stringify({update_id:id,message:{from:{id:10001},chat:{id:10001,type:"private"},text:"fixture"}})}};}
for(const fault of ["lock","acquire","get","put","release"]) test("webhook "+fault+" failure retries without dispatch",()=>{
  const h=fixture(),clock=lifecycle(h);clock.faults[fault]=true;let dispatched=0;h.context.handleParticipantUpdate_=()=>dispatched++;
  assert.equal(h.context.doPost(event(h)).text,"retry");assert.equal(dispatched,0);
  if(["get","put"].includes(fault))assert.equal(clock.held(),false);
  delete clock.faults[fault];clock.release();clock.advance(120000);
  assert.equal(h.context.doPost(event(h)).text,"ok");assert.equal(dispatched,1);
});
test("webhook processing/done markers suppress redispatch; failure clears marker for retry",()=>{
  const h=fixture();lifecycle(h);const c=h.context;let dispatches=0;
  c.handleParticipantUpdate_=()=>{dispatches++;throw new Error("synthetic processing failure");};
  assert.equal(c.doPost(event(h)).text,"retry");assert.equal(dispatches,1);
  c.handleParticipantUpdate_=()=>dispatches++;
  assert.equal(c.doPost(event(h)).text,"ok");assert.equal(c.doPost(event(h)).text,"ok");assert.equal(dispatches,2);
  c.beginUpdate_("angel",8);assert.equal(c.doPost(event(h,8)).text,"retry");assert.equal(dispatches,2);
});
test("completion cache failure acknowledges processed update and retries only after marker expires",()=>{
  const h=fixture(),clock=lifecycle(h);let calls=0;
  h.context.handleParticipantUpdate_=()=>{calls++;clock.faults.put=true;};
  assert.equal(h.context.doPost(event(h)).text,"ok");delete clock.faults.put;
  assert.equal(h.context.doPost(event(h)).text,"retry");assert.equal(calls,1);
  clock.advance(120000);assert.equal(h.context.doPost(event(h)).text,"ok");assert.equal(calls,2);
});
for(const operation of ["start-sheet","start-property","reset-sheet","reset-property"]) test(operation+" write failure preserves unrelated rows and recovers",()=>{
  const h=fixture(),clock=lifecycle(h);h.startAll();
  const p=h.people()[0],before=h.roster.getRange(3,1,2,21).getDisplayValues();
  const setter=h.roster.setCell.bind(h.roster),setProperty=h.propertyService.setProperty,del=h.propertyService.deleteProperty;
  if(operation.startsWith("start")) h.context.deregisterParticipant_(p);
  if(operation.endsWith("sheet"))h.roster.setCell=(r,c,v)=>{if(r===2&&c===19)throw new Error("synthetic storage failure");return setter(r,c,v);};
  if(operation==="start-property")h.propertyService.setProperty=()=>{throw new Error("synthetic property failure");};
  if(operation==="reset-property")h.propertyService.deleteProperty=()=>{throw new Error("synthetic property failure");};
  const run=()=>operation.startsWith("start")?h.context.markParticipantBotStarted_(h.people()[0],"angel"):h.context.deregisterParticipant_(h.people()[0]);
  assert.throws(run,/synthetic/);assert.equal(clock.held(),false);assert.deepEqual(h.roster.getRange(3,1,2,21).getDisplayValues(),before);
  if(operation.endsWith("property"))assert.equal(h.context.participantHasStartedBot_(h.people()[0],"angel"),false);
  h.roster.setCell=setter;h.propertyService.setProperty=setProperty;h.propertyService.deleteProperty=del;run();
  assert.equal(h.context.participantHasStartedBot_(h.people()[0],"angel"),operation.startsWith("start"));
  assert.deepEqual(h.roster.getRange(3,1,2,21).getDisplayValues(),before);
});
for(const layout of ["LEGACY_ROSTER_HEADERS","PRE_FORMULA_ROSTER_HEADERS"]) test(layout+" migration preserves mapping and start columns",()=>{
  const h=fixture(),c=h.context;const sheet=h.roster;const headers=Array.from(c[layout]);
  sheet.values=[];sheet.formulas=[];sheet.maxColumns=headers.length;
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  const row=headers.map(header=>({Mortal:"Bob [20002]","Angel Bot Started At":"old angel","Mortal Bot Started At":"old mortal"}[header]||""));
  sheet.getRange(2,1,1,row.length).setValues([row]);c.setupParticipantsSheet_();
  assert.equal(sheet.cell(2,7),"Bob [20002]");assert.equal(sheet.cell(2,19),"old angel");assert.equal(sheet.cell(2,20),"old mortal");
  assert.deepEqual(sheet.getRange(1,1,1,21).getDisplayValues()[0],Array.from(c.ROSTER_HEADERS));assert.equal(sheet.maxColumns,21);
});
test("unfamiliar roster layout is refused without mutation",()=>{
  const h=fixture();h.roster.setCell(1,1,"Unfamiliar");const before=h.roster.mutationCount;
  assert.throws(()=>h.context.setupParticipantsSheet_(),/headers have changed/);assert.equal(h.roster.mutationCount,before);
});
test("participant missing fields are ignored and group messages never route to a partner",()=>{
  const h=fixture();let left=0;h.context.telegramApi_=(_bot,method)=>{assert.equal(method,"leaveChat");left++;};
  for(const update of [{},{message:{}},{message:{from:{id:10001}}}])h.context.handleParticipantUpdate_("angel",update);
  assert.equal(h.sent.length,0);
  h.context.handleParticipantUpdate_("angel",{message:{from:{id:10001},chat:{id:-123,type:"group"},text:"fixture"}});
  assert.equal(left,1);assert.equal(h.sent.length,1);assert.equal(h.sent[0].chat,"-123");
});
for(const bot of ["angel","mortal"])for(const command of ["/mortal","/angel","/unknown","/deregister"])test(bot+" participant "+command+" preserves existing dispatcher behavior",()=>{
  const h=fixture();h.startAll();const before=h.roster.mutationCount;
  h.context.handleParticipantUpdate_(bot,{message:{from:{id:10001},chat:{id:10001,type:"private"},text:command}});
  assert.ok(h.sent.length);assert.ok(h.sent.every(m=>m.chat==="10001"&&m.bot===bot));assert.equal(h.roster.mutationCount,before);
  if(command==="/mortal"&&bot==="mortal")assert.match(h.sent[0].text,/Your mortal is Bob/);
  if(command==="/angel")assert.match(h.sent[0].text,/identity (is|stays) secret/);
  if(command==="/deregister")assert.equal(h.context.participantHasStartedBot_(h.people()[0],bot),true);
});
