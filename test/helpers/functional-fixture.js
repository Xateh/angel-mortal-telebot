"use strict";
const {createCoreFixture} = require("./core-fixture");
function fixture() {
  const h = createCoreFixture();
  h.logs = [];
  h.context.console = Object.fromEntries(["log", "warn", "error"].map(level => [level, (...args) => h.logs.push(args.join(" "))]));
  h.liveFormSheet.getRange(2, 10, 3, 2).setValues([["None", "Any"], ["None", "Any"], ["None", "Any"]]);
  h.setupProject();
  h.roster = h.spreadsheet.getSheetByName("Angel Mortal Roster");
  const people = h.context.readParticipants_();
  h.roster.getRange(2, 7, 3, 1).setValues([[people[1].key], [people[2].key], [people[0].key]]);
  for (const bot of ["angel", "mortal", "admin"]) h.properties.set(bot.toUpperCase() + "_BOT_TOKEN", bot + "-fixture-token");
  h.properties.set("ADMIN_TELEGRAM_ID", "90009");
  h.sent = [];
  h.context.telegramSendMessage_ = (bot, chat, text) => { h.sent.push({bot, chat: String(chat), text}); return {message_id: h.sent.length}; };
  h.people = () => h.context.readParticipants_();
  h.startAll = () => { for (const p of h.people()) for (const bot of ["angel", "mortal"]) h.context.markParticipantBotStarted_(p, bot); };
  h.admin = text => h.context.handleAdminUpdate_({message: {from: {id: 90009}, chat: {id: 90009, type: "private"}, text}});
  return h;
}
function lifecycle(h) {
  let now = 0, held = false;
  const entries = new Map(), faults = {}, calls = [];
  const fail = name => { if (faults[name]) throw new Error("synthetic " + name); };
  h.context.CacheService = {getScriptCache() { fail("cache"); return {
    get(key) { fail("get"); const e = entries.get(key); return e && e.until > now ? e.value : null; },
    put(key, value, ttl) { fail("put"); entries.set(key, {value, until: now + ttl * 1000}); },
    remove(key) { fail("remove"); entries.delete(key); }
  }; }};
  h.context.LockService = {getScriptLock() { fail("lock"); return {
    waitLock(ms) { calls.push(["wait", ms]); fail("acquire"); if (held) throw new Error("synthetic contention"); held = true; },
    releaseLock() { calls.push(["release"]); fail("release"); held = false; }
  }; }};
  return {faults, entries, calls, advance(ms) { now += ms; }, release() { held = false; }, held: () => held};
}
module.exports = {fixture, lifecycle};
