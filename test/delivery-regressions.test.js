"use strict";

const assert = require("node:assert/strict");
const {test} = require("node:test");

const {createCoreFixture: fixture} = require("./helpers/core-fixture");

function captureTelegram(value, responder = () => ({status: 200, body: {ok: true, result: {message_id: 1}}})) {
  const {context, properties} = value;
  const calls = [];
  for (const role of ["ANGEL", "MORTAL", "ADMIN"]) properties.set(`${role}_BOT_TOKEN`, `${role.toLowerCase()}-test-token`);
  context.UrlFetchApp.fetch = (url, options) => {
    const bot = ["angel", "mortal", "admin"].find(role => String(url).includes(`${role}-test-token`));
    const call = {bot, method: String(url).split("/").pop(), payload: options.payload};
    calls.push(call);
    const answer = responder(call);
    if (answer instanceof Error) throw answer;
    return {
      getResponseCode: () => answer.status,
      getContentText: () => JSON.stringify(answer.body)
    };
  };
  return calls;
}

function pair(value) {
  for (const row of [2, 3, 4]) {
    value.liveFormSheet.getRange(row, 10).setValue("None");
    value.liveFormSheet.getRange(row, 11).setValue("No preference");
  }
  value.setupProject();
  const roster = value.spreadsheet.getSheetByName("Angel Mortal Roster");
  const participants = value.context.readParticipants_();
  const byName = Object.fromEntries(participants.map(participant => [participant.name, participant]));
  roster.getRange(2, 7, 3, 1).setValues([[byName.Bob.key], [byName.Charlie.key], [byName.Alice.key]]);
  const directory = value.context.currentParticipantDirectory_();
  const alice = directory.participants.find(participant => participant.name === "Alice");
  assert.ok(value.context.resolveSafeRelayRoute_(alice, "mortal", directory.byId),
    JSON.stringify(directory.participants.map(participant => ({name: participant.name, key: participant.key, mortalId: participant.mortalId, angelId: participant.angelId, issues: participant.formIssues}))));
  return roster;
}

test("deregistration clears readiness and tells both bots how to register again", () => {
  const value = fixture();
  pair(value);
  const participant = value.context.readParticipants_()[0];
  for (const bot of ["angel", "mortal"]) {
    value.context.markParticipantBotStarted_(participant, bot);
    assert.equal(value.context.participantHasStartedBot_(participant, bot), true);
  }
  const calls = captureTelegram(value);
  value.context.handleSelfDeregister_(participant.telegramId, participant);
  assert.deepEqual(calls.map(call => call.bot), ["angel", "mortal"]);
  for (const call of calls) {
    assert.equal(call.payload.chat_id, participant.telegramId);
    assert.match(call.payload.text, /Send \/start to both the Angel bot and the Mortal bot/);
    assert.doesNotMatch(call.payload.text, /code/i);
  }
  const current = value.context.readParticipants_()[0];
  for (const bot of ["angel", "mortal"]) {
    assert.equal(value.context.participantHasStartedBot_(current, bot), false);
  }
});

test("Unicode chunks preserve all code points and trailing safety text", () => {
  const {context} = fixture();
  for (const text of [
    "x".repeat(4095) + "🙂\nOff limits: keep this line",
    "🙂".repeat(3000) + "\nBoundary: no entry",
    "🙂a".repeat(2300) + "\nFinal condition"
  ]) {
    const chunks = Array.from(context.splitTelegramText_(text, 4096));
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every(chunk => Array.from(chunk).length <= 4096));
    assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(chunk)));
  }
});

test("both direct and partner-start introductions deliver complete long profiles", () => {
  const value = fixture();
  const calls = captureTelegram(value);
  const intro = "🙂".repeat(5000) + "\nOff limits: ask first";
  const mortal = {name: "Mortal", room: "21-01", intro, telegramId: "20002"};
  value.context.sendMortalDetails_("mortal", "10001", {mortalId: "m" , roleToMortal: "Angel"}, {m: mortal});
  assert.equal(calls.filter(call => call.bot === "mortal").map(call => call.payload.text).join(""),
    "You are acting as Angel for this mortal.\n\nYour mortal is Mortal!\nRoom: 21-01\n" + intro);
  calls.length = 0;
  value.context.participantHasStartedBot_ = () => true;
  value.context.notifyPartnerOfBotStart_({name: mortal.name, room: mortal.room, intro, angelId: "a"}, "angel", {
    a: {telegramId: "10001", mortalBotStartedAt: "now"}
  });
  const partnerTexts = calls.filter(call => call.bot === "mortal").map(call => call.payload.text);
  assert.ok(partnerTexts.length > 2);
  assert.equal(partnerTexts.slice(1).join(""), "Your mortal is Mortal!\nRoom: 21-01\n" + intro);
});

