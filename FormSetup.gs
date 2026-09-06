function formNavigationTarget_(target, pageBreaks) {
  if (target === "submit") return FormApp.PageNavigationType.SUBMIT;
  if (!pageBreaks[target]) throw new Error("Unknown Form navigation target: " + target);
  return pageBreaks[target];
}

function applyTextValidation_(item, validation) {
  if (!validation) return;
  var builder = FormApp.createTextValidation().setHelpText(validation.error || "");
  if (validation.type === "text_contains") {
    builder.requireTextContainsPattern(validation.value);
  } else if (validation.type === "number_greater_than") {
    builder.requireNumberGreaterThan(validation.value);
  } else {
    throw new Error("Unsupported text validation type: " + validation.type);
  }
  item.setValidation(builder.build());
}

function buildFormQuestion_(form, question, pageBreaks) {
  var item;
  if (question.type === "short_answer") {
    item = form.addTextItem();
    applyTextValidation_(item, question.validation);
  } else if (question.type === "multiple_choice") {
    item = form.addMultipleChoiceItem();
    item.setChoices((question.choices || []).map(function (choice) {
      var definition = typeof choice === "string" ? {value: choice} : choice;
      return definition.target
        ? item.createChoice(definition.value, formNavigationTarget_(definition.target, pageBreaks))
        : item.createChoice(definition.value);
    }));
  } else if (question.type === "checkboxes") {
    item = form.addCheckboxItem();
    item.setChoices((question.choices || []).map(function (choice) {
      return item.createChoice(typeof choice === "string" ? choice : choice.value);
    }));
    item.showOtherOption(!!question.other);
  } else if (question.type === "linear_scale") {
    item = form.addScaleItem()
      .setBounds(question.scale.lower, question.scale.upper)
      .setLabels(question.scale.lowLabel, question.scale.highLabel);
  } else {
    throw new Error("Unsupported form item type: " + question.type);
  }
  return item
    .setTitle(question.title)
    .setHelpText(question.description || "")
    .setRequired(!!question.required);
}

function buildFormItems_(form, schema) {
  var sections = schema.sections || [];
  var questions = schema.questions || [];
  var sectionByKey = {};
  var pageBreaks = {};
  var questionItems = [];

  sections.forEach(function (section, index) {
    if (!section.key || sectionByKey[section.key]) throw new Error("Form section keys must be unique and nonblank.");
    if ((index === 0) !== (section.key === "main")) throw new Error("The first Form section must be the implicit main section.");
    sectionByKey[section.key] = section;
    if (section.key !== "main") {
      pageBreaks[section.key] = form.addPageBreakItem()
        .setTitle(section.title || "")
        .setHelpText(section.description || "");
    }
  });

  questions.forEach(function (question) {
    if (!sectionByKey[question.section]) throw new Error("Unknown Form section: " + question.section);
    questionItems.push({question: question, item: buildFormQuestion_(form, question, pageBreaks)});
  });

  var finalItems = [];
  sections.forEach(function (section) {
    if (section.key !== "main") finalItems.push(pageBreaks[section.key]);
    questionItems.forEach(function (entry) {
      if (entry.question.section === section.key) finalItems.push(entry.item);
    });
  });
  finalItems.forEach(function (item, index) { form.moveItem(item.getIndex(), index); });

  for (var index = 0; index < sections.length - 1; index += 1) {
    var current = sections[index];
    if (!current.after) continue;
    var next = sections[index + 1];
    var navigation = current.after === next.key
      ? FormApp.PageNavigationType.CONTINUE
      : formNavigationTarget_(current.after, pageBreaks);
    pageBreaks[next.key].setGoToPage(navigation);
  }
  var last = sections[sections.length - 1];
  if (last && last.after && last.after !== "submit") {
    throw new Error("The final Form section must navigate to submit.");
  }
  return form;
}

function createEmptyAngelMortalStack() {
  var spreadsheet = SpreadsheetApp.create(FORM_SCHEMA.title + " (Responses)");
  var form = FormApp.create(FORM_SCHEMA.title, true)
    .setDescription(FORM_SCHEMA.description || "")
    .setCollectEmail(!!FORM_SCHEMA.settings.collectEmail)
    .setLimitOneResponsePerUser(!!FORM_SCHEMA.settings.limitOneResponsePerUser);
  buildFormItems_(form, FORM_SCHEMA);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());
  getScriptProperties_().setProperties({
    SPREADSHEET_ID: spreadsheet.getId(),
    FORM_RESPONSES_SPREADSHEET_ID: spreadsheet.getId(),
    FORM_RESPONSES_SHEET_NAME: "Form Responses 1"
  }, false);
  setupParticipantsSheet_();
  return {
    formId: form.getId(),
    spreadsheetId: spreadsheet.getId(),
    editUrl: form.getEditUrl(),
    publishedUrl: form.getPublishedUrl()
  };
}
