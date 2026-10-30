var FORM_IMPORT_CONFIG = Object.freeze({
  SOURCE_ID_PROPERTY: "FORM_RESPONSES_SPREADSHEET_ID",
  SOURCE_SHEET_PROPERTY: "FORM_RESPONSES_SHEET_NAME",
  DEFAULT_SOURCE_SHEET: "Form Responses 1"
});

var FORM_HEADER_PREFIXES = Object.freeze({
  timestamp: ["timestamp"],
  name: ["what's your name"],
  gender: ["gender"],
  room: ["what's your room no"],
  telegramHandle: ["what's your tele handle"],
  telegramId: ["what's your tele telegram user id"],
  year: ["what's your year of study"],
  faculty: ["which faculty are you from"],
  interests: ["share some of your interests"],
  specialRequirements: ["do you have any special requirements"],
  genderPreference: ["any gender preference for a&m"],
  mode: ["angel and mortal (welfare only) or devil and mortal"],
  prankTolerance: ["level of prank tolerance"],
  roomEntry: ["are you okay with your devil entering your room"],
  boundaries: ["please specify any boundaries/things that are off limits"],
  declaration: ["i have looked through and understood the rules"]
});

// Shared parser/formula whitespace contract. Free text loses edge whitespace only.
var FORM_WHITESPACE_CODEPOINTS_ = Object.freeze([
  9, 10, 11, 12, 13, 32, 133, 160, 5760, 8192, 8193, 8194, 8195,
  8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279
]);

function formWhitespaceClass_(sheetFormula) {
  return "[" + FORM_WHITESPACE_CODEPOINTS_.map(function (codepoint) {
    return sheetFormula ? "\\x{" + codepoint.toString(16) + "}" : String.fromCharCode(codepoint);
  }).join("") + "]";
}

function formText_(value) {
  var space = formWhitespaceClass_(false);
  return String(value == null ? "" : value).replace(new RegExp("^" + space + "+|" + space + "+$", "g"), "");
}

