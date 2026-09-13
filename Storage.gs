var ROSTER_HEADERS = Object.freeze([
  "Participant Key",
  "Name",
  "Room",
  "Mode Requested",
  "Prank Tolerance",
  "Gender Preference",
  "Mortal",
  "Mortal Prank Tolerance",
  "Role to Mortal",
  "Assignment Fit",
  "Assigned Angel/Devil",
  "Pairing Status",
  "Pairing Issues",
  "Telegram ID",
  "PersonID",
  "Intro",
  "Form Row",
  "Signup Time",
  "Angel Bot Started At",
  "Mortal Bot Started At",
  "Form Validation Issues"
]);

var PRE_FORMULA_ROSTER_HEADERS = Object.freeze([
  "Participant Key", "Name", "Room", "Mode Requested", "Prank Tolerance",
  "Gender Preference", "Mortal", "Mortal Prank Tolerance", "Role to Mortal",
  "Assignment Fit", "Assigned Angel/Devil", "Pairing Status", "Pairing Issues",
  "Telegram ID", "PersonID", "Intro", "Form Row", "Signup Time",
  "Angel Bot Started At", "Mortal Bot Started At"
]);

var LEGACY_ROSTER_HEADERS = Object.freeze([
  "Participant Key", "Name", "Room", "Mode Requested", "Gender Preference",
  "Mortal", "Role to Mortal", "Assigned Angel/Devil", "Pairing Status",
  "Pairing Issues", "Telegram ID", "PersonID", "Intro", "Form Row",
  "Signup Time", "Angel Bot Started At", "Mortal Bot Started At"
]);

function normalizedName_(name) {
  return formText_(name).toLocaleLowerCase();
}

function participantKey_(participant) {
  var suffix = participant.telegramId || ("row " + participant.sourceRow);
  return participant.name + " [" + suffix + "]";
}

function getRosterSpreadsheet_() {
  var spreadsheetId = getProperty_("SPREADSHEET_ID") || getProperty_(FORM_IMPORT_CONFIG.SOURCE_ID_PROPERTY);
  if (!spreadsheetId) {
    throw new Error("Set SPREADSHEET_ID to the linked Google Form response spreadsheet.");
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

function getFormResponseSheet_() {
  var spreadsheet = getRosterSpreadsheet_();
  var sheetName = getProperty_(FORM_IMPORT_CONFIG.SOURCE_SHEET_PROPERTY) || FORM_IMPORT_CONFIG.DEFAULT_SOURCE_SHEET;
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error("Missing Google Form response sheet: " + sheetName + ".");
  return sheet;
}

function readHeaderRow_(sheet) {
  var width = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
}

function findHeaderIndex_(headers, expected) {
  for (var i = 0; i < headers.length; i += 1) {
    if (String(headers[i] || "").trim() === expected) return i + 1;
  }
  return 0;
}

function getRosterLayout_(sheet) {
  var headers = readHeaderRow_(sheet);
  var columns = {};
  ROSTER_HEADERS.forEach(function (header, index) {
    if (String(headers[index] || "").trim() !== header) {
      throw new Error("The '" + AM_CONFIG.ROSTER_SHEET_NAME + "' headers have changed. Restore the expected roster layout or use a new tab.");
    }
    columns[header] = index + 1;
  });
  for (var i = ROSTER_HEADERS.length; i < headers.length; i += 1) {
    if (String(headers[i] || "").trim()) {
      throw new Error("The '" + AM_CONFIG.ROSTER_SHEET_NAME + "' tab has unexpected extra columns.");
    }
  }
  return {headers: headers, columns: columns};
}

function headersMatch_(headers, expected) {
  if (headers.length < expected.length) return false;
  for (var i = 0; i < expected.length; i += 1) {
    if (String(headers[i] || "").trim() !== expected[i]) return false;
  }
  for (var j = expected.length; j < headers.length; j += 1) {
    if (String(headers[j] || "").trim()) return false;
  }
  return true;
}

function ensureRosterWidth_(sheet) {
  if (sheet.getMaxColumns() < ROSTER_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), ROSTER_HEADERS.length - sheet.getMaxColumns());
  }
}