test("Unicode captions remain complete, and continuation failure is reported as partial delivery", () => {
  const value = fixture();
  const calls = captureTelegram(value);
  const shortCaption = "🙂".repeat(900);
  value.context.telegramSendBlob_("angel", "10001", "sendPhoto", "photo", {fake: true}, shortCaption);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.caption, shortCaption);
  calls.length = 0;
  const longCaption = "🙂".repeat(1100) + "\nDo not share this";
  value.context.telegramSendBlob_("angel", "10001", "sendPhoto", "photo", {fake: true}, longCaption);
  assert.equal(calls[0].payload.caption + calls.slice(1).map(call => call.payload.text.replace(/^Caption continued:\n/, "")).join(""), longCaption);
  assert.ok(calls.slice(1).every(call => call.payload.text.startsWith("Caption continued:\n")));
  const failing = fixture();
  captureTelegram(failing, call => call.method === "sendMessage"
    ? {status: 403, body: {ok: false, description: "Forbidden"}}
    : {status: 200, body: {ok: true, result: {message_id: 1}}});
  assert.throws(() => failing.context.telegramSendBlob_("angel", "10001", "sendPhoto", "photo", {fake: true}, longCaption),
    error => error.partialDelivery === true);
});

test("long text relay returns the final Telegram acknowledgement", () => {
  const value = fixture();
  let number = 0;
  const calls = captureTelegram(value, () => ({status: 200, body: {ok: true, result: {message_id: ++number}}}));
  const text = "🙂".repeat(5000) + "\nFinal boundary";
  const result = value.context.relayTelegramMessage_("mortal", "angel", "20002", {text});
  assert.equal(calls.map(call => call.payload.text).join(""), text);
  assert.equal(result.message_id, calls.length);
});

test("authenticated webhook requires a safe update ID before deduplication", () => {
  const {context, properties, cache} = fixture();
  properties.set("ANGEL_WEBHOOK_KEY", "z".repeat(40));
  for (const value of [null, [], "hello", 7, {}, {update_id: -1}, {update_id: 1.5}, {update_id: Number.MAX_SAFE_INTEGER + 1}]) {
    assert.equal(context.isTelegramUpdate_(value), false);
    const response = context.doPost({parameter: {bot: "angel", key: properties.get("ANGEL_WEBHOOK_KEY")}, postData: {contents: JSON.stringify(value)}});
    assert.equal(response.text, "ok");
    assert.equal(cache.size, 0);
  }
  assert.equal(context.isTelegramUpdate_({update_id: 0}), true);
});

test("configuration accepts a readable unpaired roster and reports review count", () => {
  const value = fixture();
  for (const name of ["ANGEL_BOT_TOKEN", "MORTAL_BOT_TOKEN", "WEBHOOK_GATEWAY_URL"]) value.properties.set(name, "synthetic-only");
  value.setupProject();
  assert.throws(() => value.context.validateParticipants_(), /need pairing review/i);
  const result = value.context.validateConfiguration_();
  assert.equal(result.ok, true);
  assert.match(result.message, /3 participants; 3 registered.*3 need pairing review/i);
});

test("configuration accepts a readable empty Form and roster", () => {
  const value = fixture();
  for (const name of ["ANGEL_BOT_TOKEN", "MORTAL_BOT_TOKEN", "WEBHOOK_GATEWAY_URL"]) value.properties.set(name, "synthetic-only");
  value.liveFormSheet.values.length = 1;
  value.setupProject();
  const roster = value.spreadsheet.getSheetByName("Angel Mortal Roster");
  roster.values.length = 1; // In Sheets, the roster spill recalculates after Form responses clear.
  assert.equal(roster.getLastRow(), 1);
  assert.throws(() => value.context.validateParticipants_(), /At least two form participants/i);
  const result = value.context.validateConfiguration_();
  assert.equal(result.ok, true);
  assert.match(result.message, /0 participants; 0 registered/i);
});

