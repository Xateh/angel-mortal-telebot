function telegramApi_(bot, method, payload) {
  var token = getBotToken_(bot);
  for (var attempt = 0; attempt < AM_CONFIG.TELEGRAM_MAX_ATTEMPTS; attempt += 1) {
    var response;
    try {
      response = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/" + method, {
        method: "post",
        payload: payload || {},
        muteHttpExceptions: true
      });
    } catch (error) {
      if (attempt + 1 >= AM_CONFIG.TELEGRAM_MAX_ATTEMPTS) {
        throw new Error("Telegram " + method + " request failed: " + error.message);
      }
      Utilities.sleep(Math.min(
        AM_CONFIG.TELEGRAM_RETRY_BASE_MS * Math.pow(2, attempt),
        AM_CONFIG.TELEGRAM_MAX_RETRY_MS
      ));
      continue;
    }

    var status = response.getResponseCode();
    var bodyText = response.getContentText();
    var body;
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      if (status >= 500 && attempt + 1 < AM_CONFIG.TELEGRAM_MAX_ATTEMPTS) {
        Utilities.sleep(Math.min(
          AM_CONFIG.TELEGRAM_RETRY_BASE_MS * Math.pow(2, attempt),
          AM_CONFIG.TELEGRAM_MAX_RETRY_MS
        ));
        continue;
      }
      throw new Error("Telegram " + method + " returned HTTP " + status + " with a non-JSON response.");
    }

    if (status >= 200 && status < 300 && body.ok) return body.result;

    var retryable = status === 429 || status >= 500;
    if (retryable && attempt + 1 < AM_CONFIG.TELEGRAM_MAX_ATTEMPTS) {
      var retryAfter = Number(body.parameters && body.parameters.retry_after || 0) * 1000;
      Utilities.sleep(Math.min(
        retryAfter || AM_CONFIG.TELEGRAM_RETRY_BASE_MS * Math.pow(2, attempt),
        AM_CONFIG.TELEGRAM_MAX_RETRY_MS
      ));
      continue;
    }
    throw new Error("Telegram " + method + " failed: " + (body.description || ("HTTP " + status)));
  }
  throw new Error("Telegram " + method + " failed after retries.");
}

function telegramSendMessage_(bot, chatId, text, options) {
  var payload = Object.assign({
    chat_id: String(chatId),
    text: String(text).slice(0, AM_CONFIG.MAX_TELEGRAM_TEXT),
    disable_web_page_preview: true
  }, options || {});
  return telegramApi_(bot, "sendMessage", payload);
}

function telegramSendLongMessage_(bot, chatId, text) {
  splitTelegramText_(String(text), AM_CONFIG.MAX_TELEGRAM_TEXT).forEach(function (part) {
    telegramSendMessage_(bot, chatId, part);
  });
}

function splitTelegramText_(text, limit) {
  if (text.length <= limit) {
    return [text];
  }
  var parts = [];
  var remaining = text;
  while (remaining.length > limit) {
    var breakAt = remaining.lastIndexOf("\n", limit);
    if (breakAt < Math.floor(limit * 0.5)) {
      breakAt = limit;
    }
    parts.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^\n/, "");
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

function telegramGetFile_(bot, fileId) {
  return telegramApi_(bot, "getFile", {file_id: fileId});
}

function telegramDownloadFile_(bot, fileId, fileName) {
  var file = telegramGetFile_(bot, fileId);
  if (Number(file.file_size || 0) > AM_CONFIG.MAX_MEDIA_BYTES) {
    throw new Error("This media file is too large to relay. Telegram bots can download up to 20 MB.");
  }
  var token = getBotToken_(bot);
  var response = UrlFetchApp.fetch(
    "https://api.telegram.org/file/bot" + token + "/" + file.file_path,
    {muteHttpExceptions: true}
  );
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error("Telegram media download failed with HTTP " + response.getResponseCode() + ".");
  }
  var blob = response.getBlob();
  if (blob.getBytes().length > AM_CONFIG.MAX_MEDIA_BYTES) {
    throw new Error("This media file is too large to relay through Google Apps Script.");
  }
  blob.setName(fileName || String(file.file_path || "upload.bin").split("/").pop());
  return blob;
}

function telegramSendBlob_(bot, chatId, method, field, blob, caption) {
  var payload = {chat_id: String(chatId)};
  payload[field] = blob;
  if (caption) {
    payload.caption = String(caption).slice(0, AM_CONFIG.MAX_CAPTION);
  }
  return telegramApi_(bot, method, payload);
}

function telegramGetMe_(bot) {
  return telegramApi_(bot, "getMe", {});
}

function telegramGetWebhookInfo_(bot) {
  return telegramApi_(bot, "getWebhookInfo", {});
}

function inspectWebhookStatus() {
  var results = enabledBots_().map(function (bot) {
    var info = telegramGetWebhookInfo_(bot);
    var status = {
      bot: bot,
      installed: !!info.url,
      pendingUpdates: Number(info.pending_update_count || 0),
      lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : "",
      lastError: String(info.last_error_message || "").slice(0, 500)
    };
    console.log(JSON.stringify(status));
    return status;
  });
  return results;
}

