var AM_CONFIG = Object.freeze({
  SHEET_NAME: "Form Responses 1",
  ROSTER_SHEET_NAME: "Angel Mortal Roster",
  BOT_NAMES: ["angel", "mortal", "admin"],
  PARTICIPANT_BOTS: ["angel", "mortal"],
  TEST_MODE_ENABLED_PROPERTY: "TEST_MODE_ENABLED",
  TEST_TELEGRAM_ID_PROPERTY: "TEST_TELEGRAM_ID",
  TEST_TELEGRAM_NAME_PROPERTY: "TEST_TELEGRAM_NAME",
  TOKEN_PROPERTIES: Object.freeze({
    angel: "ANGEL_BOT_TOKEN",
    mortal: "MORTAL_BOT_TOKEN",
    admin: "ADMIN_BOT_TOKEN"
  }),
  USERNAME_PROPERTIES: Object.freeze({
    angel: "ANGEL_BOT_USERNAME",
    mortal: "MORTAL_BOT_USERNAME",
    admin: "ADMIN_BOT_USERNAME"
  }),
  WEBHOOK_KEY_PROPERTIES: Object.freeze({
    angel: "ANGEL_WEBHOOK_KEY",
    mortal: "MORTAL_WEBHOOK_KEY",
    admin: "ADMIN_WEBHOOK_KEY"
  }),
  MAX_TELEGRAM_TEXT: 4096,
  MAX_CAPTION: 1024,
  MAX_MEDIA_BYTES: 20 * 1024 * 1024,
  TELEGRAM_MAX_ATTEMPTS: 3,
  TELEGRAM_RETRY_BASE_MS: 500,
  TELEGRAM_MAX_RETRY_MS: 10000,
  TELEGRAM_WEBHOOK_MAX_CONNECTIONS: 10,
  UPDATE_PROCESSING_CACHE_SECONDS: 120,
  UPDATE_CACHE_SECONDS: 21600
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Angel Mortal")
    .addItem("Set up roster tab", "setupProject")
    .addItem("Refresh roster", "syncParticipants")
    .addItem("Validate configuration", "validateConfiguration")
    .addSeparator()
    .addItem("Install Telegram webhooks", "setupWebhooks")
    .addItem("Remove Telegram webhooks", "removeWebhooks")
    .addToUi();
}

function getScriptProperties_() {
  return PropertiesService.getScriptProperties();
}

function getProperty_(name) {
  return String(getScriptProperties_().getProperty(name) || "").trim();
}

function disableLiveTestMode() {
  var properties = getScriptProperties_();
  properties.deleteProperty(AM_CONFIG.TEST_MODE_ENABLED_PROPERTY);
  properties.deleteProperty(AM_CONFIG.TEST_TELEGRAM_ID_PROPERTY);
  properties.deleteProperty(AM_CONFIG.TEST_TELEGRAM_NAME_PROPERTY);
  console.log("Safe test mode is disabled.");
}

function requireProperty_(name) {
  var value = getProperty_(name);
  if (!value) {
    throw new Error("Missing Script Property: " + name);
  }
  return value;
}

function getBotToken_(bot) {
  if (!AM_CONFIG.TOKEN_PROPERTIES[bot]) {
    throw new Error("Unknown bot role: " + bot);
  }
  return requireProperty_(AM_CONFIG.TOKEN_PROPERTIES[bot]);
}

function getBotUsername_(bot) {
  return getProperty_(AM_CONFIG.USERNAME_PROPERTIES[bot]);
}

function supportHandles_() {
  var handles = getProperty_("SUPPORT_HANDLES").split(",").map(function (value) {
    return value.trim();
  }).filter(Boolean);
  return handles.length ? handles : ["@organiser"];
}

function organiserHelpText_() {
  var handles = supportHandles_();
  var list = handles[0];
  if (handles.length === 2) list = handles.join(" or ");
  if (handles.length > 2) list = handles.slice(0, -1).join(", ") + ", or " + handles[handles.length - 1];
  return "If you face any issues, message " + list + ".";
}

function withOrganiserHelp_(message) {
  return String(message || "") + "\n\n" + organiserHelpText_();
}

function getWebhookKey_(bot) {
  var propertyName = AM_CONFIG.WEBHOOK_KEY_PROPERTIES[bot];
  if (!propertyName) {
    throw new Error("Unknown bot role: " + bot);
  }
  return requireProperty_(propertyName);
}

function createWebhookKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function ensureWebhookKeys_() {
  var properties = getScriptProperties_();
  var updates = {};
  AM_CONFIG.BOT_NAMES.forEach(function (bot) {
    var propertyName = AM_CONFIG.WEBHOOK_KEY_PROPERTIES[bot];
    if (!properties.getProperty(propertyName)) {
      updates[propertyName] = createWebhookKey_();
    }
  });
  if (Object.keys(updates).length) {
    properties.setProperties(updates, false);
  }
}

function constantTimeEquals_(left, right) {
  left = String(left || "");
  right = String(right || "");
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var i = 0; i < length; i += 1) {
    mismatch |= (left.charCodeAt(i % Math.max(left.length, 1)) || 0) ^
      (right.charCodeAt(i % Math.max(right.length, 1)) || 0);
  }
  return mismatch === 0;
}