function canonicalFormText_(value) {
  return formText_(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(new RegExp(formWhitespaceClass_(false) + "+", "g"), " ")
    .toLocaleLowerCase();
}

function findFormColumn_(headers, prefixes, required) {
  var normalized = headers.map(canonicalFormText_);
  for (var i = 0; i < normalized.length; i += 1) {
    for (var j = 0; j < prefixes.length; j += 1) {
      if (normalized[i].indexOf(prefixes[j]) === 0) return i;
    }
  }
  if (required) {
    throw new Error("The Google Form response sheet is missing the expected column: " + prefixes[0] + ".");
  }
  return -1;
}

function mapFormColumns_(headers) {
  var columns = {};
  Object.keys(FORM_HEADER_PREFIXES).forEach(function (field) {
    var required = ["timestamp", "name", "gender", "room", "telegramHandle", "telegramId", "year", "faculty", "interests", "specialRequirements", "genderPreference", "mode", "declaration"].indexOf(field) !== -1;
    columns[field] = findFormColumn_(headers, FORM_HEADER_PREFIXES[field], required);
  });
  return columns;
}

function formValue_(row, column) {
  return column < 0 ? "" : formText_(row[column]);
}

function parseFormMode_(value) {
  var normalized = canonicalFormText_(value);
  if (normalized.indexOf("devil and mortal") === 0) return "Devil";
  if (normalized.indexOf("angel and mortal") === 0) return "Angel";
  return "";
}

function buildMortalIntroFromForm_(response) {
  var lines = [];
  var study = [response.year, response.faculty].filter(function (value) { return !!value; }).join(" · ");
  if (study) lines.push(study);
  if (response.interests) lines.push("Interests: " + response.interests);
  if (response.specialRequirements) lines.push("Special requirements: " + response.specialRequirements);
  if (response.mode === "Devil") {
    lines.push("Mode: Devil and Mortal (welfare and pranks).");
    if (response.prankTolerance) lines.push("Prank tolerance: " + response.prankTolerance + "/5");
    if (response.roomEntry) lines.push("Room entry: " + response.roomEntry);
    if (response.boundaries) lines.push("Off limits: " + response.boundaries);
  } else {
    lines.push("Mode: Angel and Mortal (welfare only; no pranks).");
  }
  return lines.join("\n");
}

function parseFormResponse_(row, sourceRow, columns) {
  var response = {
    timestamp: formValue_(row, columns.timestamp),
    sourceRow: sourceRow,
    name: formValue_(row, columns.name),
    gender: formValue_(row, columns.gender),
    room: formValue_(row, columns.room),
    telegramHandle: formValue_(row, columns.telegramHandle),
    telegramId: formValue_(row, columns.telegramId).replace(new RegExp(formWhitespaceClass_(false), "g"), ""),
    year: formValue_(row, columns.year),
    faculty: formValue_(row, columns.faculty),
    interests: formValue_(row, columns.interests),
    specialRequirements: formValue_(row, columns.specialRequirements),
    genderPreference: formValue_(row, columns.genderPreference),
    mode: parseFormMode_(formValue_(row, columns.mode)),
    prankTolerance: formValue_(row, columns.prankTolerance),
    roomEntry: formValue_(row, columns.roomEntry),
    boundaries: formValue_(row, columns.boundaries),
    declaration: formValue_(row, columns.declaration),
    issues: [],
    status: "Ready"
  };
  if (!response.timestamp) response.issues.push("Missing timestamp");
  if (!response.name) response.issues.push("Missing name");
  if (!response.gender) response.issues.push("Missing gender");
  if (!response.room) response.issues.push("Missing room");
  if (!response.telegramHandle) response.issues.push("Missing Telegram handle");
  if (!/^\d{5,20}$/.test(response.telegramId)) response.issues.push("Telegram ID must contain 5-20 digits");
  if (!response.year) response.issues.push("Missing year of study");
  if (!response.faculty) response.issues.push("Missing faculty");
  if (!response.interests) response.issues.push("Missing interests");
  if (!response.specialRequirements) response.issues.push("Missing special requirements");
  if (!response.genderPreference) response.issues.push("Missing gender preference");
  if (!response.mode) response.issues.push("Unknown Angel/Devil selection");
  if (!response.declaration) response.issues.push("Declaration not accepted");
  if (response.mode === "Devil") {
    if (!/^[1-5]$/.test(response.prankTolerance)) response.issues.push("Devil response needs prank tolerance 1-5");
    if (!response.roomEntry) response.issues.push("Devil response needs room-entry preference");
    if (!response.boundaries) response.issues.push("Devil response needs boundaries");
  }
  response.status = response.issues.length ? "Review" : "Ready";
  return response;
}

function addDuplicateIssues_(responses, propertyName, label, normalizer) {
  var groups = Object.create(null);
  responses.forEach(function (response) {
    var value = normalizer(response[propertyName]);
    if (!value) return;
    groups[value] = groups[value] || [];
    groups[value].push(response);
  });
  Object.keys(groups).forEach(function (value) {
    if (groups[value].length < 2) return;
    groups[value].forEach(function (response) {
      response.issues.push("Duplicate " + label + " in form responses");
      response.status = "Review";
    });
  });
}

function formParticipantId_(spreadsheetId, sourceRow) {
  return "form:" + spreadsheetId + ":" + sourceRow;
}

function sheetColumnLabel_(columnNumber) {
  var label = "";
  while (columnNumber > 0) {
    columnNumber -= 1;
    label = String.fromCharCode(65 + (columnNumber % 26)) + label;
    columnNumber = Math.floor(columnNumber / 26);
  }
  return label;
}

function quotedSheetName_(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

function formFormulaRanges_() {
  var sheet = getFormResponseSheet_();
  var columns = mapFormColumns_(readHeaderRow_(sheet));
  var sheetName = quotedSheetName_(sheet.getName());
  // Google Forms inserts response rows and Sheets rewrites direct A1 ranges.
  // Keep the source start at row 2 in a string reference instead. This protects
  // Form append behavior, not manual sorting/deletion or participant row IDs.
  function sourceRange(column) {
    var label = sheetColumnLabel_(column + 1);
    var address = sheetName + "!" + label + "2:" + label;
    return 'INDIRECT("' + address.replace(/"/g, '""') + '")';
  }
  var timestamp = sourceRange(columns.timestamp);
  var ranges = {timestamp: timestamp};
  Object.keys(columns).forEach(function (field) {
    if (field === "timestamp") return;
    ranges[field] = columns[field] < 0
      ? "IF(ROW(" + timestamp + "),\"\",\"\")"
      : sourceRange(columns[field]);
  });
  return ranges;
}

// Backwards-compatible aliases. Signups remain in the form-owned response tab;
// the operational roster is refreshed in a separate tab in the same workbook.
function refreshFormIntake() {
  return syncParticipants();
}

function applyFormIntake() {
  return syncParticipants();
}
