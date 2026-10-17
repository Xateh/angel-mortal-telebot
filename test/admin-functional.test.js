"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const {fixture} = require("./helpers/functional-fixture");
for (const command of ["/list", "/codes", "/person Alice", "/person 10001", "/sync", "/help", "/start", "/unknown", "hello"]) {
  test("authorized admin " + command + " replies only to organizer", () => {
    const h = fixture(); h.admin(command);
    assert.ok(h.sent.length);
    assert.ok(h.sent.every(m => m.bot === "admin" && m.chat === "90009"));
    const text = h.sent.map(m => m.text).join("\n");
    assert.doesNotMatch(text, /Command failed|not found/);
    if (/^\/(list|codes)/.test(command)) for (const name of ["Alice", "Bob", "Charlie"]) assert.ok(text.includes(name));
    if (command.startsWith("/person")) { assert.match(text, /Name: Alice/); assert.match(text, /Mortal: Bob/); assert.match(text, /Angel: Charlie/); }
    if (command === "/sync") assert.match(text, /Synchronized 3 participants; 3 registered/);
  });
}
test("status counts current starts and handles each webhook status independently", () => {
  const h = fixture(); h.context.markParticipantBotStarted_(h.people()[0], "angel");
  h.context.telegramGetWebhookInfo_ = bot => {
    if (bot === "admin") throw new Error("synthetic unavailable");
    return {url: bot === "angel" ? "https://example.invalid" : "", last_error_message: ""};
  };
  h.admin("/status");
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /Participants: 3[\s\S]*Angel bot joined: 1[\s\S]*Mortal bot joined: 0/);
  for (const line of ["angel webhook: active", "mortal webhook: missing", "admin webhook: check failed"]) assert.ok(h.sent[0].text.includes(line));
});
for (const command of ["/reset", "/deregister"]) test(command + " resets only selected starts and preserves identities/mappings", () => {
  const h = fixture(); h.startAll();
  const before = h.roster.getDataRange().getDisplayValues();
  h.admin(command + " 10001");
  const after = h.roster.getDataRange().getDisplayValues();
  before[1][18] = ""; before[1][19] = "";
  assert.deepEqual(after, before);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].chat, "90009");
  for (const p of h.people()) for (const bot of ["angel", "mortal"]) assert.equal(h.context.participantHasStartedBot_(p, bot), p.telegramId !== "10001");
});
for (const command of ["/person absent", "/person", "/reset absent", "/reset"]) test(command + " changes no state", () => {
  const h = fixture(); const before = h.roster.mutationCount; h.admin(command);
  assert.match(h.sent[0].text, /Participant not found/); assert.equal(h.roster.mutationCount, before);
});
test("ambiguous reset identifier is rejected without writes", () => {
  const h = fixture(); h.liveFormSheet.getRange(3, 2).setValue("Alice"); const before = h.roster.mutationCount;
  h.admin("/reset Alice"); assert.match(h.sent[0].text, /Participant not found/); assert.equal(h.roster.mutationCount, before);
});
test("empty announcement is usage-only; mixed delivery reports exact scope", () => {
  const h = fixture(); h.admin("/announce"); assert.match(h.sent.pop().text, /Usage:/);
  const attempted = [], send = h.context.telegramSendMessage_;
  h.context.telegramSendMessage_ = (bot, chat, text) => {
    if (bot === "angel") { attempted.push(String(chat)); if (String(chat) === "20002") throw new Error("synthetic rejection"); }
    return send(bot, chat, text);
  };
  h.admin("/announce Test announcement");
  assert.deepEqual(attempted, ["10001", "20002", "30003"]);
  assert.ok(h.sent.slice(0,-1).every(m => m.bot === "angel" && m.text === "Organiser announcement:\nTest announcement"));
  assert.deepEqual(h.sent.at(-1), {bot:"admin", chat:"90009", text:"Announcement delivered to 2; failed for 1."});
});
test("missing participant commands and non-private admin updates are ignored", () => {
  const h = fixture();
  for (const update of [{}, {message:{}}, {message:{from:{id:90009},chat:{id:90009,type:"group"}}}]) h.context.handleAdminUpdate_(update);
  assert.equal(h.sent.length, 0);
});
