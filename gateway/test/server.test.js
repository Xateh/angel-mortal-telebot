"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const {buildAppsScriptUrl, createServer} = require("../server");

async function withServer(options, callback) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function request(port, path, method = "GET", body = "") {
  return new Promise((resolve, reject) => {
    const req = http.request({host: "127.0.0.1", port, path, method}, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString("utf8")}));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("buildAppsScriptUrl preserves the deployment URL and adds authentication", () => {
  const result = new URL(buildAppsScriptUrl("https://script.google.com/macros/s/example/exec", "angel", "a".repeat(64)));
  assert.equal(result.origin + result.pathname, "https://script.google.com/macros/s/example/exec");
  assert.equal(result.searchParams.get("bot"), "angel");
  assert.equal(result.searchParams.get("key"), "a".repeat(64));
});

test("health check returns a direct 200", async () => {
  await withServer({}, async port => {
    assert.deepEqual(await request(port, "/healthz"), {status: 200, body: "ok"});
  });
});

test("valid Telegram updates are forwarded and acknowledged", async () => {
  let forwarded;
  const fetchImpl = async (url, options) => {
    forwarded = {url, options};
    return {ok: true, status: 200, text: async () => "ok"};
  };
  await withServer({
    appsScriptUrl: "https://script.google.com/macros/s/example/exec",
    fetchImpl,
    webhookKeys: {mortal: "b".repeat(64)}
  }, async port => {
    const result = await request(port, "/telegram?bot=mortal&key=" + "b".repeat(64), "POST", "{\"update_id\":42}");
    assert.deepEqual(result, {status: 200, body: "ok"});
  });
  assert.equal(new URL(forwarded.url).searchParams.get("bot"), "mortal");
  assert.equal(forwarded.options.method, "POST");
  assert.equal(forwarded.options.redirect, "follow");
  assert.equal(forwarded.options.body.toString("utf8"), "{\"update_id\":42}");
});

test("invalid routes and same-length wrong keys are rejected before forwarding", async () => {
  let calls = 0;
  await withServer({
    appsScriptUrl: "https://example.invalid",
    fetchImpl: async () => { calls += 1; },
    webhookKeys: {angel: "a".repeat(64)}
  }, async port => {
    assert.equal((await request(port, "/telegram?bot=devil&key=" + "c".repeat(64), "POST", "{}")).status, 403);
    assert.equal((await request(port, "/telegram?bot=angel&key=short", "POST", "{}")).status, 403);
    assert.equal((await request(port, "/telegram?bot=angel&key=" + "b".repeat(64), "POST", "{}")).status, 403);
  });
  assert.equal(calls, 0);
});

test("upstream failures remain retryable", async () => {
  await withServer({
    appsScriptUrl: "https://example.invalid",
    fetchImpl: async () => ({ok: false, status: 500, text: async () => "error"}),
    webhookKeys: {admin: "d".repeat(64)}
  }, async port => {
    assert.deepEqual(
      await request(port, "/telegram?bot=admin&key=" + "d".repeat(64), "POST", "{\"update_id\":7}"),
      {status: 503, body: "upstream unavailable"}
    );
  });
});
