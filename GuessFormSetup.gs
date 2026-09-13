var GUESS_KEYS_ = [
  "GUESS_FORM_ID", "GUESS_PERSON_ITEM_ID", "GUESS_ANGEL_ITEM_ID", "GUESS_DEVIL_ITEM_ID",
  "GUESS_ANGEL_SECTION_ID", "GUESS_DEVIL_SECTION_ID"
];
var GUESS_EMPTY_PEOPLE_ = "No participants available";
var GUESS_EMPTY_CANDIDATES_ = "No candidates available";

function buildGuessChoicePlan_(participants) {
  if (!Array.isArray(participants)) throw new Error("GUESS_ROSTER_INVALID");
  var seenIds = Object.create(null);
  var seenLabels = Object.create(null);
  var people = participants.map(function (participant) {
    var personId = String(participant && participant.personId || "").trim();
    var name = String(participant && participant.name || "").trim();
    var room = String(participant && participant.room || "").trim();
    if (!personId || !name || !room) throw new Error("GUESS_INVALID_ID_OR_LABEL");
    if (seenIds[personId]) throw new Error("GUESS_DUPLICATE_ID");
    seenIds[personId] = true;
    var label = name + " — " + room;
    if (seenLabels[label]) throw new Error("GUESS_AMBIGUOUS_LABEL");
    seenLabels[label] = true;
    if (participant.mode !== "Angel" && participant.mode !== "Devil") throw new Error("GUESS_INVALID_MODE");
    if (participant.roleToMortal !== "Angel" && participant.roleToMortal !== "Devil") throw new Error("GUESS_PAIRING_NOT_READY");
    if (participant.status && participant.status !== "Ready" || participant.issues && participant.issues.length) {
      throw new Error("GUESS_PAIRING_NOT_READY");
    }
    return {personId: personId, label: label, mode: participant.mode, roleToMortal: participant.roleToMortal, name: name, room: room};
  });
  var collator = new Intl.Collator("en", {sensitivity: "base", usage: "sort"});
  people.sort(function (left, right) {
    return collator.compare(left.name, right.name) ||
      collator.compare(left.room, right.room) ||
      (left.personId < right.personId ? -1 : left.personId > right.personId ? 1 : 0);
  });
  return {
    people: people.map(function (person) { return {personId: person.personId, label: person.label, mode: person.mode}; }),
    angel: people.filter(function (person) { return person.roleToMortal === "Angel"; })
      .map(function (person) { return {personId: person.personId, label: person.label}; }),
    devil: people.filter(function (person) { return person.roleToMortal === "Devil"; })
      .map(function (person) { return {personId: person.personId, label: person.label}; })
  };
}

function guessError_(code) { return new Error(code + ": Check guessing Form configuration and roster; no participant details were logged."); }

function guessLock_() {
  var lock;
  try { lock = LockService.getScriptLock(); }
  catch (_) { throw guessError_("GUESS_LOCK_UNAVAILABLE"); }
  var acquired;
  try { acquired = lock.tryLock(30000); }
  catch (_) { throw guessError_("GUESS_LOCK_UNAVAILABLE"); }
  if (!acquired) throw guessError_("GUESS_BUSY");
  return lock;
}

function guessSettings_() {
  try {
    var properties = getScriptProperties_();
    var settings = {};
    GUESS_KEYS_.forEach(function (key) { settings[key] = String(properties.getProperty(key) || "").trim(); });
    return settings;
  } catch (_) { throw guessError_("GUESS_CONFIG_UNAVAILABLE"); }
}

