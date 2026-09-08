function extractCommand_(text) {
  text = String(text || "").trim();
  if (!text.startsWith("/")) {
    return null;
  }
  var match = /^\/([a-zA-Z_]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) {
    return null;
  }
  return {name: match[1].toLowerCase(), argument: String(match[2] || "").trim()};
}

function participantBotLabels_(bot) {
  if (bot === "angel") {
    return {targetLabel: "angel", otherBot: "mortal"};
  }
  if (bot === "mortal") {
    return {targetLabel: "mortal", otherBot: "angel"};
  }
  throw new Error("Invalid participant bot role: " + bot);
}

function resolveRelayDirection_(participant, bot) {
  var labels = participantBotLabels_(bot);
  return {
    targetId: bot === "angel" ? participant.angelId : participant.mortalId,
    targetLabel: labels.targetLabel,
    targetBot: labels.otherBot
  };
}

function currentParticipantDirectory_() {
  var analysis = analyzePairings_(buildParticipantsFromForm_());
  return {
    participants: analysis.participants,
    byId: analysis.indexes.byId
  };
}

function resolveSafeRelayRoute_(participant, bot, byId) {
  var direction = resolveRelayDirection_(participant, bot);
  var target = byId[direction.targetId];
  if (!target) return null;
  if ((participant.formIssues || []).length || (target.formIssues || []).length) return null;
  var currentParticipants = Object.keys(byId).map(function (id) { return byId[id]; });
  if (findParticipantByTelegramId_(target.telegramId, currentParticipants) !== target) return null;
  if (bot === "mortal" && target.angelId !== participant.personId) return null;
  if (bot === "angel" && target.mortalId !== participant.personId) return null;
  return {direction: direction, target: target};
}

function isLiveTestAccount_(telegramId) {
  if (getProperty_(AM_CONFIG.TEST_MODE_ENABLED_PROPERTY).toLowerCase() !== "true") {
    return false;
  }
  var configured = getProperty_(AM_CONFIG.TEST_TELEGRAM_ID_PROPERTY);
  return !!configured && constantTimeEquals_(configured, String(telegramId || ""));
}

function liveTestHelpText_(bot) {
  var otherBot = participantBotLabels_(bot).otherBot;
  var username = getBotUsername_(otherBot);
  var destination = username ? "@" + username : "the " + otherBot + " bot";
  return "Send any text or supported media here. It will return to you through " + destination + ". No participant will receive it.";
}

function registerLiveTestBotStart_(telegramId, bot) {
  try {
    var participant = findParticipantByTelegramId_(telegramId, readParticipants_());
    if (!participant) return false;
    markParticipantBotStarted_(participant, bot);
    return true;
  } catch (error) {
    console.error("Could not register the live-test bot start: " + error.stack);
    return false;
  }
}

function handleLiveTestUpdate_(bot, update) {
  var message = update.message;
  var telegramId = String(message.from.id);
  var command = extractCommand_(String(message.text || "").trim());
  var name = getProperty_(AM_CONFIG.TEST_TELEGRAM_NAME_PROPERTY) || "tester";
  if (command) {
    if (command.name === "start" || command.name === "help") {
      if (command.name === "start" && !registerLiveTestBotStart_(telegramId, bot)) {
        sendParticipantFailure_(bot, telegramId, "Safe test mode is working, but I could not save your bot registration.");
        return;
      }
      telegramSendMessage_(bot, telegramId, "Welcome " + name + "! Safe test mode is active.");
      if (command.name === "start") {
        telegramSendMessage_(bot, telegramId, "Your " + bot + " bot registration is saved.");
      }
      telegramSendMessage_(bot, telegramId, liveTestHelpText_(bot));
      return;
    }
    telegramSendMessage_(bot, telegramId, liveTestHelpText_(bot));
    return;
  }
  var otherBot = participantBotLabels_(bot).otherBot;
  try {
    relayTelegramMessage_(bot, otherBot, telegramId, message);
    telegramSendMessage_(bot, telegramId, "Test passed: the message was relayed through the other bot.");
  } catch (error) {
    console.error("Safe test relay failed for update " + update.update_id + ": " + error.stack);
    sendParticipantFailure_(bot, telegramId, "I could not complete the safe relay test. Please try once more.");
  }
}