function migrateRoster_(sheet, sourceHeaders) {
  var lastRow = sheet.getLastRow();
  var oldRows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, sourceHeaders.length).getValues();
  ensureRosterWidth_(sheet);
  var migrated = oldRows.map(function (row) {
    return ROSTER_HEADERS.map(function (header) {
      var sourceIndex = sourceHeaders.indexOf(header);
      return sourceIndex === -1 ? "" : row[sourceIndex];
    });
  });
  sheet.getRange(1, 1, Math.max(lastRow, 1), Math.max(sourceHeaders.length, ROSTER_HEADERS.length))
    .clearDataValidations()
    .clearContent();
  sheet.getRange(1, 1, 1, ROSTER_HEADERS.length).setValues([ROSTER_HEADERS.slice()]);
  if (migrated.length) sheet.getRange(2, 1, migrated.length, ROSTER_HEADERS.length).setValues(migrated);
}

function formatRosterSheet_(sheet) {
  sheet.getRange(1, 1, 1, ROSTER_HEADERS.length)
    .setFontWeight("bold")
    .setBackground("#d9ead3")
    .setWrap(true);
  sheet.getRange(1, 1).setNote(
    "Keep Form response and roster rows append-only. Do not sort, insert, or delete rows; use temporary filter views to sort safely."
  );
  sheet.getRange(1, 7).setBackground("#f1c232").setNote(
    "Organizer input: choose the participant who will be this person's mortal. Keep rows append-only; use temporary filter views to sort safely."
  );
  sheet.getRange(1, 10).setBackground("#674ea7").setFontColor("#ffffff").setNote(
    "For Devil assignments, this compares the giver's and mortal's submitted prank-tolerance ratings as a screening proxy. Green is a gap of 0-1, amber is 2 or a missing giver rating, and red is 3-4."
  );
  sheet.getRange(1, 13).setNote("Ready requires one mortal per giver, every participant selected exactly once, no self-pairing, and valid form data.");
  sheet.getRange(1, 8, 1, 6).setNote("Formula-driven. Edit only the yellow Mortal column; these values update automatically in Google Sheets.");
  var widths = [220, 150, 90, 125, 105, 145, 220, 145, 120, 210, 250, 105, 320, 120, 230, 360, 80, 155, 165, 165, 260];
  widths.forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
  sheet.setFrozenRows(1);
  sheet.showColumns(1, ROSTER_HEADERS.length);
  sheet.hideColumns(15);
  sheet.hideColumns(17);
  sheet.hideColumns(21);
}

function ensureRosterFilter_(sheet) {
  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, sheet.getMaxRows(), ROSTER_HEADERS.length).createFilter();
  }
}

function setupParticipantsSheet_() {
  var spreadsheet = getRosterSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(AM_CONFIG.ROSTER_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(AM_CONFIG.ROSTER_SHEET_NAME);
  var headers = readHeaderRow_(sheet);
  var hasHeaders = headers.some(function (value) { return !!String(value || "").trim(); });
  if (!hasHeaders) {
    ensureRosterWidth_(sheet);
    sheet.getRange(1, 1, 1, ROSTER_HEADERS.length).setValues([ROSTER_HEADERS.slice()]);
  } else if (headersMatch_(headers, PRE_FORMULA_ROSTER_HEADERS)) {
    migrateRoster_(sheet, PRE_FORMULA_ROSTER_HEADERS);
  } else if (headersMatch_(headers, LEGACY_ROSTER_HEADERS)) {
    migrateRoster_(sheet, LEGACY_ROSTER_HEADERS);
  }
  getRosterLayout_(sheet);
  formatRosterSheet_(sheet);
  applyRosterSpillFormulas_(sheet, "form:" + spreadsheet.getId() + ":");
  applyMortalDropdown_(sheet);
  applyRosterConditionalFormatting_(sheet);
  ensureRosterFilter_(sheet);
  return sheet;
}

function getParticipantsSheet_() {
  var sheet = getRosterSpreadsheet_().getSheetByName(AM_CONFIG.ROSTER_SHEET_NAME);
  if (!sheet) throw new Error("Missing '" + AM_CONFIG.ROSTER_SHEET_NAME + "' tab. Run setupProject.");
  getRosterLayout_(sheet);
  return sheet;
}

function readFormResponses_() {
  var sheet = getFormResponseSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = readHeaderRow_(sheet);
  var columns = mapFormColumns_(headers);
  var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  var responses = rows.map(function (row, index) {
    return parseFormResponse_(row, index + 2, columns);
  }).filter(function (response) {
    return !!response.timestamp;
  });
  addDuplicateIssues_(responses, "telegramId", "Telegram ID", function (value) { return String(value || ""); });
  addDuplicateIssues_(responses, "name", "name", normalizedName_);
  return responses;
}

function readExistingRosterState_() {
  var sheet = getRosterSpreadsheet_().getSheetByName(AM_CONFIG.ROSTER_SHEET_NAME);
  var state = {byPersonId: Object.create(null)};
  if (!sheet || sheet.getLastRow() < 2) return state;
  var layout = getRosterLayout_(sheet);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, ROSTER_HEADERS.length).getDisplayValues();
  rows.forEach(function (row, index) {
    var item = {
      rowNumber: index + 2,
      mortalSelection: String(row[layout.columns["Mortal"] - 1] || ""),
      angelBotStartedAt: row[layout.columns["Angel Bot Started At"] - 1] || "",
      mortalBotStartedAt: row[layout.columns["Mortal Bot Started At"] - 1] || ""
    };
    var personId = String(row[layout.columns.PersonID - 1] || "").trim();
    if (personId && !state.byPersonId[personId]) state.byPersonId[personId] = item;
  });
  return state;
}