test("configuration fails closed for missing or malformed Sheets", () => {
  const value = fixture();
  for (const name of ["ANGEL_BOT_TOKEN", "MORTAL_BOT_TOKEN", "WEBHOOK_GATEWAY_URL"]) value.properties.set(name, "synthetic-only");
  value.setupProject();
  value.properties.set("SPREADSHEET_ID", "missing-synthetic-spreadsheet");
  assert.equal(value.context.validateConfiguration_().ok, false);
  value.properties.set("SPREADSHEET_ID", value.spreadsheet.id);
  value.liveFormSheet.values.length = 1;
  value.liveFormSheet.getRange(1, 2).setValue("Unexpected heading");
  assert.equal(value.context.validateConfiguration_().ok, false);
});

test("partner notice rejection cannot turn saved registration into remapping advice", () => {
  const value = fixture();
  pair(value);
  const alice = value.context.readParticipants_().find(participant => participant.name === "Alice");
  value.context.markParticipantBotStarted_(alice, "mortal");
  const calls = captureTelegram(value, call => call.bot === "mortal"
    ? {status: 403, body: {ok: false, description: "Forbidden"}}
    : {status: 200, body: {ok: true, result: {message_id: 1}}});
  value.context.handleParticipantUpdate_("angel", {update_id: 201, message: {from: {id: 20002}, chat: {id: 20002, type: "private"}, text: "/start"}});
  assert.ok(value.context.readParticipants_().find(participant => participant.name === "Bob").angelBotStartedAt);
  const ownTexts = calls.filter(call => call.bot === "angel" && call.payload.chat_id === "20002").map(call => call.payload.text).join("\n");
  assert.match(ownTexts, /registration.*saved|registered/i);
  assert.match(ownTexts, /partner|notification/i);
  assert.doesNotMatch(ownTexts, /pairing changed|mapping|send \/start again/i);
});

test("same-channel cooldown suppresses feedback retries and reports wait on other channel", () => {
  const value = fixture();
  const calls = captureTelegram(value, call => call.bot === "angel"
    ? {status: 429, body: {ok: false, description: "Too Many Requests", parameters: {retry_after: 60}}}
    : {status: 200, body: {ok: true, result: {message_id: 1}}});
  assert.throws(() => value.context.telegramSendMessage_("angel", "10001", "first"), error => error.retryAfterSeconds === 60);
  value.context.sendParticipantFailure_("angel", "10001", "Fallback");
  value.context.notifyWebhookFailure_("angel", {message: {chat: {id: "10001", type: "private"}}});
  assert.equal(calls.filter(call => call.bot === "angel" && call.payload.chat_id === "10001").length, 1);
  let rejection;
  try { value.context.telegramSendMessage_("angel", "10001", "second"); } catch (error) { rejection = error; }
  value.context.sendDeliveryFailure_("mortal", "20002", rejection, "Your message");
  assert.match(calls.filter(call => call.bot === "mortal").at(-1).payload.text, /wait at least 60 seconds/i);
  value.context.Date = class extends Date { static now() { return Date.now() + 61000; } };
  assert.throws(() => value.context.telegramSendMessage_("angel", "10001", "after expiry"), error => error.retryAfterSeconds === 60);
  assert.equal(calls.filter(call => call.bot === "angel" && call.payload.chat_id === "10001").length, 2);
});

test("long Telegram flood wait uses valid cache TTL while preserving full wait", () => {
  const value = fixture();
  const cache = value.context.CacheService.getScriptCache();
  const writes = [];
  value.context.CacheService.getScriptCache = () => ({
    get: key => cache.get(key),
    put: (key, expiry, ttl) => {
      assert.ok(ttl <= 21600, "Google CacheService rejects longer TTLs");
      writes.push({key, expiry: Number(expiry), ttl});
      cache.put(key, expiry, ttl);
    }
  });
  const calls = captureTelegram(value, () => ({status: 429, body: {ok: false, parameters: {retry_after: 30000}}}));
  const before = Date.now();
  assert.throws(() => value.context.telegramSendMessage_("angel", "10001", "first"),
    error => error.deliveryStatus === "rejected" && error.retryAfterSeconds === 30000);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ttl, 21600);
  assert.ok(writes[0].expiry >= before + 30000000);
  assert.throws(() => value.context.telegramSendMessage_("angel", "10001", "second"),
    error => error.retryAfterSeconds > 21600);
  assert.equal(calls.length, 1);
});