function getSpreadsheet_() {
  return getRosterSpreadsheet_();
}

function notifyUser_(title, message) {
  console.log(title + ": " + message);
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      active.toast(String(message), String(title), 8);
    }
  } catch (error) {
    console.log("UI notification unavailable: " + error.message);
  }
}

function setupProject() {
  var spreadsheetId = getProperty_("SPREADSHEET_ID") || getProperty_(FORM_IMPORT_CONFIG.SOURCE_ID_PROPERTY);
  if (!spreadsheetId) throw new Error("Set SPREADSHEET_ID to the linked Google Form response spreadsheet.");
  getScriptProperties_().setProperties({
    SPREADSHEET_ID: spreadsheetId,
    FORM_RESPONSES_SPREADSHEET_ID: spreadsheetId,
    FORM_RESPONSES_SHEET_NAME: getProperty_(FORM_IMPORT_CONFIG.SOURCE_SHEET_PROPERTY) || AM_CONFIG.SHEET_NAME
  }, false);
  setupParticipantsSheet_();
  var roster = syncParticipants_();
  ensureWebhookKeys_();
  notifyUser_(
    "Angel Mortal",
    "Roster tab ready: " + roster.total + " participants; " + roster.review + " need pairing review."
  );
  return roster;
}

function validateConfiguration() {
  var result = validateConfiguration_();
  notifyUser_(result.ok ? "Configuration valid" : "Configuration incomplete", result.message);
  return result;
}

function validateConfiguration_() {
  var missing = [];
  ["ANGEL_BOT_TOKEN", "MORTAL_BOT_TOKEN", "WEBHOOK_GATEWAY_URL"].forEach(function (name) {
    if (!getProperty_(name)) {
      missing.push(name);
    }
  });
  if (getProperty_("ADMIN_BOT_TOKEN") && !getProperty_("ADMIN_TELEGRAM_ID")) {
    missing.push("ADMIN_TELEGRAM_ID");
  }
  var sheetMessage = "";
  try {
    var summary = validateParticipants_();
    sheetMessage = summary.total + " participants; " + summary.registered + " registered.";
  } catch (error) {
    sheetMessage = "Participant sheet: " + error.message;
  }
  if (missing.length) {
    return {ok: false, message: "Missing Script Properties: " + missing.join(", ") + "\n\n" + sheetMessage};
  }
  return {ok: true, message: "Bot configuration is present. " + sheetMessage};
}

function textOutput_(text) {
  return ContentService.createTextOutput(String(text)).setMimeType(ContentService.MimeType.TEXT);
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