function buildParticipantsFromForm_() {
  var spreadsheetId = getRosterSpreadsheet_().getId();
  var existing = readExistingRosterState_();
  return readFormResponses_().map(function (response, index) {
    var personId = formParticipantId_(spreadsheetId, response.sourceRow);
    var preserved = existing.byPersonId[personId] || {};
    var participant = {
      rowNumber: index + 2,
      sourceRow: response.sourceRow,
      personId: personId,
      code: "",
      name: response.name,
      room: response.room,
      intro: buildMortalIntroFromForm_(response),
      mode: response.mode,
      prankTolerance: response.prankTolerance,
      genderPreference: response.genderPreference,
      mortal: "",
      mortalSelection: String(preserved.mortalSelection || ""),
      mortalId: "",
      angelId: "",
      telegramId: response.telegramId,
      registeredAt: response.timestamp,
      angelBotStartedAt: preserved.angelBotStartedAt || "",
      mortalBotStartedAt: preserved.mortalBotStartedAt || "",
      roleToMortal: "",
      mortalPrankTolerance: "",
      assignmentFit: "UNASSIGNED",
      assignedAngelDevil: "",
      formIssues: response.issues.slice(),
      issues: response.issues.slice(),
      status: response.issues.length ? "Review" : "Ready"
    };
    participant.key = participantKey_(participant);
    return participant;
  });
}

function buildParticipantIndexes_(participants) {
  var indexes = {
    byId: Object.create(null), byKey: Object.create(null),
    byTelegramId: Object.create(null), byName: Object.create(null)
  };
  participants.forEach(function (participant) {
    indexes.byId[participant.personId] = participant;
    indexes.byKey[participant.key] = indexes.byKey[participant.key] || [];
    indexes.byKey[participant.key].push(participant);
    if (participant.telegramId) {
      indexes.byTelegramId[participant.telegramId] = indexes.byTelegramId[participant.telegramId] || [];
      indexes.byTelegramId[participant.telegramId].push(participant);
    }
    var normalized = normalizedName_(participant.name);
    if (normalized) {
      indexes.byName[normalized] = indexes.byName[normalized] || [];
      indexes.byName[normalized].push(participant);
    }
  });
  return indexes;
}

function uniqueIndexedParticipant_(group) {
  return group && group.length === 1 ? group[0] : null;
}

function resolveMortalSelection_(selection, indexes) {
  selection = String(selection || "");
  return selection ? uniqueIndexedParticipant_(indexes.byKey[selection]) : null;
}

function addParticipantIssue_(participant, issue) {
  if (participant.issues.indexOf(issue) === -1) participant.issues.push(issue);
  participant.status = "Review";
}