function handleParticipantUpdate_(bot, update) {
  var message = update.message;
  if (!message || !message.from || !message.chat) {
    return;
  }
  if (message.chat.type !== "private") {
    telegramSendMessage_(bot, message.chat.id, "Please don't add me to groups. I only handle private chats.");
    try {
      telegramApi_(bot, "leaveChat", {chat_id: String(message.chat.id)});
    } catch (ignored) {
      console.warn("Could not leave non-private chat: " + ignored.message);
    }
    return;
  }

  var telegramId = String(message.from.id);
  var text = String(message.text || "").trim();
  var command = extractCommand_(text);

  if (isLiveTestAccount_(telegramId)) {
    handleLiveTestUpdate_(bot, update);
    return;
  }

  // Deliberately reload the current Sheet mapping for every update. A complete,
  // unambiguous pair can operate while unrelated mappings are still unfinished.
  // No participant pairing is cached between Telegram messages.
  var participants;
  try {
    participants = currentParticipantDirectory_();
  } catch (error) {
    if (command && (command.name === "start" || command.name === "help")) {
      var signup = null;
      var signupReadable = true;
      try {
        signup = findParticipantByTelegramId_(telegramId, readParticipants_());
      } catch (readError) {
        signupReadable = false;
        console.error("Could not read participant signups: " + readError.stack);
      }
      if (signup) {
        sendParticipantFailure_(bot, telegramId, "Welcome " + signup.name + "! Your signup is linked, but pairings are being updated. Please try again shortly.");
      } else if (!signupReadable) {
        sendParticipantFailure_(bot, telegramId, "I could not read the participant list, so this message was not sent. Please try again shortly.");
      } else {
        sendParticipantWelcome_(bot, telegramId, null);
      }
    } else {
      sendParticipantFailure_(bot, telegramId, "Pairings are being updated, so this message was not sent. Please try again shortly.");
    }
    return;
  }
  var participant = findParticipantByTelegramId_(telegramId, participants.participants);

  if (command && command.name === "start") {
    if (!participant) {
      sendParticipantWelcome_(bot, telegramId, null);
      return;
    }
    try {
      var startRoute = resolveSafeRelayRoute_(participant, bot, participants.byId);
      if (!startRoute) {
        sendParticipantFailure_(bot, telegramId, "Your pairing for this bot is still being updated. No bot registration was saved; please try /start again after the mapping is ready.");
        return;
      }
      handleParticipantStart_(bot, telegramId, participant, participants.byId);
    } catch (error) {
      console.error("Participant start failed for update " + update.update_id + ": " + error.stack);
      sendParticipantFailure_(bot, telegramId, "The pairing changed while I was checking it. Please send /start again.");
    }
    return;
  }

  if (command && command.name === "help") {
    sendParticipantWelcome_(bot, telegramId, participant);
    if (!participant) return;
    telegramSendMessage_(bot, telegramId, participantHelpText_(bot));
    return;
  }

  if (!participant) {
    sendParticipantFailure_(bot, telegramId, "I could not match your Telegram ID to the signup form. Check the numeric Telegram ID you submitted.");
    return;
  }

  if (command) {
    switch (command.name) {
      case "mortal":
        if (bot !== "mortal") {
          telegramSendMessage_(bot, telegramId, "Use the Mortal bot to see and message your mortal. This Angel bot is only for messaging your angel anonymously.");
          return;
        }
        if (!resolveSafeRelayRoute_(participant, "mortal", participants.byId)) {
          sendParticipantFailure_(bot, telegramId, "Your mortal pairing is still being updated. Please try again shortly.");
          return;
        }
        sendMortalDetails_(bot, telegramId, participant, participants.byId);
        return;
      case "angel":
        telegramSendMessage_(bot, telegramId, bot === "angel" ?
          "Your angel's identity is secret. Send messages here and the Angel bot will relay them anonymously." :
          "Use the Angel bot to message your angel anonymously. Their identity stays secret.");
        return;
      default:
        telegramSendMessage_(bot, telegramId, participantHelpText_(bot));
        return;
    }
  }

  var route = resolveSafeRelayRoute_(participant, bot, participants.byId);
  if (!route) {
    sendParticipantFailure_(bot, telegramId, "Your pairing for this bot is still being updated, so this message was not sent. Please try again shortly.");
    return;
  }
  var direction = route.direction;
  var target = route.target;
  if (!target || !target.telegramId || !participantHasStartedBot_(target, direction.targetBot)) {
    sendParticipantFailure_(bot, telegramId, "Your " + direction.targetLabel + " has not opened the receiving bot yet, so this message was not sent. Please try again after they join.");
    return;
  }
  try {
    relayTelegramMessage_(bot, direction.targetBot, target.telegramId, message);
  } catch (error) {
    console.error("Relay failed for update " + update.update_id + ": " + error.stack);
    sendParticipantFailure_(bot, telegramId, error.retryAfterSeconds
      ? "This message was not sent. Please wait at least " + error.retryAfterSeconds + " seconds, then send it again."
      : "I could not send that message. Please try once more.");
  }
}

function handleRegistration_(bot, telegramId, code) {
  var result = registerParticipant_(code, telegramId);
  if (result.status === "already-user") {
    telegramSendMessage_(bot, telegramId, "Your signup is linked as " + result.participant.name + ". Registration codes are not required.");
    return result.participant;
  }
  telegramSendMessage_(bot, telegramId, "Registration codes are not used. Your Telegram ID must match the numeric ID in the signup form.");
  return null;
}

