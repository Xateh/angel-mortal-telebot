import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import worker, {buildAppsScriptUrl, handleRequest} from "../worker.mjs";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/example/exec";
const KEY = "a".repeat(64);
const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Wrangler package targets the Worker entrypoint without plaintext variables", () => {
  const config = JSON.parse(fs.readFileSync(path.join(gatewayRoot, "wrangler.jsonc"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(gatewayRoot, "package.json"), "utf8"));
  assert.equal(config.main, "worker.mjs");
  assert.equal(Object.hasOwn(config, "vars"), false);
  assert.equal(JSON.stringify(config).includes("WEBHOOK_KEY"), false);
  assert.match(packageJson.devDependencies.wrangler, /^\^?4\./);
  assert.equal(packageJson.engines.node, ">=22.23.4");
});

test("Cloudflare URL builder preserves the deployment URL and adds authentication", () => {
  const result = new URL(buildAppsScriptUrl(APPS_SCRIPT_URL, "angel", KEY));
  assert.equal(result.origin + result.pathname, APPS_SCRIPT_URL);
  assert.equal(result.searchParams.get("bot"), "angel");
  assert.equal(result.searchParams.get("key"), KEY);
});

test("Cloudflare health check returns a direct 200", async () => {
  const response = await worker.fetch(new Request("https://gateway.example/healthz"), {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("Cloudflare gateway forwards valid Telegram updates", async () => {
  let forwarded;
  const fetchImpl = async (url, options) => {
    forwarded = {url, options};
    return new Response("ok", {status: 200});
  };
  const request = new Request("https://gateway.example/telegram?bot=mortal&key=" + KEY, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({update_id: 42})
  });
  const response = await handleRequest(request, {APPS_SCRIPT_URL, MORTAL_WEBHOOK_KEY: KEY}, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.equal(new URL(forwarded.url).searchParams.get("bot"), "mortal");
  assert.equal(forwarded.options.method, "POST");
  assert.equal(forwarded.options.redirect, "follow");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(forwarded.options.body)), {update_id: 42});
});

test("Cloudflare gateway rejects invalid routes and same-length wrong keys before forwarding", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; };
  const invalidBot = new Request("https://gateway.example/telegram?bot=devil&key=" + KEY, {method: "POST", body: "{}"});
  const shortKey = new Request("https://gateway.example/telegram?bot=angel&key=short", {method: "POST", body: "{}"});
  const wrongKey = new Request("https://gateway.example/telegram?bot=angel&key=" + "b".repeat(64), {method: "POST", body: "{}"});
  const env = {APPS_SCRIPT_URL, ANGEL_WEBHOOK_KEY: KEY};
  assert.equal((await handleRequest(invalidBot, env, fetchImpl)).status, 403);
  assert.equal((await handleRequest(shortKey, env, fetchImpl)).status, 403);
  assert.equal((await handleRequest(wrongKey, env, fetchImpl)).status, 403);
  assert.equal(calls, 0);
});

test("Cloudflare gateway keeps upstream failures retryable", async () => {
  const request = new Request("https://gateway.example/telegram?bot=admin&key=" + KEY, {
    method: "POST",
    body: JSON.stringify({update_id: 7})
  });
  const response = await handleRequest(
    request,
    {APPS_SCRIPT_URL, ADMIN_WEBHOOK_KEY: KEY},
    async () => new Response("error", {status: 500})
  );
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "upstream unavailable");
});