function analyzePairings_(participants) {
  var indexes = buildParticipantIndexes_(participants);
  participants.forEach(function (participant) {
    participant.mortal = "";
    participant.mortalId = "";
    participant.angelId = "";
    participant.roleToMortal = "";
    participant.mortalPrankTolerance = "";
    participant.assignmentFit = "UNASSIGNED";
    participant.assignedAngelDevil = "";
    participant.givers = [];
  });

  participants.forEach(function (giver) {
    if (!giver.mortalSelection) {
      addParticipantIssue_(giver, "Choose a mortal");
      return;
    }
    var mortal = resolveMortalSelection_(giver.mortalSelection, indexes);
    if (!mortal) {
      addParticipantIssue_(giver, "Selected mortal is not a current participant");
      return;
    }
    if (mortal.personId === giver.personId) {
      addParticipantIssue_(giver, "A participant cannot be their own mortal");
      return;
    }
    giver.mortal = mortal.name;
    giver.mortalId = mortal.personId;
    giver.roleToMortal = mortal.mode;
    giver.mortalPrankTolerance = mortal.prankTolerance;
    giver.assignmentFit = assignmentFit_(giver, mortal);
    mortal.givers.push(giver);
  });

  participants.forEach(function (mortal) {
    if (mortal.givers.length !== 1) {
      addParticipantIssue_(mortal, "Appears as a mortal " + mortal.givers.length + " times; expected exactly once");
      if (mortal.givers.length > 1) {
        mortal.givers.forEach(function (giver) {
          addParticipantIssue_(giver, "Selected mortal is assigned to more than one giver");
        });
      }
      return;
    }
    var giver = mortal.givers[0];
    mortal.angelId = giver.personId;
    mortal.assignedAngelDevil = giver.key + " — " + mortal.mode;
  });

  participants.forEach(function (participant) {
    participant.status = participant.issues.length ? "Review" : "Ready";
    delete participant.givers;
  });
  return {participants: participants, indexes: indexes};
}

function toleranceRating_(value) {
  var rating = Number(String(value || "").trim());
  return rating >= 1 && rating <= 5 && Math.floor(rating) === rating ? rating : null;
}

function assignmentFit_(giver, mortal) {
  if (mortal.mode === "Angel") return "READY · ANGEL";
  if (mortal.mode !== "Devil") return "UNASSIGNED";
  var giverTolerance = toleranceRating_(giver.prankTolerance);
  var mortalTolerance = toleranceRating_(mortal.prankTolerance);
  if (mortalTolerance === null) return "INVALID · MORTAL TOLERANCE";
  if (giverTolerance === null) return "CHECK · DEVIL ?→" + mortalTolerance;
  var gap = Math.abs(giverTolerance - mortalTolerance);
  var label = giverTolerance + "→" + mortalTolerance;
  if (gap <= 1) return "GOOD · DEVIL " + label;
  if (gap === 2) return "CHECK · DEVIL " + label;
  return "MISMATCH · DEVIL " + label;
}

function readParticipants_() {
  return analyzePairings_(buildParticipantsFromForm_()).participants;
}