function telegramSetWebhook_(bot, url) {
  return telegramApi_(bot, "setWebhook", {
    url: url,
    max_connections: AM_CONFIG.TELEGRAM_WEBHOOK_MAX_CONNECTIONS,
    allowed_updates: JSON.stringify(["message"]),
    drop_pending_updates: false
  });
}

function telegramDeleteWebhook_(bot, dropPendingUpdates) {
  return telegramApi_(bot, "deleteWebhook", {drop_pending_updates: !!dropPendingUpdates});
}

function enabledBots_() {
  return AM_CONFIG.BOT_NAMES.filter(function (bot) {
    return !!getProperty_(AM_CONFIG.TOKEN_PROPERTIES[bot]);
  });
}

function setupWebhooks() {
  ensureWebhookKeys_();
  if (!getProperty_("ANGEL_BOT_TOKEN") || !getProperty_("MORTAL_BOT_TOKEN")) {
    throw new Error("ANGEL_BOT_TOKEN and MORTAL_BOT_TOKEN are required.");
  }
  var gatewayUrl = getProperty_("WEBHOOK_GATEWAY_URL");
  if (!/^https:\/\//.test(gatewayUrl)) {
    throw new Error("Set WEBHOOK_GATEWAY_URL to the Cloudflare Worker /telegram endpoint before installing webhooks.");
  }
  var properties = getScriptProperties_();
  var results = enabledBots_().map(function (bot) {
    var me = telegramGetMe_(bot);
    properties.setProperty(AM_CONFIG.USERNAME_PROPERTIES[bot], me.username || "");
    var webhookUrl = gatewayUrl + "?bot=" + encodeURIComponent(bot) +
      "&key=" + encodeURIComponent(getWebhookKey_(bot));
    telegramSetWebhook_(bot, webhookUrl);
    var info = telegramGetWebhookInfo_(bot);
    return bot + ": @" + (me.username || "unknown") + " -> " + (info.url ? "installed" : "missing");
  });
  notifyUser_("Telegram webhooks", results.join("\n"));
  return results;
}

function removeWebhooks() {
  var results = enabledBots_().map(function (bot) {
    telegramDeleteWebhook_(bot, true);
    return bot + ": removed";
  });
  notifyUser_(
    "Telegram webhooks",
    results.length ? results.join("\n") : "No bot tokens are configured."
  );
  return results;
}

function resetWebhooksAndDropPendingUpdates() {
  var bots = enabledBots_();
  bots.forEach(function (bot) {
    telegramDeleteWebhook_(bot, true);
  });
  return setupWebhooks();
}

function relayTelegramMessage_(sourceBot, targetBot, targetChatId, message) {
  var kind = findMessageKind_(message);
  if (kind === "text") {
    return telegramSendMessage_(targetBot, targetChatId, message.text);
  }
  var descriptor = mediaDescriptor_(kind, message);
  if (!descriptor) {
    throw new Error("Unsupported Telegram message type.");
  }
  var blob = telegramDownloadFile_(sourceBot, descriptor.fileId, descriptor.fileName);
  return telegramSendBlob_(
    targetBot,
    targetChatId,
    descriptor.method,
    descriptor.field,
    blob,
    message.caption || ""
  );
}

function findMessageKind_(message) {
  if (message.text) return "text";
  if (message.photo && message.photo.length) return "photo";
  if (message.sticker) return "sticker";
  if (message.video) return "video";
  if (message.voice) return "voice";
  if (message.document) return "document";
  if (message.animation) return "animation";
  if (message.video_note) return "video_note";
  return "unsupported";
}

function mediaDescriptor_(kind, message) {
  var media;
  switch (kind) {
    case "photo":
      media = message.photo[message.photo.length - 1];
      return {fileId: media.file_id, fileName: "photo.jpg", method: "sendPhoto", field: "photo"};
    case "sticker":
      media = message.sticker;
      return {fileId: media.file_id, fileName: media.is_animated ? "sticker.tgs" : (media.is_video ? "sticker.webm" : "sticker.webp"), method: "sendSticker", field: "sticker"};
    case "video":
      media = message.video;
      return {fileId: media.file_id, fileName: media.file_name || "video.mp4", method: "sendVideo", field: "video"};
    case "voice":
      media = message.voice;
      return {fileId: media.file_id, fileName: "voice.ogg", method: "sendVoice", field: "voice"};
    case "document":
      media = message.document;
      return {fileId: media.file_id, fileName: media.file_name || "document.bin", method: "sendDocument", field: "document"};
    case "animation":
      media = message.animation;
      return {fileId: media.file_id, fileName: media.file_name || "animation.mp4", method: "sendAnimation", field: "animation"};
    case "video_note":
      media = message.video_note;
      return {fileId: media.file_id, fileName: "video-note.mp4", method: "sendVideoNote", field: "video_note"};
    default:
      return null;
  }
}
