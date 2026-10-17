const ALLOWED_BOTS = new Set(["angel", "mortal", "admin"]);
const WEBHOOK_KEY_ENV = Object.freeze({
  angel: "ANGEL_WEBHOOK_KEY",
  mortal: "MORTAL_WEBHOOK_KEY",
  admin: "ADMIN_WEBHOOK_KEY"
});
const MAX_UPDATE_BYTES = 1024 * 1024;
const TEXT_HEADERS = Object.freeze({
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store"
});

export function buildAppsScriptUrl(appsScriptUrl, bot, key) {
  const target = new URL(appsScriptUrl);
  target.searchParams.set("bot", bot);
  target.searchParams.set("key", key);
  return target.toString();
}

function respond(status, body) {
  return new Response(body, {status, headers: TEXT_HEADERS});
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

export async function handleRequest(request, env, fetchImpl = fetch) {
  const requestUrl = new URL(request.url);
  if (request.method === "GET" && requestUrl.pathname === "/healthz") {
    return respond(200, "ok");
  }
  if (request.method !== "POST" || requestUrl.pathname !== "/telegram") {
    return respond(404, "not found");
  }

  const bot = String(requestUrl.searchParams.get("bot") || "").toLowerCase();
  const key = String(requestUrl.searchParams.get("key") || "");
  if (!ALLOWED_BOTS.has(bot) || !/^[A-Za-z0-9_-]{32,256}$/.test(key)) {
    return respond(403, "forbidden");
  }

  const expectedKey = String(env?.[WEBHOOK_KEY_ENV[bot]] || "").trim();
  if (!expectedKey) {
    console.error("Webhook key is not configured for " + bot + ".");
    return respond(503, "gateway unavailable");
  }
  if (!constantTimeEquals(key, expectedKey)) return respond(403, "forbidden");

  const appsScriptUrl = String(env?.APPS_SCRIPT_URL || "").trim();
  if (!appsScriptUrl) {
    console.error("APPS_SCRIPT_URL is not configured.");
    return respond(503, "gateway unavailable");
  }

  const announcedLength = Number(request.headers.get("content-length") || 0);
  if (announcedLength > MAX_UPDATE_BYTES) {
    return respond(413, "update too large");
  }

  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_UPDATE_BYTES) {
      return respond(413, "update too large");
    }
    JSON.parse(new TextDecoder().decode(body));

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
      return respond(503, "upstream unavailable");
    }
    return respond(200, "ok");
  } catch (error) {
    // Upstream and parser exceptions may contain request data or private URLs.
    console.error("Telegram gateway failure; request or upstream processing failed.");
    return respond(503, "gateway unavailable");
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