function sendOtherBotHint_(currentBot, telegramId) {
  var otherBot = participantBotLabels_(currentBot).otherBot;
  var username = getBotUsername_(otherBot);
  if (username) {
    telegramSendMessage_(currentBot, telegramId, "Open @" + username + " as well so you can chat in both directions.");
  } else {
    telegramSendMessage_(currentBot, telegramId, "Open the other Angel/Mortal bot as well so you can chat in both directions.");
  }
}

function sendParticipantWelcome_(bot, telegramId, participant) {
  var label = participantBotLabels_(bot).targetLabel;
  if (!participant) {
    sendParticipantFailure_(bot, telegramId, "I could not match your Telegram ID to the signup form yet. Check the numeric ID you submitted.");
    return;
  }
  telegramSendMessage_(bot, telegramId, "Welcome " + participant.name + "! Messages sent here are relayed anonymously to your " + label + ".");
  if (bot === "mortal") {
    telegramSendMessage_(bot, telegramId, "Use /mortal to see your mortal's details.");
  }
}

function sendParticipantFailure_(bot, telegramId, message) {
  try {
    telegramSendMessage_(bot, telegramId, withOrganiserHelp_(message));
  } catch (error) {
    console.error("Could not send participant failure notice: " + error.message);
  }
}

function handleParticipantStart_(bot, telegramId, participant, byId) {
  markParticipantBotStarted_(participant, bot);
  if (bot === "mortal") {
    telegramSendMessage_(bot, telegramId, "Welcome " + participant.name + "! Messages sent here are relayed anonymously to your mortal.");
    telegramSendMessage_(bot, telegramId, "Your role for this pairing is " + participant.roleToMortal + ".");
    sendMortalDetails_(bot, telegramId, participant, byId);
  } else {
    telegramSendMessage_(bot, telegramId, "Welcome " + participant.name + "! Messages sent here are relayed anonymously to your angel. Your angel's identity stays secret.");
  }

  var direction = resolveRelayDirection_(participant, bot);
  var other = byId[direction.targetId];
  var ready = other && other.telegramId && participantHasStartedBot_(other, direction.targetBot);
  telegramSendMessage_(bot, telegramId, ready ?
    "Your " + direction.targetLabel + " has joined the receiving bot. The relay is ready." :
    "Your " + direction.targetLabel + " has not opened the receiving bot yet. I will notify you when they join.");

  // Re-notify the current partner on /start. This intentionally follows the
  // latest mapping even when an earlier pairing used the same participant.
  notifyPartnerOfBotStart_(participant, bot, byId);
}

function notifyPartnerOfBotStart_(participant, bot, byId) {
  if (bot === "angel") {
    var angel = byId[participant.angelId];
    if (angel && angel.telegramId && participantHasStartedBot_(angel, "mortal")) {
      telegramSendMessage_("mortal", angel.telegramId, "Your mortal " + participant.name + " has joined the Angel bot. You can message them now.");
      telegramSendMessage_("mortal", angel.telegramId, mortalIntroText_(participant));
    }
    return;
  }
  var mortal = byId[participant.mortalId];
  if (mortal && mortal.telegramId && participantHasStartedBot_(mortal, "angel")) {
    telegramSendMessage_("angel", mortal.telegramId, "Your angel has joined the Mortal bot. You can reply anonymously now.");
  }
}

function participantHelpText_(bot) {
  var directionLines = bot === "mortal" ? [
    "Angel/Devil: send messages here in the Mortal bot. Your mortal receives them in the Angel bot.",
    "/mortal — see your mortal"
  ] : [
    "Mortal: send messages here in the Angel bot. Your angel receives them in the Mortal bot.",
    "Your angel's identity stays secret."
  ];
  return directionLines.concat([
    "/help — show this help",
    "Supported media: photo, sticker, video, voice, document, animation, and video note.",
    organiserHelpText_()
  ]).join("\n");
}

function mortalIntroText_(mortal) {
  var lines = ["Your mortal is " + mortal.name + "!"];
  if (mortal.room) lines.push("Room: " + mortal.room);
  if (mortal.intro) lines.push(mortal.intro);
  return lines.join("\n");
}

function sendMortalDetails_(bot, telegramId, participant, byId) {
  var mortal = byId[participant.mortalId];
  if (!mortal) {
    sendParticipantFailure_(bot, telegramId, "Your mortal pairing is not configured yet.");
    return;
  }
  telegramSendMessage_(bot, telegramId, "You are acting as " + participant.roleToMortal + " for this mortal.\n\n" + mortalIntroText_(mortal));
}

function handleSelfDeregister_(telegramId, participant) {
  var result = deregisterParticipant_(participant);
  if (!result.oldTelegramId) {
    return;
  }
  AM_CONFIG.PARTICIPANT_BOTS.forEach(function (bot) {
    try {
      telegramSendMessage_(bot, telegramId, "Successfully deregistered. Use your code to register again.");
    } catch (error) {
      console.warn("Deregister notice failed for " + bot + ": " + error.message);
    }
  });
}
