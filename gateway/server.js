"use strict";

const http = require("node:http");

const ALLOWED_BOTS = new Set(["angel", "mortal", "admin"]);
const MAX_UPDATE_BYTES = 1024 * 1024;

function buildAppsScriptUrl(appsScriptUrl, bot, key) {
  const target = new URL(appsScriptUrl);
  target.searchParams.set("bot", bot);
  target.searchParams.set("key", key);
  return target.toString();
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_UPDATE_BYTES) {
        const error = new Error("Telegram update exceeds the gateway size limit.");
        error.code = "UPDATE_TOO_LARGE";
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function send(response, status, text) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(text);
}

function constantTimeEquals(left, right) {
  left = String(left || "");
  right = String(right || "");
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index % Math.max(left.length, 1)) || 0) ^
      (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return mismatch === 0;
}

function createServer(options = {}) {
  const appsScriptUrl = options.appsScriptUrl || process.env.APPS_SCRIPT_URL;
  const fetchImpl = options.fetchImpl || fetch;
  const webhookKeys = options.webhookKeys || {
    angel: process.env.ANGEL_WEBHOOK_KEY,
    mortal: process.env.MORTAL_WEBHOOK_KEY,
    admin: process.env.ADMIN_WEBHOOK_KEY
  };

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");
    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      send(response, 200, "ok");
      return;
    }
    if (request.method !== "POST" || requestUrl.pathname !== "/telegram") {
      send(response, 404, "not found");
      return;
    }

    const bot = String(requestUrl.searchParams.get("bot") || "").toLowerCase();
    const key = String(requestUrl.searchParams.get("key") || "");
    if (!ALLOWED_BOTS.has(bot) || !/^[A-Za-z0-9_-]{32,256}$/.test(key)) {
      send(response, 403, "forbidden");
      return;
    }
    const expectedKey = String(webhookKeys[bot] || "").trim();
    if (!expectedKey) {
      console.error("Webhook key is not configured for " + bot + ".");
      send(response, 503, "gateway unavailable");
      return;
    }
    if (!constantTimeEquals(key, expectedKey)) {
      send(response, 403, "forbidden");
      return;
    }
    if (!appsScriptUrl) {
      console.error("APPS_SCRIPT_URL is not configured.");
      send(response, 503, "gateway unavailable");
      return;
    }

    try {
      const body = await readRequestBody(request);
      JSON.parse(body.toString("utf8"));
      const upstream = await fetchImpl(buildAppsScriptUrl(appsScriptUrl, bot, key), {
        method: "POST",
        headers: {"content-type": "application/json"},
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(55000)
      });
      const upstreamText = await upstream.text();
      if (!upstream.ok || upstreamText.trim() !== "ok") {
        console.error("Apps Script rejected a Telegram update with HTTP " + upstream.status + ".");
        send(response, 503, "upstream unavailable");
        return;
      }
      send(response, 200, "ok");
    } catch (error) {
      if (error && error.code === "UPDATE_TOO_LARGE") {
        send(response, 413, "update too large");
        return;
      }
      // Upstream and parser exceptions may contain request data or private URLs.
      console.error("Telegram gateway failure; request or upstream processing failed.");
      send(response, 503, "gateway unavailable");
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createServer().listen(port, "0.0.0.0", () => {
    console.log("Angel Mortal Telegram gateway listening on port " + port + ".");
  });
}

module.exports = {buildAppsScriptUrl, createServer};