function applyMortalDropdown_(sheet) {
  var availableRows = Math.max(sheet.getMaxRows() - 1, 1);
  var sourceRange = sheet.getRange(2, 1, availableRows, 1);
  var targetRange = sheet.getRange(2, 7, availableRows, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(sourceRange, true)
    .setAllowInvalid(false)
    .setHelpText("Choose exactly one different participant as this person's mortal.")
    .build();
  targetRange.clearDataValidations().setDataValidation(rule);
}

function formulaStringLiteral_(value) {
  return "\"" + String(value).replace(/\"/g, "\"\"") + "\"";
}

function rosterSpillFormulas_(personIdNamespace) {
  var range = formFormulaRanges_();
  var timestamp = range.timestamp;
  var include = timestamp + "<>\"\"";
  var filter = function (value) { return "FILTER(" + value + "," + include + ")"; };
  var whitespace = formWhitespaceClass_(true);
  var trimFormText = function (value) {
    return "REGEXREPLACE(TO_TEXT(" + value + ")," + formulaStringLiteral_("^" + whitespace + "+|" + whitespace + "+$") + ",\"\")";
  };
  var telegramId = "REGEXREPLACE(TO_TEXT(" + range.telegramId + ")," + formulaStringLiteral_(whitespace) + ",\"\")";
  var selectedCount = "SUMPRODUCT(N(EXACT($A$2:$A,mortal)),N($A$2:$A<>\"\"))";
  var incomingCount = "SUMPRODUCT(N(EXACT($G$2:$G,participantKey)),N($A$2:$A<>\"\"),N(NOT(EXACT($A$2:$A,participantKey))))";
  var selectedIncomingCount = "SUMPRODUCT(N(EXACT($G$2:$G,mortal)),N($A$2:$A<>\"\"),N(NOT(EXACT($A$2:$A,mortal))))";
  var normalizedMode = "REGEXREPLACE(LOWER(TO_TEXT(choice))," + formulaStringLiteral_(whitespace + "+") + ",\" \" )";
  var isDevil = "REGEXMATCH(" + normalizedMode + ",\"^devil and mortal\")";
  var validMode = "REGEXMATCH(" + normalizedMode + ",\"^(angel|devil) and mortal\")";
  var formulas = {};

  formulas[1] = "=ARRAYFORMULA(IFNA(FILTER(" + trimFormText(range.name) + "&\" [\"&IF(" + telegramId + "=\"\",\"row \"&ROW(" + timestamp + ")," + telegramId + ")&\"]\"," + include + "),\"\"))";
  formulas[2] = "=ARRAYFORMULA(IFNA(" + filter(trimFormText(range.name)) + ",\"\"))";
  formulas[3] = "=ARRAYFORMULA(IFNA(" + filter(trimFormText(range.room)) + ",\"\"))";
  formulas[4] = "=ARRAYFORMULA(IFNA(LET(choice," + filter(trimFormText(range.mode)) + ",IF(" + isDevil + ",\"Devil\",IF(REGEXMATCH(" + normalizedMode + ",\"^angel and mortal\"),\"Angel\",\"\"))),\"\"))";
  formulas[5] = "=ARRAYFORMULA(IFNA(" + filter(trimFormText(range.prankTolerance)) + ",\"\"))";
  formulas[6] = "=ARRAYFORMULA(IFNA(" + filter(trimFormText(range.genderPreference)) + ",\"\"))";
  formulas[14] = "=ARRAYFORMULA(IFNA(" + filter(telegramId) + ",\"\"))";
  formulas[15] = "=ARRAYFORMULA(IFNA(" + formulaStringLiteral_(personIdNamespace) + "&" + filter("ROW(" + timestamp + ")") + ",\"\"))";
  formulas[16] = "=IFNA(MAP(" + [range.year, range.faculty, range.interests, range.specialRequirements, range.mode, range.prankTolerance, range.roomEntry, range.boundaries].map(trimFormText).map(filter).join(",") + ",LAMBDA(year,faculty,interests,requirements,choice,tolerance,roomEntry,boundaries,TEXTJOIN(CHAR(10),TRUE,IF(TEXTJOIN(\" · \",TRUE,year,faculty)=\"\",\"\",TEXTJOIN(\" · \",TRUE,year,faculty)),IF(interests=\"\",\"\",\"Interests: \"&interests),IF(requirements=\"\",\"\",\"Special requirements: \"&requirements),IF(" + isDevil + ",\"Mode: Devil and Mortal (welfare and pranks).\",\"Mode: Angel and Mortal (welfare only; no pranks).\"),IF(" + isDevil + ",IF(tolerance=\"\",\"\",\"Prank tolerance: \"&tolerance&\"/5\"),\"\"),IF(" + isDevil + ",IF(roomEntry=\"\",\"\",\"Room entry: \"&roomEntry),\"\"),IF(" + isDevil + ",IF(boundaries=\"\",\"\",\"Off limits: \"&boundaries),\"\")))),\"\")";
  formulas[17] = "=ARRAYFORMULA(IFNA(" + filter("ROW(" + timestamp + ")") + ",\"\"))";
  formulas[18] = "=ARRAYFORMULA(IFNA(" + filter(timestamp) + ",\"\"))";
  var validationSources = [timestamp, range.name, range.gender, range.room, range.telegramHandle,
    range.telegramId, range.year, range.faculty, range.interests, range.specialRequirements,
    range.genderPreference, range.mode, range.declaration, range.prankTolerance,
    range.roomEntry, range.boundaries];
  var validationArgs = "timestamp,name,gender,room,handle,telegramId,year,faculty,interests,requirements,genderPreference,choice,declaration,tolerance,roomEntry,boundaries";
  var validationChecks = [
    "IF(name=\"\",\"Missing name\",\"\")", "IF(gender=\"\",\"Missing gender\",\"\")",
    "IF(room=\"\",\"Missing room\",\"\")", "IF(handle=\"\",\"Missing Telegram handle\",\"\")",
    "IF(NOT(REGEXMATCH(TO_TEXT(telegramId),\"^\\d{5,20}$\")),\"Telegram ID must contain 5-20 digits\",\"\")",
    "IF(year=\"\",\"Missing year of study\",\"\")", "IF(faculty=\"\",\"Missing faculty\",\"\")",
    "IF(interests=\"\",\"Missing interests\",\"\")",
    "IF(requirements=\"\",\"Missing special requirements\",\"\")",
    "IF(genderPreference=\"\",\"Missing gender preference\",\"\")",
    "IF(NOT(" + validMode + "),\"Unknown Angel/Devil selection\",\"\")",
    "IF(declaration=\"\",\"Declaration not accepted\",\"\")",
    "IF(AND(" + isDevil + ",NOT(REGEXMATCH(TO_TEXT(tolerance),\"^[1-5]$\"))),\"Devil response needs prank tolerance 1-5\",\"\")",
    "IF(AND(" + isDevil + ",roomEntry=\"\"),\"Devil response needs room-entry preference\",\"\")",
    "IF(AND(" + isDevil + ",boundaries=\"\"),\"Devil response needs boundaries\",\"\")",
    "IF(AND(telegramId<>\"\",SUMPRODUCT(N(EXACT($N$2:$N,telegramId)))>1),\"Duplicate Telegram ID in form responses\",\"\")",
    "IF(AND(name<>\"\",SUMPRODUCT(N(LOWER($B$2:$B)=LOWER(name)))>1),\"Duplicate name in form responses\",\"\")"
  ];
  formulas[21] = "=IFNA(MAP(" + validationSources.map(function (source, index) {
    return filter(index === 0 ? source : index === 5 ? telegramId : trimFormText(source));
  }).join(",") + ",LAMBDA(" + validationArgs + ",IF(timestamp=\"\",\"\",TEXTJOIN(\"; \",TRUE," +
    validationChecks.join(",") + ")))),\"\")";

  formulas[8] = "=MAP($A$2:$A,$G$2:$G,LAMBDA(participantKey,mortal,IF(participantKey=\"\",\"\",IF(mortal=\"\",\"\",IF(" + selectedCount + "<>1,\"\",IF(EXACT(mortal,participantKey),\"\",IFNA(INDEX(FILTER($E$2:$E,EXACT($A$2:$A,mortal)),1),\"\")))))))";
  formulas[9] = "=MAP($A$2:$A,$G$2:$G,LAMBDA(participantKey,mortal,IF(participantKey=\"\",\"\",IF(mortal=\"\",\"\",IF(" + selectedCount + "<>1,\"\",IF(EXACT(mortal,participantKey),\"\",IFNA(INDEX(FILTER($D$2:$D,EXACT($A$2:$A,mortal)),1),\"\")))))))";
  formulas[10] = "=MAP($A$2:$A,$G$2:$G,$E$2:$E,$H$2:$H,$I$2:$I,LAMBDA(participantKey,mortal,giverTolerance,mortalTolerance,role,IF(participantKey=\"\",\"\",IF(mortal=\"\",\"UNASSIGNED\",IF(" + selectedCount + "<>1,\"UNASSIGNED\",IF(EXACT(mortal,participantKey),\"UNASSIGNED\",IF(role=\"Angel\",\"READY · ANGEL\",IF(role<>\"Devil\",\"UNASSIGNED\",IF(NOT(REGEXMATCH(TO_TEXT(mortalTolerance),\"^[1-5]$\")),\"INVALID · MORTAL TOLERANCE\",IF(NOT(REGEXMATCH(TO_TEXT(giverTolerance),\"^[1-5]$\")),\"CHECK · DEVIL ?→\"&mortalTolerance,IF(ABS(VALUE(giverTolerance)-VALUE(mortalTolerance))<=1,\"GOOD · DEVIL \"&giverTolerance&\"→\"&mortalTolerance,IF(ABS(VALUE(giverTolerance)-VALUE(mortalTolerance))=2,\"CHECK · DEVIL \"&giverTolerance&\"→\"&mortalTolerance,\"MISMATCH · DEVIL \"&giverTolerance&\"→\"&mortalTolerance))))))))))))";
  formulas[11] = "=MAP($A$2:$A,$D$2:$D,LAMBDA(participantKey,mode,IF(participantKey=\"\",\"\",IF(" + incomingCount + "<>1,\"\",INDEX(FILTER($A$2:$A,EXACT($G$2:$G,participantKey),$A$2:$A<>\"\",NOT(EXACT($A$2:$A,participantKey))),1)&\" — \"&mode))))";
  formulas[12] = "=MAP($A$2:$A,$M$2:$M,LAMBDA(participantKey,issues,IF(participantKey=\"\",\"\",IF(issues=\"\",\"Ready\",\"Review\"))))";
  formulas[13] = "=MAP($A$2:$A,$G$2:$G,$U$2:$U,LAMBDA(participantKey,mortal,formIssues,IF(participantKey=\"\",\"\",TEXTJOIN(\"; \",TRUE,formIssues,IF(mortal=\"\",\"Choose a mortal\",\"\"),IF(AND(mortal<>\"\"," + selectedCount + "<>1),\"Selected mortal is not a current participant\",\"\"),IF(EXACT(mortal,participantKey),\"A participant cannot be their own mortal\",\"\"),IF(AND(mortal<>\"\",NOT(EXACT(mortal,participantKey))," + selectedCount + "=1," + selectedIncomingCount + ">1),\"Selected mortal is assigned to more than one giver\",\"\"),IF(" + incomingCount + "<>1,\"Appears as a mortal \"&" + incomingCount + "&\" times; expected exactly once\",\"\")))))";
  return formulas;
}

function applyRosterSpillFormulas_(sheet, personIdNamespace) {
  var formulas = rosterSpillFormulas_(personIdNamespace);
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  Object.keys(formulas).forEach(function (column) {
    sheet.getRange(2, Number(column), rows, 1).clearContent();
    sheet.getRange(2, Number(column)).setFormula(formulas[column]);
  });
}

function ruleTouchesRosterIndicators_(rule, sheet) {
  return rule.getRanges().some(function (range) {
    if (range.getSheet().getSheetId() !== sheet.getSheetId()) return false;
    var firstColumn = range.getColumn();
    var lastColumn = firstColumn + range.getNumColumns() - 1;
    return [7, 10, 12].some(function (column) {
      return column >= firstColumn && column <= lastColumn;
    });
  });
}

function indicatorRule_(formula, ranges, background, fontColor) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground(background)
    .setFontColor(fontColor)
    .setBold(true)
    .setRanges(ranges)
    .build();
}

