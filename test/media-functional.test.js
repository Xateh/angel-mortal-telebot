"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const {createCoreFixture} = require("./helpers/core-fixture");
function transfer(options = {}) {
  const h = createCoreFixture(), calls = [], bytes = [0, 1, 127, 255];
  h.properties.set("MORTAL_BOT_TOKEN", "source-fixture"); h.properties.set("ANGEL_BOT_TOKEN", "target-fixture");
  const blob = {name:"", getBytes: () => options.actualSize === undefined ? bytes : {length:options.actualSize}, setName(name) { this.name=name; return this; }};
  h.context.UrlFetchApp.fetch = (url, request) => {
    calls.push({url, request});
    if (url.endsWith("/getFile")) return {getResponseCode:()=>200, getContentText:()=>JSON.stringify({ok:true,result:{file_path:"fixture/path.bin",file_size:options.reportedSize || bytes.length}})};
    if (url.includes("/file/")) {
      if (options.downloadError) throw new Error("synthetic download failure");
      return {getResponseCode:()=>options.downloadStatus || 200, getBlob:()=>blob};
    }
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({ok:true,result:{message_id:7}})};
  };
  return {...h,calls,blob,bytes};
}
const cases = [
  ["photo", {photo:[{file_id:"small"},{file_id:"chosen"}]}, "sendPhoto", "photo", "photo.jpg"],
  ["static sticker", {sticker:{file_id:"chosen"}}, "sendSticker", "sticker", "sticker.webp"],
  ["animated sticker", {sticker:{file_id:"chosen",is_animated:true}}, "sendSticker", "sticker", "sticker.tgs"],
  ["video sticker", {sticker:{file_id:"chosen",is_video:true}}, "sendSticker", "sticker", "sticker.webm"],
  ["video", {video:{file_id:"chosen",file_name:"movie.mp4"}}, "sendVideo", "video", "movie.mp4"],
  ["voice", {voice:{file_id:"chosen"}}, "sendVoice", "voice", "voice.ogg"],
  ["document", {document:{file_id:"chosen",file_name:"fixture.pdf"}}, "sendDocument", "document", "fixture.pdf"],
  ["animation", {animation:{file_id:"chosen"}}, "sendAnimation", "animation", "animation.mp4"],
  ["video note", {video_note:{file_id:"chosen"}}, "sendVideoNote", "video_note", "video-note.mp4"]
];
for (const [label,message,method,field,name] of cases) test(label + " downloads from source and uploads identical bytes to target", () => {
  const h=transfer();
  const caption = /sticker|note/.test(label) ? "" : "Synthetic caption 🙂\nKeep all content";
  h.context.relayTelegramMessage_("mortal","angel","20002",{...message,caption,from:{id:10001},forward_origin:{type:"user"}});
  assert.equal(h.calls.length,3);
  assert.equal(h.calls[0].url,"https://api.telegram.org/botsource-fixture/getFile");
  assert.equal(h.calls[0].request.payload.file_id,"chosen");
  assert.equal(h.calls[1].url,"https://api.telegram.org/file/botsource-fixture/fixture/path.bin");
  assert.equal(h.calls[2].url,"https://api.telegram.org/bottarget-fixture/"+method);
  const p=h.calls[2].request.payload;
  assert.equal(p.chat_id,"20002"); assert.equal(p[field],h.blob); assert.deepEqual(p[field].getBytes(),h.bytes); assert.equal(h.blob.name,name);
  assert.equal(p.caption || "",caption);
  assert.deepEqual(Object.keys(p).sort(), ["chat_id",field,...(caption?["caption"]:[])].sort());
});
for (const [label,options,pattern,calls] of [
  ["reported oversize",{reportedSize:20*1024*1024+1},/too large/,1],
  ["actual oversize",{actualSize:20*1024*1024+1},/too large/,2],
  ["download HTTP error",{downloadStatus:503},/download failed/,2],
  ["download exception",{downloadError:true},/download failure/,2]
]) test(label + " sends no target upload", () => {
  const h=transfer(options); assert.throws(()=>h.context.relayTelegramMessage_("mortal","angel","20002",{document:{file_id:"chosen"}}),pattern);
  assert.equal(h.calls.length,calls); assert.ok(h.calls.every(c=>!c.url.includes("target-fixture")));
});
test("exact actual and reported media boundary is accepted",()=>{
  const h=transfer({reportedSize:20*1024*1024,actualSize:20*1024*1024});
  h.context.relayTelegramMessage_("mortal","angel","20002",{document:{file_id:"chosen"}}); assert.equal(h.calls.length,3);
});
test("unsupported content makes no network request",()=>{
  const h=transfer(); assert.throws(()=>h.context.relayTelegramMessage_("mortal","angel","20002",{location:{latitude:0,longitude:0}}),/Unsupported/); assert.equal(h.calls.length,0);
});
for (const [status,body,outcome,attempts] of [[400,"not JSON","rejected",1],[503,"not JSON","unknown",3],[503,'{"ok":false}',"unknown",3],[400,'{"ok":false}',"rejected",1]]) test("API response " + status + " " + body + " classifies exhausted delivery",()=>{
  const h=transfer(); let count=0; const sleeps=[];
  h.context.Utilities.sleep=ms=>sleeps.push(ms);
  h.context.UrlFetchApp.fetch=()=>{count++;return {getResponseCode:()=>status,getContentText:()=>body};};
  assert.throws(()=>h.context.telegramSendMessage_("mortal","10001","fixture"),e=>e.deliveryStatus===outcome);
  assert.equal(count,attempts); assert.deepEqual(sleeps,attempts===3?[500,1000]:[]);
});
test("webhook setup, inspect, reset and removal affect configured bots only",()=>{
  const h=transfer(); h.properties.set("WEBHOOK_GATEWAY_URL","https://gateway.example/telegram");
  const calls=[]; h.context.console={log(){}};
  h.context.telegramApi_=(bot,method,payload)=>{calls.push({bot,method,payload});return method==="getMe"?{username:bot+"Fixture"}:method==="getWebhookInfo"?{url:"https://example.invalid",pending_update_count:2,last_error_date:1}:true;};
  h.context.setupWebhooks();
  assert.deepEqual(calls.map(c=>c.bot+":"+c.method),["angel:getMe","angel:setWebhook","angel:getWebhookInfo","mortal:getMe","mortal:setWebhook","mortal:getWebhookInfo"]);
  for(const c of calls.filter(c=>c.method==="setWebhook")) { const u=new URL(c.payload.url); assert.equal(u.searchParams.get("bot"),c.bot); assert.equal(u.searchParams.get("key"),h.properties.get(c.bot.toUpperCase()+"_WEBHOOK_KEY")); assert.equal(c.payload.drop_pending_updates,false); assert.equal(c.payload.allowed_updates,'["message"]'); }
  assert.equal(h.context.inspectWebhookStatus().length,2);
  calls.length=0; h.context.resetWebhooksAndDropPendingUpdates(); assert.deepEqual(calls.slice(0,2).map(c=>c.method),["deleteWebhook","deleteWebhook"]);
  calls.length=0; h.context.removeWebhooks(); assert.equal(calls.length,2); assert.ok(calls.every(c=>c.method==="deleteWebhook"&&c.payload.drop_pending_updates));
});