function guessItems_(form, settings) {
  if (GUESS_KEYS_.some(function (key) { return !settings[key]; })) throw guessError_("GUESS_NOT_CONFIGURED");
  var ids = GUESS_KEYS_.slice(1).map(function (key) { return Number(settings[key]); });
  if (ids.some(function (id) { return !Number.isSafeInteger(id) || id <= 0; }) || new Set(ids).size !== ids.length) {
    throw guessError_("GUESS_ITEMS_INVALID");
  }
  try {
    var raw = ids.map(function (id) { return form.getItemById(id); });
    var types = [FormApp.ItemType.MULTIPLE_CHOICE, FormApp.ItemType.LIST, FormApp.ItemType.LIST,
      FormApp.ItemType.PAGE_BREAK, FormApp.ItemType.PAGE_BREAK];
    if (raw.some(function (item, index) { return !item || item.getType() !== types[index]; })) {
      throw new Error("invalid item");
    }
    // Choice routing needs a first page; the Angel break submits the preceding Devil page.
    var expectedOrder = [ids[0], ids[4], ids[2], ids[3], ids[1]];
    var layout = form.getItems();
    if (layout.length !== expectedOrder.length || layout.some(function (item, index) {
      return item.getId() !== expectedOrder[index];
    }) || raw[3].asPageBreakItem().getPageNavigationType() !== FormApp.PageNavigationType.SUBMIT) {
      throw new Error("invalid layout");
    }
    return {
      person: raw[0].asMultipleChoiceItem(), angel: raw[1].asListItem(), devil: raw[2].asListItem(),
      angelSection: raw[3].asPageBreakItem(), devilSection: raw[4].asPageBreakItem()
    };
  } catch (_) { throw guessError_("GUESS_ITEMS_INVALID"); }
}

function createGuessingForm() {
  var lock = guessLock_();
  try {
    var settings = guessSettings_();
    if (settings.GUESS_FORM_ID) {
      var existing;
      try { existing = FormApp.openById(settings.GUESS_FORM_ID); }
      catch (_) { throw guessError_("GUESS_FORM_UNAVAILABLE"); }
      guessItems_(existing, settings);
      return {formId: existing.getId(), created: false};
    }
    if (GUESS_KEYS_.slice(1).some(function (key) { return settings[key]; })) throw guessError_("GUESS_CONFIG_INCOMPLETE");
    try {
      var form = FormApp.create("Angel/Mortal Guessing", false);
      form.setAcceptingResponses(false);
      form.setDescription("Select your name, then guess who acted as your Angel or Devil. Organizer must review settings before opening.");
      var person = form.addMultipleChoiceItem().setTitle("Your name and room").setRequired(true);
      var devilSection = form.addPageBreakItem().setTitle("Guess your Devil");
      var devil = form.addListItem().setTitle("Who was your Devil?").setRequired(true);
      var angelSection = form.addPageBreakItem().setTitle("Guess your Angel");
      var angel = form.addListItem().setTitle("Who was your Angel?").setRequired(true);
      // A page break controls navigation after the preceding section; Devil skips Angel.
      angelSection.setGoToPage(FormApp.PageNavigationType.SUBMIT);
      person.setChoices([person.createChoice(GUESS_EMPTY_PEOPLE_, FormApp.PageNavigationType.SUBMIT)]);
      angel.setChoices([angel.createChoice(GUESS_EMPTY_CANDIDATES_)]);
      devil.setChoices([devil.createChoice(GUESS_EMPTY_CANDIDATES_)]);
      var values = {
        GUESS_FORM_ID: form.getId(), GUESS_PERSON_ITEM_ID: String(person.getId()),
        GUESS_ANGEL_ITEM_ID: String(angel.getId()), GUESS_DEVIL_ITEM_ID: String(devil.getId()),
        GUESS_ANGEL_SECTION_ID: String(angelSection.getId()), GUESS_DEVIL_SECTION_ID: String(devilSection.getId())
      };
      guessItems_(form, values);
      getScriptProperties_().setProperties(values, false);
      return {formId: form.getId(), created: true};
    } catch (_) { throw guessError_("GUESS_SETUP_FAILED"); }
  } finally { try { lock.releaseLock(); } catch (_) { /* Apps Script releases it at execution end. */ } }
}

function guessChoiceMatches_(existing, wanted, branch) {
  return existing.length === wanted.length && existing.every(function (choice, index) {
    if (choice.getValue() !== wanted[index].label) return false;
    if (!branch) return true;
    var page = choice.getGotoPage();
    return !!page && page.getId() === wanted[index].target.getId() &&
      choice.getPageNavigationType() === FormApp.PageNavigationType.GO_TO_PAGE;
  });
}