function applyRosterConditionalFormatting_(sheet) {
  var availableRows = Math.max(sheet.getMaxRows() - 1, 1);
  var fitRanges = [
    sheet.getRange(2, 7, availableRows, 1),
    sheet.getRange(2, 10, availableRows, 1)
  ];
  var statusRange = sheet.getRange(2, 12, availableRows, 1);
  fitRanges.concat([statusRange]).forEach(function (range) {
    range.setBackground("#ffffff").setFontColor("#000000").setFontWeight("bold");
  });
  var rules = sheet.getConditionalFormatRules().filter(function (rule) {
    return !ruleTouchesRosterIndicators_(rule, sheet);
  });
  rules.push(indicatorRule_("=AND($A2<>\"\",REGEXMATCH($J2,\"^(GOOD|READY)\"))", fitRanges, "#d9ead3", "#274e13"));
  rules.push(indicatorRule_("=AND($A2<>\"\",REGEXMATCH($J2,\"^CHECK\"))", fitRanges, "#fff2cc", "#7f6000"));
  rules.push(indicatorRule_("=AND($A2<>\"\",REGEXMATCH($J2,\"^(UNASSIGNED|INVALID|MISMATCH)\"))", fitRanges, "#f4cccc", "#990000"));
  rules.push(indicatorRule_("=AND($A2<>\"\",$L2=\"Ready\")", [statusRange], "#d9ead3", "#274e13"));
  rules.push(indicatorRule_("=AND($A2<>\"\",$L2=\"Review\")", [statusRange], "#f4cccc", "#990000"));
  sheet.setConditionalFormatRules(rules);
}

