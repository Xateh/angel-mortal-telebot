function doGet() {
  var summary;
  try {
    summary = validateParticipants_();
    return jsonOutput_({ok: true, service: "angel-mortal", participants: summary.total, registered: summary.registered});
  } catch (error) {
    return jsonOutput_({ok: false, service: "angel-mortal", error: "Participant roster is unavailable or needs review."});
  }
}

function isTelegramUpdate_(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Number.isSafeInteger(value.update_id) && value.update_id >= 0;
}

function doPost(e) {
  var bot = String(e && e.parameter && e.parameter.bot || "").toLowerCase();
  var suppliedKey = String(e && e.parameter && e.parameter.key || "");
  if (AM_CONFIG.BOT_NAMES.indexOf(bot) === -1) {
    return textOutput_("forbidden");
  }
  var expectedKey;
  try {
    expectedKey = getWebhookKey_(bot);
  } catch (error) {
    return textOutput_("forbidden");
  }
  if (!constantTimeEquals_(suppliedKey, expectedKey)) {
    return textOutput_("forbidden");
  }

  var update;
  try {
    update = JSON.parse(e.postData.contents);
  } catch (error) {
    console.error("Malformed webhook payload for " + bot + ".");
    recordWebhookStatus_(bot, "", "error: malformed webhook payload");
    return textOutput_("ok");
  }
  if (!isTelegramUpdate_(update)) {
    recordWebhookStatus_(bot, "", "error: invalid webhook update");
    return textOutput_("ok");
  }

  var updateState;
  try {
    updateState = beginUpdate_(bot, update.update_id);
  } catch (error) {
    console.error("Webhook deduplication failed for " + bot + ": " + safeDiagnostic_(error));
    recordWebhookStatus_(bot, update.update_id, "error: " + safeDiagnostic_(error));
    notifyWebhookFailure_(bot, update);
    return textOutput_("retry");
  }
  if (updateState === "done") return textOutput_("ok");
  if (updateState === "processing") return textOutput_("retry");

  try {
    if (bot === "admin") {
      handleAdminUpdate_(update);
    } else {
      handleParticipantUpdate_(bot, update);
    }
  } catch (error) {
    console.error("Webhook processing failed for " + bot + ": " + safeDiagnostic_(error));
    forgetUpdate_(bot, update.update_id);
    recordWebhookStatus_(bot, update.update_id, "error: " + safeDiagnostic_(error));
    notifyWebhookFailure_(bot, update);
    return textOutput_("retry");
  }
  try {
    markUpdateComplete_(bot, update.update_id);
  } catch (error) {
    console.error("Could not mark completed update: " + safeDiagnostic_(error));
  }
  recordWebhookStatus_(bot, update.update_id, "ok");
  return textOutput_("ok");
}

function notifyWebhookFailure_(bot, update) {
  var message = update && update.message;
  if (!message || !message.chat || message.chat.type !== "private") return;
  try {
    telegramSendMessage_(bot, message.chat.id, withOrganiserHelp_(
      "I could not confirm what happened to that message. It may have been processed; please check with the organisers before resending."
    ));
  } catch (error) {
    console.error("Could not notify user about webhook failure: " + safeDiagnostic_(error));
  }
}

function recordWebhookStatus_(bot, updateId, status) {
  try {
    getScriptProperties_().setProperties({
      LAST_WEBHOOK_STATUS: String(bot) + (updateId === "" ? "" : " update " + String(updateId)) + ": " + safeDiagnostic_(status).slice(0, 1500),
      LAST_WEBHOOK_STATUS_AT: new Date().toISOString()
    });
  } catch (error) {
    console.error("Could not record webhook status: " + safeDiagnostic_(error));
  }
}

function updateCacheKey_(bot, updateId) {
  return "update:" + bot + ":" + String(updateId);
}

function beginUpdate_(bot, updateId) {
  if (updateId === undefined || updateId === null) {
    return "new";
  }
  var cache = CacheService.getScriptCache();
  var key = updateCacheKey_(bot, updateId);
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var state = cache.get(key);
    if (state === "done" || state === "processing") return state;
    cache.put(key, "processing", AM_CONFIG.UPDATE_PROCESSING_CACHE_SECONDS);
    return "new";
  } finally {
    lock.releaseLock();
  }
}

function markUpdateComplete_(bot, updateId) {
  if (updateId === undefined || updateId === null) return;
  CacheService.getScriptCache().put(
    updateCacheKey_(bot, updateId),
    "done",
    AM_CONFIG.UPDATE_CACHE_SECONDS
  );
}

function forgetUpdate_(bot, updateId) {
  if (updateId === undefined || updateId === null) return;
  try {
    CacheService.getScriptCache().remove(updateCacheKey_(bot, updateId));
  } catch (error) {
    console.error("Could not clear failed update marker: " + safeDiagnostic_(error));
  }
}