function refreshGuessingFormOptions() {
  var lock = guessLock_();
  try {
    var settings = guessSettings_();
    if (!settings.GUESS_FORM_ID) throw guessError_("GUESS_NOT_CONFIGURED");
    var form;
    try { form = FormApp.openById(settings.GUESS_FORM_ID); }
    catch (_) { throw guessError_("GUESS_FORM_UNAVAILABLE"); }
    var items = guessItems_(form, settings);
    var roster;
    try { roster = readParticipants_(); }
    catch (_) { throw guessError_("GUESS_ROSTER_UNAVAILABLE"); }
    if (!roster.length) {
      if (items.person.getChoices().length === 1 && items.person.getChoices()[0].getValue() === GUESS_EMPTY_PEOPLE_) {
        return {ok: true, changed: false, participantCount: 0, angelCount: 0, devilCount: 0};
      }
      throw guessError_("GUESS_ROSTER_EMPTY");
    }
    try { roster = validateParticipants_().participants; }
    catch (_) { throw guessError_("GUESS_PAIRING_NOT_READY"); }
    var plan;
    try { plan = buildGuessChoicePlan_(roster); }
    catch (error) {
      var code = String(error && error.message || "");
      if (["GUESS_ROSTER_INVALID", "GUESS_INVALID_ID_OR_LABEL", "GUESS_DUPLICATE_ID",
        "GUESS_AMBIGUOUS_LABEL", "GUESS_INVALID_MODE", "GUESS_PAIRING_NOT_READY"].indexOf(code) === -1) {
        code = "GUESS_ROSTER_INVALID";
      }
      throw guessError_(code);
    }
    var wanted = {
      person: plan.people.map(function (person) {
        return {label: person.label, target: person.mode === "Angel" ? items.angelSection : items.devilSection};
      }),
      angel: (plan.angel.length ? plan.angel : [{label: GUESS_EMPTY_CANDIDATES_}]).map(function (candidate) { return {label: candidate.label}; }),
      devil: (plan.devil.length ? plan.devil : [{label: GUESS_EMPTY_CANDIDATES_}]).map(function (candidate) { return {label: candidate.label}; })
    };
    var before;
    try {
      before = {person: items.person.getChoices(), angel: items.angel.getChoices(), devil: items.devil.getChoices()};
      var changed = ["person", "angel", "devil"].filter(function (key) {
        return !guessChoiceMatches_(before[key], wanted[key], key === "person");
      });
    } catch (_) { throw guessError_("GUESS_ITEMS_INVALID"); }
    if (!changed.length) return {ok: true, changed: false, participantCount: plan.people.length,
      angelCount: plan.angel.length, devilCount: plan.devil.length};
    try {
      changed.forEach(function (key) {
        items[key].setChoices(wanted[key].map(function (entry) {
          return key === "person" ? items[key].createChoice(entry.label, entry.target) : items[key].createChoice(entry.label);
        }));
      });
    } catch (_) {
      var restored = true;
      changed.forEach(function (key) {
        try { items[key].setChoices(before[key]); } catch (_) { restored = false; }
      });
      throw guessError_(restored ? "GUESS_REFRESH_FAILED" : "GUESS_RESTORE_FAILED");
    }
    return {ok: true, changed: true, participantCount: plan.people.length,
      angelCount: plan.angel.length, devilCount: plan.devil.length};
  } finally { try { lock.releaseLock(); } catch (_) { /* Apps Script releases it at execution end. */ } }
}

function installGuessingFormRefreshTrigger() {
  var lock = guessLock_();
  try {
    var settings = guessSettings_();
    if (!settings.GUESS_FORM_ID) throw guessError_("GUESS_NOT_CONFIGURED");
    var form;
    try { form = FormApp.openById(settings.GUESS_FORM_ID); }
    catch (_) { throw guessError_("GUESS_FORM_UNAVAILABLE"); }
    guessItems_(form, settings);
    try {
      if (!ScriptApp.getProjectTriggers().some(function (trigger) {
        return trigger.getHandlerFunction() === "refreshGuessingFormOptions";
      })) ScriptApp.newTrigger("refreshGuessingFormOptions").timeBased().everyHours(1).create();
    } catch (_) { throw guessError_("GUESS_TRIGGER_FAILED"); }
  } finally { try { lock.releaseLock(); } catch (_) { /* Apps Script releases it at execution end. */ } }
}

function removeGuessingFormRefreshTrigger() {
  var lock = guessLock_();
  try {
    try {
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === "refreshGuessingFormOptions") ScriptApp.deleteTrigger(trigger);
      });
    } catch (_) { throw guessError_("GUESS_TRIGGER_FAILED"); }
  } finally { try { lock.releaseLock(); } catch (_) { /* Apps Script releases it at execution end. */ } }
}