function participantSummary_(participants) {
  return {
    total: participants.length,
    ready: participants.filter(function (participant) { return participant.status === "Ready"; }).length,
    review: participants.filter(function (participant) { return participant.status !== "Ready"; }).length,
    registered: participants.filter(function (participant) { return !!participant.telegramId; }).length
  };
}

function syncParticipants() {
  var summary = syncParticipants_();
  notifyUser_(
    "Angel Mortal",
    summary.total + " form participants; " + summary.ready + " ready, " + summary.review + " need pairing review."
  );
  return summary;
}

function syncParticipants_() {
  return participantSummary_(analyzePairings_(buildParticipantsFromForm_()).participants);
}

function validateParticipants_() {
  var analysis = analyzePairings_(buildParticipantsFromForm_());
  var participants = analysis.participants;
  if (participants.length < 2) throw new Error("At least two form participants are required.");
  var review = participants.filter(function (participant) { return participant.status !== "Ready"; });
  if (review.length) {
    var examples = review.slice(0, 3).map(function (participant) {
      return participant.name + ": " + participant.issues.join("; ");
    });
    throw new Error(review.length + " participant(s) need pairing review. " + examples.join(" | "));
  }
  return {
    participants: participants,
    byId: analysis.indexes.byId,
    total: participants.length,
    registered: participants.filter(function (participant) { return !!participant.telegramId; }).length
  };
}