test("failed cooldown cache write still blocks same-channel feedback within execution", () => {
  const value = fixture();
  value.context.CacheService.getScriptCache = () => ({
    get: () => null,
    put: () => { throw new Error("synthetic cache outage"); }
  });
  const calls = captureTelegram(value, () => ({status: 429, body: {ok: false, parameters: {retry_after: 60}}}));
  assert.throws(() => value.context.telegramSendMessage_("angel", "10001", "first"),
    error => error.deliveryStatus === "rejected" && error.retryAfterSeconds === 60);
  value.context.sendParticipantFailure_("angel", "10001", "Fallback");
  assert.equal(calls.length, 1);
});

test("safe relay success is not reported as failed when acknowledgement is rejected", () => {
  const value = fixture();
  let ownSends = 0;
  const calls = captureTelegram(value, call => {
    if (call.bot === "mortal" && ++ownSends === 1) {
      return {status: 403, body: {ok: false, description: "Forbidden"}};
    }
    return {status: 200, body: {ok: true, result: {message_id: 1}}};
  });
  value.context.handleLiveTestUpdate_("mortal", {
    update_id: 305,
    message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "synthetic relay"}
  });
  assert.equal(calls.filter(call => call.bot === "angel" && call.payload.text === "synthetic relay").length, 1);
  const feedback = calls.filter(call => call.bot === "mortal").at(-1).payload.text;
  assert.match(feedback, /(?:safe )?relay.*(?:succeeded|passed|reached)|test passed.*relayed/i);
  assert.doesNotMatch(feedback, /relay test message was not delivered/i);
});

test("partial participant start does not claim earlier welcome messages failed", () => {
  const value = fixture();
  pair(value);
  let ownSends = 0;
  const calls = captureTelegram(value, call => {
    if (call.bot === "mortal" && call.payload.chat_id === "10001" && ++ownSends === 3) {
      return {status: 403, body: {ok: false, description: "Forbidden"}};
    }
    return {status: 200, body: {ok: true, result: {message_id: 1}}};
  });
  value.context.handleParticipantUpdate_("mortal", {
    update_id: 306,
    message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/start"}
  });
  assert.ok(value.context.readParticipants_().find(participant => participant.name === "Alice").mortalBotStartedAt);
  const own = calls.filter(call => call.bot === "mortal" && call.payload.chat_id === "10001");
  assert.match(own[0].payload.text, /^Welcome Alice!/);
  assert.match(own[1].payload.text, /role for this pairing/i);
  assert.match(own.at(-1).payload.text, /partly delivered|remaining.*may not have arrived/i);
  assert.doesNotMatch(own.at(-1).payload.text, /welcome\/profile message was not delivered/i);
});

