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
    console.error("Could not register the live-test bot start: " + safeDiagnostic_(error));
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
      try {
        telegramSendMessage_(bot, telegramId, "Welcome " + name + "! Safe test mode is active.");
        if (command.name === "start") {
          telegramSendMessage_(bot, telegramId, "Your " + bot + " bot registration is saved.");
        }
        telegramSendMessage_(bot, telegramId, liveTestHelpText_(bot));
      } catch (error) {
        sendDeliveryFailure_(bot, telegramId, error, command.name === "start"
          ? "Your safe-test bot registration was saved, but the welcome message"
          : "The safe-test help message");
      }
      return;
    }
    telegramSendMessage_(bot, telegramId, liveTestHelpText_(bot));
    return;
  }
  var otherBot = participantBotLabels_(bot).otherBot;
  try {
    relayTelegramMessage_(bot, otherBot, telegramId, message);
  } catch (error) {
    console.error("Safe test relay failed for update " + update.update_id + ": " + safeDiagnostic_(error));
    sendDeliveryFailure_(bot, telegramId, error, "The safe relay test message");
    return;
  }
  try {
    telegramSendMessage_(bot, telegramId, "Test passed: the message was relayed through the other bot.");
  } catch (error) {
    console.error("Safe test acknowledgement failed for update " + update.update_id + ": " + safeDiagnostic_(error));
    sendParticipantFailure_(bot, telegramId,
      "Test passed: the message was relayed through the other bot. I could not confirm this acknowledgement here. Check the other bot before repeating the test.");
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
      console.warn("Could not leave non-private chat: " + safeDiagnostic_(ignored));
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
        console.error("Could not read participant signups: " + safeDiagnostic_(readError));
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
    var startRoute;
    try {
      startRoute = resolveSafeRelayRoute_(participant, bot, participants.byId);
    } catch (error) {
      console.error("Participant route check failed for update " + update.update_id + ": " + safeDiagnostic_(error));
      sendParticipantFailure_(bot, telegramId, "The pairing changed while I was checking it. Please send /start again.");
      return;
    }
    if (!startRoute) {
      sendParticipantFailure_(bot, telegramId, "Your pairing for this bot is still being updated. No bot registration was saved; please try /start again after the mapping is ready.");
      return;
    }
    try {
      handleParticipantStart_(bot, telegramId, participant, participants.byId);
    } catch (error) {
      console.error("Participant start delivery failed for update " + update.update_id + ": " + safeDiagnostic_(error));
      if (error.registrationSaved) {
        sendDeliveryFailure_(bot, telegramId, error, "Your bot registration was saved, but the welcome/profile message");
      } else {
        sendParticipantFailure_(bot, telegramId, "I could not save your bot registration. Please try /start again.");
      }
    }
    return;
  }

  if (command && command.name === "help") {
    try {
      sendParticipantWelcome_(bot, telegramId, participant);
      if (!participant) return;
      telegramSendMessage_(bot, telegramId, participantHelpText_(bot));
    } catch (error) {
      sendDeliveryFailure_(bot, telegramId, error, "The help message");
    }
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
        try {
          sendMortalDetails_(bot, telegramId, participant, participants.byId);
        } catch (error) {
          sendDeliveryFailure_(bot, telegramId, error, "Your mortal profile");
        }
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
    console.error("Relay failed for update " + update.update_id + ": " + safeDiagnostic_(error));
    sendDeliveryFailure_(bot, telegramId, error, "This message");
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
    console.error("Could not send participant failure notice: " + safeDiagnostic_(error));
  }
}

function sendDeliveryFailure_(bot, telegramId, error, subject) {
  var message;
  if (error.partialDelivery) {
    message = subject + " was partly delivered. Remaining content may not have arrived. Please check with the organisers before resending.";
  } else if (error.deliveryStatus === "unknown") {
    message = subject + " delivery could not be confirmed. It may have arrived; please check with the organisers before resending.";
  } else if (error.retryAfterSeconds) {
    message = subject + " was not sent. Please wait at least " + error.retryAfterSeconds + " seconds before trying again.";
  } else {
    message = subject + " was not delivered. Please try once more.";
  }
  sendParticipantFailure_(bot, telegramId, message);
}

function handleParticipantStart_(bot, telegramId, participant, byId) {
  markParticipantBotStarted_(participant, bot);
  var welcomeSent = false;
  try {
    if (bot === "mortal") {
      telegramSendMessage_(bot, telegramId, "Welcome " + participant.name + "! Messages sent here are relayed anonymously to your mortal.");
      welcomeSent = true;
      telegramSendMessage_(bot, telegramId, "Your role for this pairing is " + participant.roleToMortal + ".");
      sendMortalDetails_(bot, telegramId, participant, byId);
    } else {
      telegramSendMessage_(bot, telegramId, "Welcome " + participant.name + "! Messages sent here are relayed anonymously to your angel. Your angel's identity stays secret.");
      welcomeSent = true;
    }

    var direction = resolveRelayDirection_(participant, bot);
    var other = byId[direction.targetId];
    var ready = other && other.telegramId && participantHasStartedBot_(other, direction.targetBot);
    telegramSendMessage_(bot, telegramId, ready ?
      "Your " + direction.targetLabel + " has joined the receiving bot. The relay is ready." :
      "Your " + direction.targetLabel + " has not opened the receiving bot yet. I will notify you when they join.");

    // Re-notify the current partner on /start. This intentionally follows the
    // latest mapping even when an earlier pairing used the same participant.
    try {
      notifyPartnerOfBotStart_(participant, bot, byId);
    } catch (error) {
      console.error("Partner notification failed: " + safeDiagnostic_(error));
      sendDeliveryFailure_(bot, telegramId, error, "Your bot registration is saved. The partner notification");
    }
  } catch (error) {
    error.registrationSaved = true;
    if (welcomeSent) error.partialDelivery = true;
    throw error;
  }
}

function notifyPartnerOfBotStart_(participant, bot, byId) {
  if (bot === "angel") {
    var angel = byId[participant.angelId];
    if (angel && angel.telegramId && participantHasStartedBot_(angel, "mortal")) {
      telegramSendMessage_("mortal", angel.telegramId, "Your mortal " + participant.name + " has joined the Angel bot. You can message them now.");
      try {
        telegramSendLongMessage_("mortal", angel.telegramId, mortalIntroText_(participant));
      } catch (error) {
        error.partialDelivery = true;
        throw error;
      }
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
  telegramSendLongMessage_(bot, telegramId, "You are acting as " + participant.roleToMortal + " for this mortal.\n\n" + mortalIntroText_(mortal));
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
      console.warn("Deregister notice failed for " + bot + ": " + safeDiagnostic_(error));
    }
  });
}