function findParticipantByTelegramId_(telegramId, participants) {
  telegramId = String(telegramId || "");
  var matches = (participants || readParticipants_()).filter(function (participant) {
    return participant.telegramId === telegramId;
  });
  return matches.length === 1 ? matches[0] : null;
}

function findParticipantByPersonId_(personId, participants) {
  personId = String(personId || "");
  var matches = (participants || readParticipants_()).filter(function (participant) {
    return participant.personId === personId;
  });
  return matches.length === 1 ? matches[0] : null;
}

function findParticipantByCode_() {
  return null;
}

function findParticipantByIdentifier_(identifier, participants) {
  identifier = String(identifier || "").trim();
  if (!identifier) return null;
  var list = participants || readParticipants_();
  var category = /^\d+$/.test(identifier) ? "telegramId" :
    list.some(function (participant) { return participant.personId === identifier; }) ? "personId" :
      list.some(function (participant) { return participant.key === identifier; }) ? "key" : "name";
  var matches = list.filter(function (participant) {
    return category === "name" ? normalizedName_(participant.name) === normalizedName_(identifier) :
      participant[category] === identifier;
  });
  return matches.length === 1 ? matches[0] : null;
}

function registerParticipant_(_code, telegramId) {
  var summary = validateParticipants_();
  var participant = findParticipantByTelegramId_(telegramId, summary.participants);
  if (participant) return {status: "already-user", participant: participant, summary: summary};
  return {status: "invalid-code", participant: null, summary: summary};
}

function participantHasStartedBot_(participant, bot) {
  var startedAt = bot === "angel" ? participant.angelBotStartedAt : participant.mortalBotStartedAt;
  return !!startedAt && !!participant.telegramId &&
    getProperty_(participantStartBindingKey_(participant.personId, bot)) === participant.telegramId;
}

function participantStartBindingKey_(personId, bot) {
  return "PARTICIPANT_START_" + bot + ":" + personId;
}

function markParticipantBotStarted_(participant, bot) {
  if (AM_CONFIG.PARTICIPANT_BOTS.indexOf(bot) === -1) throw new Error("Invalid participant bot role: " + bot);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var current = findParticipantByPersonId_(participant.personId, readParticipants_());
    if (!current || !current.telegramId) throw new Error("Participant signup is missing.");
    if (current.telegramId !== participant.telegramId) throw new Error("Participant account changed; reload the signup.");
    var propertyName = bot === "angel" ? "angelBotStartedAt" : "mortalBotStartedAt";
    if (participantHasStartedBot_(current, bot)) {
      participant[propertyName] = current[propertyName];
      return false;
    }
    var startedAt = new Date();
    var column = bot === "angel" ? 19 : 20;
    getParticipantsSheet_().getRange(current.rowNumber, column).setValue(startedAt);
    PropertiesService.getScriptProperties().setProperty(participantStartBindingKey_(current.personId, bot), current.telegramId);
    participant[propertyName] = startedAt;
    return true;
  } finally {
    lock.releaseLock();
  }
}

function deregisterParticipant_(participant) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var current = findParticipantByPersonId_(participant.personId, readParticipants_());
    if (!current) throw new Error("Participant no longer exists.");
    getParticipantsSheet_().getRange(current.rowNumber, 19, 1, 2).clearContent();
    AM_CONFIG.PARTICIPANT_BOTS.forEach(function (bot) {
      PropertiesService.getScriptProperties().deleteProperty(participantStartBindingKey_(current.personId, bot));
    });
    current.angelBotStartedAt = "";
    current.mortalBotStartedAt = "";
    return {participant: current, oldTelegramId: current.telegramId};
  } finally {
    lock.releaseLock();
  }
}

function regenerateParticipantCode_() {
  throw new Error("Registration codes are not used; Telegram IDs come directly from the signup form.");
}