test("start, help, safe-test and admin feedback make no second send on same-channel cooldown", () => {
  const cases = [
    value => {
      pair(value);
      value.context.handleParticipantUpdate_("mortal", {update_id: 301, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/start"}});
      assert.ok(value.context.readParticipants_().find(participant => participant.name === "Alice").mortalBotStartedAt);
      return "mortal";
    },
    value => {
      pair(value);
      value.context.handleParticipantUpdate_("mortal", {update_id: 302, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/help"}});
      return "mortal";
    },
    value => {
      value.properties.set("TEST_MODE_ENABLED", "true");
      value.properties.set("TEST_TELEGRAM_ID", "10001");
      value.context.handleParticipantUpdate_("mortal", {update_id: 303, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/help"}});
      return "mortal";
    },
    value => {
      value.properties.set("ADMIN_TELEGRAM_ID", "10001");
      value.properties.set("ADMIN_WEBHOOK_KEY", "z".repeat(40));
      value.context.doPost({parameter: {bot: "admin", key: value.properties.get("ADMIN_WEBHOOK_KEY")},
        postData: {contents: JSON.stringify({update_id: 304, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "/help"}})}});
      return "admin";
    }
  ];
  for (const run of cases) {
    const value = fixture();
    const calls = captureTelegram(value, () => ({status: 429, body: {ok: false, parameters: {retry_after: 60}}}));
    const bot = run(value);
    assert.equal(calls.filter(call => call.bot === bot && call.payload.chat_id === "10001").length, 1);
  }
});

test("chatless media lookup cooldown suppresses a same-bot failure notice", () => {
  const value = fixture();
  const calls = captureTelegram(value, () => ({status: 429, body: {ok: false, parameters: {retry_after: 60}}}));
  assert.throws(() => value.context.telegramApi_("angel", "getFile", {file_id: "synthetic"}), error => error.retryAfterSeconds === 60);
  value.context.sendParticipantFailure_("angel", "10001", "Media unavailable");
  assert.equal(calls.length, 1);
});

test("ambiguous target timeout never tells sender delivery definitely failed", () => {
  const value = fixture();
  pair(value);
  const bob = value.context.readParticipants_().find(participant => participant.name === "Bob");
  value.context.markParticipantBotStarted_(bob, "angel");
  const calls = captureTelegram(value, call => call.bot === "angel"
    ? new Error("synthetic timeout")
    : {status: 200, body: {ok: true, result: {message_id: 1}}});
  value.context.handleParticipantUpdate_("mortal", {update_id: 203, message: {from: {id: 10001}, chat: {id: 10001, type: "private"}, text: "hello"}});
  const own = calls.filter(call => call.bot === "mortal" && call.payload.chat_id === "10001").map(call => call.payload.text).join("\n");
  assert.match(own, /could not be confirmed|unknown|may have been delivered/i);
  assert.doesNotMatch(own, /was not sent|try once more/i);
});

test("diagnostics and admin summaries hide configured secrets and private URLs", () => {
  const {context, properties} = fixture();
  const secret = "synthetic-sensitive-token-" + "x".repeat(24);
  const url = "https://" + "private.example/path?key=" + secret;
  properties.set("ANGEL_BOT_TOKEN", secret);
  properties.set("WEBHOOK_GATEWAY_URL", url);
  context.recordWebhookStatus_("angel", 41, `error: ${url} ${secret}`);
  assert.doesNotMatch(properties.get("LAST_WEBHOOK_STATUS"), /private\.example|synthetic-sensitive-token/);
  const texts = [];
  context.telegramSendLongMessage_ = (_bot, _chat, text) => texts.push(text);
  context.validateParticipants_ = () => ({total: 0, registered: 0, participants: []});
  context.enabledBots_ = () => ["angel"];
  context.telegramGetWebhookInfo_ = () => ({url: "configured", last_error_message: `failed ${url} ${secret}`});
  context.adminStatus_("10001");
  assert.doesNotMatch(texts.join("\n"), /private\.example|synthetic-sensitive-token/);
});

test("webhook catch still responds when diagnostic property reads fail", () => {
  const {context} = fixture();
  const secret = "synthetic-sensitive-diagnostic-token";
  const logs = [];
  context.console = {error: text => logs.push(String(text)), warn: text => logs.push(String(text))};
  context.PropertiesService.getScriptProperties = () => ({
    getProperty(name) {
      if (name === "ANGEL_WEBHOOK_KEY") return "z".repeat(40);
      throw new Error("synthetic properties outage");
    },
    setProperties() { throw new Error("synthetic properties outage"); }
  });
  context.beginUpdate_ = () => { throw new Error("failure carrying " + secret); };
  const response = context.doPost({
    parameter: {bot: "angel", key: "z".repeat(40)},
    postData: {contents: JSON.stringify({update_id: 307, message: {chat: {id: 10001, type: "private"}}})}
  });
  assert.equal(response.text, "retry");
  assert.ok(logs.length);
  assert.doesNotMatch(logs.join("\n"), /synthetic-sensitive-diagnostic-token/);
});

test("webhook failure notice does not prescribe a duplicate when processing outcome is unknown", () => {
  const value = fixture();
  const calls = captureTelegram(value);
  value.context.notifyWebhookFailure_("angel", {message: {chat: {id: "10001", type: "private"}}});
  assert.equal(calls.length, 1);
  assert.match(calls[0].payload.text, /could not confirm|may have|unclear/i);
  assert.doesNotMatch(calls[0].payload.text, /send it again/i);
});
