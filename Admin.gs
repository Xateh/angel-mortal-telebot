function captureAdminTelegramId() {
  requireProperty_("ADMIN_BOT_TOKEN");
  // Compatibility entry point: only validate an ID explicitly set by the owner.
  // Never infer administrator privileges from untrusted incoming messages.
  if (!/^[1-9]\d{4,19}$/.test(getProperty_("ADMIN_TELEGRAM_ID"))) {
    throw new Error("Set ADMIN_TELEGRAM_ID in Script Properties to your verified numeric Telegram ID. Automatic binding from messages is disabled.");
  }
  return "Telegram organiser ID is already configured.";
}

function handleAdminUpdate_(update) {
  var message = update.message;
  if (!message || !message.from || !message.chat || message.chat.type !== "private") {
    return;
  }
  var chatId = String(message.chat.id);
  var allowedId = getProperty_("ADMIN_TELEGRAM_ID");
  if (!allowedId || String(message.from.id) !== allowedId) {
    telegramSendMessage_("admin", chatId, "Not authorized.");
    return;
  }
  var command = extractCommand_(message.text || "");
  if (!command || command.name === "start" || command.name === "help") {
    telegramSendMessage_("admin", chatId, adminHelpText_());
    return;
  }
  try {
    switch (command.name) {
      case "status":
        adminStatus_(chatId);
        break;
      case "list":
      case "codes":
        adminList_(chatId);
        break;
      case "person":
        adminPerson_(chatId, command.argument);
        break;
      case "reset":
      case "deregister":
        adminDeregister_(chatId, command.argument);
        break;
      case "announce":
        adminAnnounce_(chatId, command.argument);
        break;
      case "sync":
        var summary = syncParticipants_();
        telegramSendMessage_("admin", chatId, "Synchronized " + summary.total + " participants; " + summary.registered + " registered.");
        break;
      default:
        telegramSendMessage_("admin", chatId, adminHelpText_());
    }
  } catch (error) {
    console.error("Admin command failed: " + error.stack);
    telegramSendMessage_("admin", chatId, "Command failed: " + error.message);
  }
}

function adminHelpText_() {
  return [
    "Angel Mortal admin",
    "/status — registration and webhook status",
    "/list — list names, roles, pairings, and bot readiness",
    "/person <Telegram ID or exact name> — inspect one participant",
    "/reset <Telegram ID or exact name> — reset bot-joined timestamps",
    "/announce <message> — message every registered participant",
    "/sync — synchronize and validate the participant sheet"
  ].join("\n");
}

function adminStatus_(chatId) {
  var summary = validateParticipants_();
  var lines = [
    "Participants: " + summary.total,
    "Registered: " + summary.registered,
    "Unregistered: " + (summary.total - summary.registered),
    "Angel bot joined: " + summary.participants.filter(function (participant) { return participantHasStartedBot_(participant, "angel"); }).length,
    "Mortal bot joined: " + summary.participants.filter(function (participant) { return participantHasStartedBot_(participant, "mortal"); }).length
  ];
  enabledBots_().forEach(function (bot) {
    try {
      var info = telegramGetWebhookInfo_(bot);
      var status = info.url ? "active" : "missing";
      if (info.last_error_message) status += "; last error: " + info.last_error_message;
      lines.push(bot + " webhook: " + status);
    } catch (error) {
      lines.push(bot + " webhook: check failed");
    }
  });
  telegramSendLongMessage_("admin", chatId, lines.join("\n"));
}

function adminList_(chatId) {
  var summary = validateParticipants_();
  var lines = summary.participants.map(function (participant) {
    var mortal = summary.byId[participant.mortalId];
    return participant.name + " | " + participant.roleToMortal + " -> " + mortal.name + " | " +
      (participant.telegramId ? "form linked" : "missing Telegram ID");
  });
  telegramSendLongMessage_("admin", chatId, lines.join("\n"));
}

function adminPerson_(chatId, identifier) {
  var summary = validateParticipants_();
  var participant = findParticipantByIdentifier_(identifier, summary.participants);
  if (!participant) {
    telegramSendMessage_("admin", chatId, "Participant not found. Use an exact name or numeric Telegram ID.");
    return;
  }
  var mortal = summary.byId[participant.mortalId];
  var angel = summary.byId[participant.angelId];
  telegramSendMessage_("admin", chatId, [
    "Name: " + participant.name,
    "Telegram ID: " + participant.telegramId,
    "Room: " + (participant.room || "—"),
    "Role to mortal: " + participant.roleToMortal,
    "Mortal: " + mortal.name,
    "Angel: " + angel.name,
    "Registered: " + (participant.telegramId ? "yes" : "no"),
    "Angel bot joined: " + (participantHasStartedBot_(participant, "angel") ? "yes" : "no"),
    "Mortal bot joined: " + (participantHasStartedBot_(participant, "mortal") ? "yes" : "no")
  ].join("\n"));
}

function adminDeregister_(chatId, identifier) {
  var participant = findParticipantByIdentifier_(identifier, readParticipants_());
  if (!participant) {
    telegramSendMessage_("admin", chatId, "Participant not found. Use an exact name or numeric Telegram ID.");
    return;
  }
  var result = deregisterParticipant_(participant);
  telegramSendMessage_("admin", chatId, result.participant.name + " now has both bot-joined timestamps reset.");
}

function adminAnnounce_(chatId, announcement) {
  if (!announcement) {
    telegramSendMessage_("admin", chatId, "Usage: /announce <message>");
    return;
  }
  var participants = readParticipants_().filter(function (participant) { return !!participant.telegramId; });
  var delivered = 0;
  var failed = 0;
  participants.forEach(function (participant) {
    try {
      telegramSendMessage_("angel", participant.telegramId, "Organiser announcement:\n" + announcement);
      delivered += 1;
    } catch (error) {
      failed += 1;
      console.warn("Announcement failed for " + participant.personId + ": " + error.message);
    }
  });
  telegramSendMessage_("admin", chatId, "Announcement delivered to " + delivered + "; failed for " + failed + ".");
}
