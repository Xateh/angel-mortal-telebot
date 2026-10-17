# Angel/Mortal Telegram Relay

This is a reusable source archive, not an archive of participant records. It contains the signup Form builder, empty Google Sheets reference template, relay, and optional alphabetical guessing-choice setup. Recreate each event with new private resources and credentials. Event shutdown is covered in [section 17](#17-close-an-event-without-deleting-its-records).

This repository builds an anonymous two-bot relay backed by a Google Form and Google Sheet. A giver uses the **Mortal bot** to message their assigned mortal. The mortal receives and replies through the **Angel bot**. Relay messages carry the bot's sender identity, not the giver's Telegram profile or forwarded-from identity, and the bot does not disclose the giver's Angel/Devil role. This is transport anonymity, not content anonymization: names, handles, faces, voices, filenames or document metadata included by a participant can still identify them.

There is no registration code. Each participant is identified by the numeric Telegram ID submitted in the Form. Every incoming message reloads the current Form data and current `Mortal` mapping, so a remap takes effect on the next message. Invalid, stale, incomplete, or ambiguous mappings fail closed; they never fall back to an earlier recipient.

Reading a mapping and sending to Telegram are not one atomic transaction. An edit after route validation cannot reliably cancel a message already in flight, especially during media transfer or retries. Coordinate a quiet period for mapping changes and require valid completed mappings before participants resume.

Required Form errors on either person in the current pair also block relays, `/start` registration/partner notices, and mortal introductions until corrected. Devil-tolerance fit warnings remain advisory; unrelated unfinished pairs do not block a valid pair.

The documented default uses current free service tiers. It needs no paid plan, payment card, owned domain, or Google Cloud billing project. Provider availability, policies, pricing, and quotas can change. This setup is intended for a low-volume event, not guaranteed permanent free hosting.

## 1. Architecture and operating rules

Telegram sends each bot webhook to a small Cloudflare Worker. The Worker checks a per-bot secret, validates the update, and forwards it to an Apps Script web app. Apps Script reads the linked response Sheet, validates the current pairing, then calls Telegram. The Worker stores only its Apps Script URL and webhook keys. Apps Script stores bot credentials and configuration in Script Properties.

The response Sheet contains `Angel Mortal Roster` with 21 columns. `Mortal` (column G) is the organizer's only manual pairing input. `Angel Bot Started At` (S) and `Mortal Bot Started At` (T) are bot-written state. Every other participant or pairing column has one spill formula in row 2. The roster needs no form-submit or edit trigger. The optional guessing Form has a separate, opt-in hourly refresh timer described in section 16; it does not update roster rows.

Keep `Form Responses 1` and roster rows append-only. Do not sort, delete, or insert underlying participant rows: doing so can misalign G, S, and T. Use filter views for temporary sorting. The `Mortal` dropdown, `Pairing Status`, issue text, and traffic-light formatting update from current responses and mappings. Google Sheets expands within its normal row capacity; if a spill reaches the last row, add rows with Sheets' native **Add rows** command and clear anything blocking the spill.

Mappings are read afresh; registration is intentionally persistent. A private Script Property binds each PersonID/bot registration to the numeric Telegram ID that sent `/start`. Changing that ID leaves any old S/T timestamp as history, but it no longer grants readiness to the new account: the corrected account must send `/start` to each bot again. Old installations without bindings also require fresh `/start`; do not bulk-copy bindings from timestamps. This repository update does not migrate an existing production project.

## 2. Prerequisites

- A consumer Google account that can deploy an Apps Script web app for anonymous access. A Google Workspace administrator can block this option.
- A free Cloudflare account. The default `workers.dev` address needs no domain; Cloudflare advertises free signup without a credit card.
- A free Telegram account with access to BotFather.
- Git, Python 3, and maintained Node.js LTS 22 or newer. Node 20 is end-of-life and is not supported by this package.

Do not continue if Apps Script deployment does not offer anonymous `Anyone` access. Telegram cannot sign into a restricted web app.

## 3. Clone and verify before creating resources

```powershell
git clone <PRIVATE_REPOSITORY_URL>
cd angel-mortal-telegram-relay
npm ci
npm test
npm run build
npm --prefix gateway ci
npm --prefix gateway test
npm --prefix gateway audit
python -m unittest test.test_repository_safety test.test_workbook_artifact
python scripts/verify_repository.py
```

All commands must pass. `npm test` includes core relay, delivery regressions, signup schema, and guessing Form tests. `npm run build` creates ignored `dist/Code.gs` from the source files and `config/form-schema.json`. These local mocks and structural checks do not establish native Google Sheets recalculation or live Telegram delivery; the isolated checklist below is a separate verification step.

`templates/angel-mortal-empty.xlsx` is a participant-free reference template for Google Sheets, not an Excel-compatible calculation model. Its formulas use Google Sheets functions. The reproducible setup below generates the native Form and roster directly from the source scripts; do not substitute an Excel recalculation/export that replaces formulas or saves participant/error caches. Verify formula results in an isolated Google Sheet before adopting a revised formula build.

Before a release scan, create ignored `.private-denylist` containing one private identifier per line. Include your real handles, IDs, private URLs, and resource names; do not publish example entries. Then run:

```powershell
$env:AM_PRIVATE_DENYLIST = (Resolve-Path .private-denylist)
$env:AM_RELEASE_MODE = "1"
python scripts/verify_repository.py
```

Release mode rejects a missing, empty, unreadable, or tracked denylist.

Run history checks in a complete (non-shallow) checkout with all relevant remote branches and tags fetched. The scanner checks tracked files and objects reachable from local Git refs; it cannot inspect unfetched or unreachable history. A passing pattern scan without the private denylist is not strict release clearance, and even a passing denylist scan only covers the identifiers supplied. Review workbook hidden content and metadata as well before public release.

## 4. Create the empty Google Form and Sheet

1. Open [Apps Script](https://script.google.com/) and create a **standalone** project.
2. In **Project Settings**, enable **Show `appsscript.json` manifest file in editor**.
3. Replace the default `Code.gs` content with all of the generated `dist/Code.gs` content.
4. Replace the manifest with this repository's `appsscript.json` content. Save both files.
5. Select `createEmptyAngelMortalStack` and run it once. Review the requested Forms, Sheets, external-request, and trigger-management scopes, then authorize only if they match the manifest. The trigger scope supports the optional guessing timer; setup itself installs no timer.
6. The function creates a published Form, links it to a new response spreadsheet, creates `Angel Mortal Roster`, and stores the new spreadsheet IDs in Script Properties. It returns the new Form and Sheet identifiers and URLs. Keep them private. If the editor does not display the return value, open the two newly created files by title from your own Google Drive.
7. Run `setupProject` once. This reapplies the roster setup and creates missing `ANGEL_WEBHOOK_KEY`, `MORTAL_WEBHOOK_KEY`, and `ADMIN_WEBHOOK_KEY` Script Properties.

If `createEmptyAngelMortalStack` fails, do not immediately run it again: it may already have created a partial Form and spreadsheet. Inspect the execution error and identify only the files created by that failed run in your own Drive. Move those partial test files to Trash before retrying with the corrected build. Never delete an existing event's files. A successful run does not need to be repeated.

Do not paste any returned URL or ID into this repository, an issue, terminal history, or shared log.

### Verify the Form before sharing it

Open the generated Form editor and verify all of these separately:

- the Form is **Published** and **Accepting responses**;
- responder access is **Anyone with the link**;
- email collection is off;
- the one-response-per-user limit is off;
- choosing Devil routes to the Devil-details section; choosing Angel skips it; and
- the numeric Telegram ID question rejects non-numeric values.

Publication and responder access are separate Google Forms controls. Publishing alone does not grant link access. Open the responder link in a signed-out/private browser window and confirm it loads before inviting anyone. The Form and roster must initially contain zero responses and zero participants.

## 5. Create Telegram bots

Using BotFather, create exactly two participant bots:

- an Angel bot, through which mortals receive and reply; and
- a Mortal bot, through which givers send to their mortals.

Keep both tokens private. Do not put tokens in repository files, shell commands, notes, screenshots, or messages. An Admin bot is optional and is not a participant bot.

## 6. Configure Apps Script privately

In Apps Script, open **Project Settings > Script properties**. Set these values in the UI, not in source files.

| Property | Source | Required |
| --- | --- | --- |
| `SPREADSHEET_ID` | created by `createEmptyAngelMortalStack()` | automatic |
| `FORM_RESPONSES_SPREADSHEET_ID` | created by `createEmptyAngelMortalStack()` | automatic |
| `FORM_RESPONSES_SHEET_NAME` | created as `Form Responses 1` | automatic |
| `ANGEL_WEBHOOK_KEY` | created by `setupProject()` | automatic; keep private |
| `MORTAL_WEBHOOK_KEY` | created by `setupProject()` | automatic; keep private |
| `ADMIN_WEBHOOK_KEY` | created by `setupProject()` | automatic; used only with Admin bot |
| `ANGEL_BOT_TOKEN` | BotFather | required |
| `MORTAL_BOT_TOKEN` | BotFather | required |
| `SUPPORT_HANDLES` | comma-separated organizer handles | recommended; defaults to `@organiser` |
| `WEBHOOK_GATEWAY_URL` | Worker URL ending in `/telegram` | set after Worker deployment |
| `ANGEL_BOT_USERNAME` | discovered by `setupWebhooks()` | optional/automatic |
| `MORTAL_BOT_USERNAME` | discovered by `setupWebhooks()` | optional/automatic |
| `ADMIN_BOT_TOKEN` | optional Admin BotFather token | optional |
| `ADMIN_TELEGRAM_ID` | organizer's independently verified numeric Telegram ID, entered manually | required only with Admin bot |
| `TEST_MODE_ENABLED` | literal `true` enables isolated loopback | optional, temporary |
| `TEST_TELEGRAM_ID` | one controlled numeric Telegram ID | optional, temporary |
| `TEST_TELEGRAM_NAME` | controlled tester display name | optional, temporary |

`SUPPORT_HANDLES` may contain one or more handles separated by commas. Participant failure notices use this setting; no real organizer identity belongs in source.

For the optional Admin bot, independently verify the organizer's numeric Telegram ID and enter it as `ADMIN_TELEGRAM_ID` in Script Properties before installing webhooks. Never select an administrator from the most recent `/start` message. The retained `captureAdminTelegramId()` function only validates the manually entered ID; it does not read messages, change the ID, or remove webhooks. Existing IDs are preserved, so verify any ID previously assigned by an older version. The organizer must also open the Admin bot and send `/start` to receive replies.

## 7. Deploy Apps Script

1. Choose **Deploy > New deployment > Web app**.
2. Set **Execute as** to yourself, the deploying user.
3. Set access to anonymous **Anyone**. Signed-in-only `Anyone` is insufficient.
4. Deploy and privately copy the versioned URL ending in `/exec`.

Do not use `/dev`: it runs current saved code and is editor-only. When updating code, build and paste the new bundle, create a new Apps Script version, then edit the existing deployment to use that version. This preserves the `/exec` URL. Deployments remain owned by the deploying account; transferring a source file does not transfer deployment ownership.

The query names `c` and `sid` are reserved by Apps Script. This project uses only `bot` and `key`.

## 8. Deploy the Cloudflare Worker

Cloudflare deploys to an existing Worker when the name already exists. Choose a new, isolated Worker name, check **Workers & Pages** in the Cloudflare dashboard, and confirm the exact name does not already exist. Stop and choose another name if it does. Keep the selected name in a private local note for cleanup, then use the same `$workerName` for every command below:

```powershell
cd gateway
npx wrangler login
$workerName = Read-Host "Enter the verified-new isolated Worker name"
npx wrangler deploy --name $workerName
npx wrangler secret put APPS_SCRIPT_URL --name $workerName
npx wrangler secret put ANGEL_WEBHOOK_KEY --name $workerName
npx wrangler secret put MORTAL_WEBHOOK_KEY --name $workerName
```

Enter each value only at Wrangler's private interactive prompt. Copy the webhook-key values from Apps Script Script Properties. If using the optional Admin bot, also run:

```powershell
npx wrangler secret put ADMIN_WEBHOOK_KEY --name $workerName
```

The initial Worker deployment is harmless because no Telegram webhook is installed yet. Each `wrangler secret put` creates and immediately deploys a new Worker version. The repository deliberately has no plaintext Wrangler `vars`. Never omit `--name $workerName`: an unscoped deployment could target the fixed example name in `wrangler.jsonc` and update an unrelated Worker.

Wrangler prints a `workers.dev` address. Verify its health endpoint in a browser or with:

```powershell
Invoke-RestMethod https://<WORKER_HOST>/healthz
```

Expected response: `ok`. Keep the host private until testing is complete.

## 9. Connect the stack and install webhooks

1. In Apps Script Script Properties, set `WEBHOOK_GATEWAY_URL` to the Worker address ending in `/telegram`.
2. Run `validateConfiguration`. It must report configuration present and show a readable participant-sheet summary.
3. Recheck that Worker secrets and Apps Script webhook keys have the same values.
4. Run `setupWebhooks`. Only now does Telegram begin sending updates to the stack. The function also records bot usernames.
5. Run `inspectWebhookStatus`. For each enabled bot, require `installed: true`, no recent error, and a stable or empty pending-update count.

The code requests `max_connections=10` per bot. The normal two-bot setup can therefore offer up to 20 webhook connections, below Apps Script's 30 simultaneous executions per user. This is capacity guidance, not a guaranteed one-connection-to-one-execution mapping. An optional Admin bot and every other script owned by the same Google user share the 30-execution ceiling. If bursts create webhook backlog or concurrent-execution errors, lower `TELEGRAM_WEBHOOK_MAX_CONNECTIONS`, rebuild, deploy a new Apps Script version, then reinstall the isolated webhooks.

## 10. Add controlled test participants and pair them

Use synthetic names and only Telegram accounts you control.

1. Submit two controlled Form responses, including one Angel choice and one Devil choice. Each response needs a unique numeric Telegram ID. Two accounts are enough for reciprocal relay and invalid/restore tests; a third controlled account is optional for a second valid one-to-one derangement.
2. Wait for the spill formulas to populate one roster row per response. No trigger or manual refresh is needed.
3. In column G, choose each participant's mortal from the native dropdown. Build an exact one-to-one derangement: everyone selects one different person, everyone appears exactly once as a mortal, and no selection is blank, stale, duplicated, or self-directed.
4. Confirm every `Pairing Status` is `Ready`. Amber Devil-tolerance gaps are advisory; red structural/form issues must be fixed.
5. Choose one controlled giver and mortal for the recipient-not-started check. Have the giver start the Mortal bot, but deliberately leave that mortal's Angel bot unopened. Start the other required bots. After verifying the one expected failure, have that mortal start the Angel bot; then have every controlled participant open both bots and send `/start` before the remaining relay tests.

## 11. Controlled verification checklist

Use only the isolated stack and controlled accounts. Never message production participants.

- Before the mortal opens the Angel bot, sending from their giver's Mortal bot produces one recipient-not-started notice and no target message. Then have the mortal open the Angel bot and finish `/start` on both bots for every account.
- `/start` on both bots shows the correct role/direction and bot readiness.
- The giver's Mortal-bot introduction identifies the mortal and approved profile details.
- Text sent to the Mortal bot arrives through the Angel bot; the reply sent to the Angel bot arrives through the Mortal bot.
- Telegram shows the receiving bot as sender, without a forwarded-from link to the giver or an automatically disclosed Angel/Devil role. Use anonymous synthetic content; the relay does not remove identities embedded in the message or file.
- Photo, sticker, video, voice, document, animation, and video-note relay work by cross-bot download/re-upload.
- Temporarily blanking or corrupting one isolated `Mortal` selection blocks delivery; restoring the dropdown selection makes the next message use the restored route.
- If three controlled accounts are available, replace the whole three-person derangement with the other valid three-person derangement between two messages. Only the second message goes to the giver's new current mortal. Require every row to return to `Ready` before sending it. With two accounts, record this live remapping case as not exercised; the automated suite covers current-route changes.
- A duplicate controlled Telegram ID blocks both ambiguous senders and delivery to that ID. `/start` on an ambiguous route must not save bot-start state or notify a partner. Resolving the duplicate makes the next message use the current unique route. Test this last on a disposable stack, or clear the isolated synthetic data afterward.
- Temporarily replacing only the target bot token with a non-secret invalid value makes Telegram reject delivery immediately (normally `401` or `404`); the source bot attempts one support notice. Restore the real token immediately. The automated suite separately verifies all three attempts for retryable `429` and `5xx` failures.
- Adding another synthetic Form response expands formula columns without a trigger; blank rows remain blank.
- Worker `/healthz` returns `200`; a `/telegram` request without a valid key returns `403`; an upstream failure returns retryable `503`.
- `inspectWebhookStatus` remains installed with no growing backlog or recent Telegram delivery error.

Automated tests cover `retry_after`, exponential retry, duplicate updates, request authentication, size checks, and failure paths. Live failure notices are best-effort: if Telegram, Apps Script URL Fetch, or Apps Script itself is unavailable, the same failed service may prevent the notice from reaching the sender.

Telegram's [`retry_after`](https://core.telegram.org/bots/api#responseparameters) is a minimum wait, never shortened. Waits of up to 10 seconds are honored in full while retry attempts remain. For longer waits or an exhausted attempt budget, that API call stops and caches a per-bot/chat cooldown. A source-channel notice may be attempted only if that source channel is not itself cooling down. If Telegram blocks that same channel, immediate failure feedback cannot be guaranteed. The message is not queued: wait before sending again and the bot reads the current mapping.

Text and long introductions are split without dropping Unicode characters. Long captions continue as separate messages; failure after some parts arrive is reported as partial delivery. A timeout or server error can mean Telegram accepted the message but the reply was lost: feedback says delivery is unconfirmed, not definitely unsent. Check before resending. Retries and cache-based duplicate suppression are best-effort, not exactly-once delivery; cache eviction or ambiguous network outcomes can still produce duplicates. These caches are not a durable queue.

## 12. Troubleshooting

Public Apps Script health errors are deliberately generic and do not include participant names or private diagnostic details. For organizer-only details, inspect `Pairing Issues` in the private roster or run `validateConfiguration` inside Apps Script.

| Symptom | Likely cause | Action |
| --- | --- | --- |
| “I could not match your Telegram ID…” | ID absent, mistyped, or duplicated in Form responses | Compare the sender's numeric Telegram ID with exactly one current response; resolve duplicates without reordering rows. |
| “participant list” or Sheet-read failure | Wrong spreadsheet properties, deleted/renamed tab, missing owner access, or Google quota/outage | Restore the generated IDs and `Form Responses 1`; verify the deploying owner can open the Sheet; inspect Apps Script executions. |
| “pairing … being updated” / message not sent | Blank, self, duplicate, stale, or inconsistent `Mortal` selection | Use current dropdown keys; require every row `Ready`; retry after formulas settle. |
| “has not opened the receiving bot” | Target has not sent `/start` to the bot that receives this direction, or their Telegram ID was corrected | Mortal starts Angel bot; giver starts Mortal bot; then retry. A historic S/T timestamp alone is insufficient. |
| “I could not send that message” | Telegram 429/5xx, bad token, timeout, unsupported media, or file limit | Inspect Apps Script execution; obey `retry_after`; restore token; retry once with smaller supported media. |
| Delivery or processing “could not be confirmed” | Timeout, server failure, or top-level failure with uncertain outcome | Check whether it arrived before resending; inspect Apps Script execution and `LAST_WEBHOOK_STATUS`. |
| Worker `403` | Missing/wrong bot or webhook key | Match Apps Script and Worker key values, then run `setupWebhooks` again. Never print the key. |
| Worker `413` | Webhook body exceeds the 1 MiB gateway cap | Inspect the caller; normal Telegram media updates contain metadata, not file bytes. Do not raise the cap without review. |
| Worker `503` | Missing Worker secret, Apps Script rejection, timeout, deployment access, or quota failure | Check secret names, `/exec` access, Worker logs, Apps Script executions, and webhook status. The Worker stops waiting after 55 seconds. |
| `/dev` works but Worker fails | `/dev` is editor-only, or deployment still points to an old version | Use anonymous versioned `/exec`; create a version and edit the existing deployment. |
| Form says access is needed or is closed | Form unpublished, not accepting responses, or responder access restricted | Publish, enable responses, grant `Anyone with the link`, and test signed out. |
| Formula shows `#REF!` | Spill blocked or Sheet has no remaining row capacity | Clear cells below the row-2 spill formula or add native Sheet rows. Do not copy formulas down. |
| Telegram updates wait or repeat | Webhook error/backlog or Apps Script concurrency pressure | Run `inspectWebhookStatus`; inspect pending count and last error; reduce webhook connections only if evidence supports it. |

## 13. Service limits and call amplification

Checked **14 September 2026**. These are provider limits, not guaranteed relay-message counts, and can change without notice.

### Google Apps Script consumer account

- 20,000 URL Fetch calls/day/user; 50,000 Properties reads/writes/day/user; 250 spreadsheets created/day.
- Daily quotas reset 24 hours after the first request.
- 6 minutes per execution; 30 simultaneous executions/user and 1,000/script.
- 50 MB URL Fetch response and POST per call.
- 9 KB per property value and 500 KB per property store.
- Google's Apps Script quota page lists no separate daily `SpreadsheetApp` or `FormApp` I/O quota; associated Google-product quotas still apply.

Source: [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

Normal text relay commonly uses one Apps Script URL Fetch send. Media commonly uses `getFile`, a download, and a cross-bot upload/send. Retries, `/start` responses, partner notices, and failure feedback add calls. Apps Script allows six minutes, but the Worker's 55-second upstream timeout is this synchronous gateway's practical ceiling.

Current-account readiness also reads private Script Properties; each successful first start writes a binding. Long messages/captions can produce multiple outgoing calls. The optional guessing timer adds Form/Sheet reads even when no choices change. These share the owner's quotas with other scripts, so the URL Fetch allowance alone is not a reliable message-capacity estimate.

### Cloudflare Workers Free

- 100,000 dynamic requests/day/account, shared across the account and reset at 00:00 UTC.
- 10 ms CPU/request; waiting for network `fetch()` does not count as CPU time.
- 50 subrequests/request. This gateway normally makes one upstream `fetch()` call; followed redirects count as additional subrequests.
- A free `workers.dev` deployment needs no owned domain; Cloudflare advertises free signup without a credit card.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/), [product](https://www.cloudflare.com/products/workers/), and [getting started](https://developers.cloudflare.com/workers/get-started/guide/).

### Telegram Bot API

- Avoid more than 1 outgoing message/second in one private chat; groups allow 20/minute; free bulk delivery is about 30/second per bot. These are operational limits, not exact published window algorithms. Honor 429 `retry_after`.
- `sendMessage` accepts 1–4,096 characters; media captions accept 0–1,024.
- Hosted `getFile` downloads are limited to 20 MB. Multipart `sendPhoto` is limited to 10 MB; several other upload methods allow 50 MB.
- Telegram `file_id` values are bot-specific. This two-bot relay must download and re-upload, making its effective ceiling 20 MB, or 10 MB for photos.
- Telegram webhook concurrency accepts 1–100; this repository requests 10 for each enabled bot.

Sources: [rate guidance](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this), [`retry_after`](https://core.telegram.org/bots/api#responseparameters), [`getFile`](https://core.telegram.org/bots/api#getfile), [`sendPhoto`](https://core.telegram.org/bots/api#sendphoto), [`sendMessage`](https://core.telegram.org/bots/api#sendmessage), [sending files](https://core.telegram.org/bots/api#sending-files), and [`setWebhook`](https://core.telegram.org/bots/api#setwebhook).

## 14. Cleanup after isolated testing

1. Before deleting or mutating any resource, update the ignored `.private-denylist` with every non-secret private value created or used during verification: Form, Sheet, Apps Script deployment, and Worker names, IDs, and URLs; bot usernames; account handles; and controlled Telegram IDs. This is the last reliable point to copy those values from their authoritative sources. Do not copy bot tokens or webhook keys into the denylist; if either may have leaked, revoke or rotate it.
2. While the isolated bot tokens still work, run Apps Script `removeWebhooks`. This cleanup operation deletes each webhook with `drop_pending_updates=true`, so any queued isolated updates are discarded instead of being delivered later. Confirm `inspectWebhookStatus` reports no installed URLs and zero or falling pending updates.
3. Run `disableLiveTestMode`; manually confirm `TEST_MODE_ENABLED`, `TEST_TELEGRAM_ID`, and `TEST_TELEGRAM_NAME` are absent.
4. From `gateway/`, re-enter the privately recorded Worker name. Verify in the Cloudflare dashboard that it is the isolated Worker created in section 8; stop if uncertain.

```powershell
$workerName = Read-Host "Re-enter the exact isolated Worker name from deployment"
```

Choose one cleanup path. Deleting the isolated Worker is simplest:

```powershell
npx wrangler delete --name $workerName
```

If retaining that isolated Worker, delete its secrets instead:

```powershell
npx wrangler secret delete APPS_SCRIPT_URL --name $workerName
npx wrangler secret delete ANGEL_WEBHOOK_KEY --name $workerName
npx wrangler secret delete MORTAL_WEBHOOK_KEY --name $workerName
npx wrangler secret delete ADMIN_WEBHOOK_KEY --name $workerName
```

Skip the Admin-secret command if it was never set. Each `secret delete` creates and deploys a new Worker version.

5. Delete the isolated Form and Sheet, or delete all Form responses and clear synthetic rows only in that isolated stack. If retaining the empty stack, clear G/S/T and confirm the roster returns to zero participants.
6. If retaining the isolated Apps Script project, delete its isolated Script Properties: spreadsheet IDs and sheet name; bot tokens and usernames; webhook keys; Worker URL; support handles; Admin fields; all test-mode fields; and its `PARTICIPANT_START_` account bindings. Remove optional guessing triggers before deleting their six `GUESS_` properties. If the project is no longer needed, delete the entire isolated Apps Script project instead.
7. From the repository root, rerun the release-mode repository and history scan while the complete ignored `.private-denylist` is still present. Confirm it passes and that no production resource or participant was accessed or changed.
8. Only after that final release scan, delete `.private-denylist` and any local `.env`, `.dev.vars`, `.clasp.json`, `.wrangler`, logs, exports, snapshots, or private verification files. They are ignored but still sensitive.

## 15. Security and rotation

Store Apps Script bot tokens and webhook keys only in Script Properties. Store Worker values only with encrypted Wrangler secrets. Keep participant data only in the private Form response Sheet. Repository `.env`, `.dev.vars`, `.clasp.json`, `.wrangler`, logs, snapshots, exports, credentials, and private verification files are ignored.

If a bot token leaks, revoke it in BotFather, replace the Script Property, and reinstall that isolated webhook. To rotate a webhook key, first remove webhooks, replace the Apps Script key with a freshly generated value, update the matching Worker secret, then reinstall and inspect webhooks.

If any secret or private participant value is committed, deletion from the latest file is insufficient. Revoke or rotate it, remove it from every reachable Git history reference, rerun release-mode scanning, and only then continue.

Official deployment references: [Apps Script web apps](https://developers.google.com/apps-script/guides/web), [Apps Script deployments](https://developers.google.com/apps-script/concepts/deployments), [Forms publication changes](https://developers.google.com/workspace/forms/api/guides/api-changes-to-google-forms), [publishing Forms](https://developers.google.com/workspace/forms/api/guides/publish-form), [Wrangler Worker commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/), [Wrangler secrets](https://developers.cloudflare.com/workers/configuration/secrets/), and [Wrangler v4 migration](https://developers.cloudflare.com/workers/wrangler/migration/update-v3-to-v4/).

## 16. Optional conclusion guessing Form

This is a separate organizer-run setup. It does not replace the signup Form, change bot routing, create an answer key, grade guesses, reveal identities, or send messages. The repository contains no participant options or answers.

### Create and populate

1. Use a new isolated stack first. Finish the 21-column roster and require every participant to be `Ready`; no unresolved pairing or required Form errors may remain.
2. Run `createGuessingForm` once from the Apps Script editor. It creates a new unpublished, closed draft with a required participant question and separate required Angel/Devil guess dropdowns. An empty draft contains only non-person placeholders. It does not connect a response spreadsheet.
3. The function stores `GUESS_FORM_ID`, `GUESS_PERSON_ITEM_ID`, `GUESS_ANGEL_ITEM_ID`, `GUESS_DEVIL_ITEM_ID`, `GUESS_ANGEL_SECTION_ID`, and `GUESS_DEVIL_SECTION_ID` in private Script Properties. Never paste their values into this repository. Repeating setup reuses the configured Form; it does not rebuild it.
4. Run `refreshGuessingFormOptions`. A successful result reports whether choices changed and the three list counts. Refresh sorts copies by name using English, case-insensitive ordering, then room and exact PersonID; labels preserve the original `name — room` spelling. Roster rows are never sorted. Blank/duplicate IDs, ambiguous labels, unsupported modes and unresolved pairings stop the refresh before choice changes.
5. Check the draft in preview: selecting a participant goes to the section for the mode they receive. Candidate lists use the role each giver performs for their assigned mortal, not the giver's own requested mode. Both guess sections finish with Submit. An unused role displays `No candidates available` only in its unreachable section.
6. Choose the response destination and access/settings in the Form editor. Before sharing, separately verify email-collection mode, response editing, one-response-per-account, quiz/results visibility, publication, accepting responses, and responder access. The boolean email-collection API does not prove Google's exact verified-email mode. Publish only when the organizer approves; verify the intended signed-out or signed-in responder experience.

Creation failures may leave a partial draft. Inspect only the new files and saved guessing properties in your private Apps Script project; do not clear properties and rerun blindly. A missing/deleted/mistyped configured item stops refresh instead of silently creating a replacement. Keep the generated three questions and two section breaks in their original order, with Devil finishing at Submit; changed page layout or extra items stop refresh before any choice writes. Titles and response/access settings can be edited without recreating items.

### Refresh and preservation

Manual `refreshGuessingFormOptions` is the default. Repeating it with unchanged choices performs no choice writes. It addresses questions/sections by stored IDs and preserves responses, titles, settings, destination and publication. An unexpectedly empty roster stops refresh; it does not erase current options.

Refresh serializes this script's own runs with a lock. Google Forms updates are separate API calls, not a transaction: a mid-refresh failure attempts to restore the previous choices and reports whether restoration failed. It cannot lock human editors or submissions already in progress. Close responses while changing an event's roster/options, refresh, inspect every branch, then reopen only when appropriate. Do not change names/rooms once guessing has started without deciding how existing labels and answers will be reconciled.

### Optional hourly refresh

No timer is installed by signup setup, guessing creation, participant commands or webhook processing.

- To opt in, run `installGuessingFormRefreshTrigger` as the one designated organizer. It creates one hourly trigger for `refreshGuessingFormOptions`; repeated calls by the same owner do not add another.
- The manifest includes `https://www.googleapis.com/auth/script.scriptapp` for programmatic trigger management. Review that additional scope before authorizing the new build; authorizing the scope is distinct from installing a timer. No live authorization is implied by copying repository files.
- Triggers run under their creator's account and timing is approximate, not an immediate update on signup. Monitor that owner's Apps Script Executions and failure notices. Another owner can install another trigger; the script only lists/manages the current user's project triggers.
- Run `removeGuessingFormRefreshTrigger` as that owner before freezing or closing the event. It removes only this handler's triggers and preserves unrelated triggers. Each other owner must remove their own matching trigger.

Official API references: [unpublished Form creation](https://developers.google.com/apps-script/reference/forms/form-app#create(String,Boolean)), [choice navigation](https://developers.google.com/apps-script/reference/forms/choice), [hourly trigger](https://developers.google.com/apps-script/reference/script/clock-trigger-builder#everyHours(Integer)), and [trigger permissions and ownership](https://developers.google.com/apps-script/reference/script/script-app).

### Scoring and participant identity: separate decisions

Choice population is not scoring. A scoring system needs an explicitly frozen/versioned answer key, an agreed cutoff, and a rule for which valid submission counts. It must not recompute historical correctness from today's live mapping.

The inspected prototype's lookup-and-compare approach needs these guards before reuse:

| Case | Required treatment |
| --- | --- |
| Known valid guess equals frozen actual giver | Correct |
| Known valid guess differs from frozen actual giver | Incorrect |
| Blank guess and blank actual, missing lookup, stale label, ambiguous name, or unknown participant | Review, never accidental Correct |
| Multiple submissions with equal timestamps | Deterministic tie-breaker, such as a stable response ID or agreed source-row order |
| Mapping changed after the guess | Evaluate against the approved answer-key version/cutoff |
| Google account submits another participant's name | Verify ownership under the organizer's agreed policy; a dropdown selection is not authentication |

Verified email and one response per Google account do not establish which participant name belongs to that account. Response editing is also separate from a new submission. These identity and scoring policies are intentionally not implemented here. Hidden tabs are not an access-control boundary: keep any future answer key and results private, do not enable response summaries or automatic reveal, and do not export them into Git.

### Isolated verification and retirement

Run the automated suites from section 3, then (only with approval for a new isolated test) check alphabetical options, correct branches/candidate roles, repeated no-op refresh, settings/response preservation, and a controlled mid-write failure. Local mocks do not prove native concurrent-responder behavior.

When retiring the guessing Form, remove its optional timer first, close/unpublish it in the editor, and retain or delete its private responses under the organizer's policy. Never delete the signup Form or production Sheet as part of guessing cleanup. If deleting the isolated stack, also remove its six `GUESS_*` properties. Include all private guessing resource identifiers in the ignored release denylist before cleanup.

## 17. Close an event without deleting its records

Use this only when the organizer has approved ending the identified event. Unlike disposable test cleanup, this procedure preserves Form responses, mappings, guesses, Sheet formulas, bot identities, and source projects. Do not clear participant rows or replace deployed code with a newer repository build merely to shut down an older installation.

1. **Identify the exact targets privately.** Check the bot usernames, Apps Script project and deploying account, all active deployment IDs, and gateway Worker in their authenticated dashboards. Include the Admin bot only if this event uses one. Stop if a project or Worker is shared with unrelated work. Keep the shutdown record outside Git; record outcomes and timestamps, never tokens.
2. **Close intake separately.** In the signup and guessing Form editors, turn off accepting responses if the organizer is closing those forms too. Preserve their responses and destinations. Closing a Form or browser tab does not stop Telegram or Apps Script.
3. **Disconnect Telegram before removing credentials.** Inspect `removeWebhooks` in the event's existing Apps Script project, then run it followed by `inspectWebhookStatus`. This repository's helper uses `deleteWebhook` with `drop_pending_updates=true`: queued undelivered updates are permanently discarded. Approve that discard before running it. Older installations may use `false`; check the installed source and pending count rather than assuming a discard or uploading newer code. Verify each intended bot reports `installed: false`; an empty result can mean missing tokens, not successful shutdown. If a call fails, verify the remaining bots individually. Do not run `resetWebhooksAndDropPendingUpdates`, which reinstalls webhooks. These inspection/removal helpers send no participant notifications. Removing a webhook does not stop a separate polling client; stop any such client too. [Telegram webhook removal and inspection](https://core.telegram.org/bots/api#deletewebhook).
4. **Stop automatic Apps Script runs.** Inspect the project's Triggers page and the owner's My Triggers page. Remove only this event's time-driven, form-submit, edit and other installable triggers. If the optional guessing timer exists, its owner can run `removeGuessingFormRefreshTrigger` before clearing guessing configuration. Other owners must remove their own triggers: one account cannot see another account's installed triggers. Preserve unrelated automations. [Trigger ownership](https://developers.google.com/apps-script/guides/triggers/installable).
5. **Archive the event's active deployments.** Open **Deploy > Manage deployments**, select each active event deployment and choose **Archive deployment**. Repeat for older still-active web apps or API executables; archiving only the newest is insufficient. Keep the project and version history. Check Executions for already-running work: webhook removal and archiving do not establish that a request already in flight has finished. Do not manually run relay/setup functions afterward. [Apps Script deployment lifecycle](https://developers.google.com/apps-script/concepts/deployments).
6. **Disable gateway entry points.** In the exact Worker's **Domains** tab (or **Settings > Domains & Routes**, depending on dashboard layout), disable its `workers.dev` production URL. Also disable preview URLs and remove any event-only routes/custom domains or trigger bindings; this repository does not require those extras. Disable event deployment automation so a later build cannot reopen it. A retained private deployment configuration should set `workers_dev: false` and `preview_urls: false`; do not change the reusable template's defaults for future events. Check every former public entry point, not just `/healthz`. [Worker access controls and redeployment caveat](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
7. **Retire credentials after disconnection.** Revoke each event bot's old API token using BotFather's token controls; do not delete the bot identity. Do not install a replacement token into the retired stack. Remove retired bot tokens and webhook keys from Apps Script Properties and gateway secrets. Do not use a blanket delete-all-properties operation. Token revocation prevents a retained old credential from sending later. Keep replacement tokens private. [BotFather token management](https://core.telegram.org/bots/features#botfather).
8. **Verify and record closure.** Require all intended webhooks removed, all event deployments archived, all relevant owners' event triggers removed, gateway entry points disabled, old tokens revoked, and no event executions still running. An inaccessible dashboard is a verification gap, not proof of closure. Keep private Form/Sheet records intact and restrict sharing under the organizer's retention policy. Existing delivered chat messages are not erased or recalled.

The retired bots no longer send welcome, relay, or failure messages. A persistent closure auto-reply would require leaving a service running and is not part of this shutdown.

For another event, start at section 3 with new resources; do not reopen the retired stack or reuse participant bindings. Before publishing an archive, rerun the strict current/history scan and empty-workbook checks. Exclude event data, answer keys, resource identifiers, snapshots, and secrets. Public visibility and a reuse license are separate owner decisions; source access alone is not a license. Native Sheets/Form behavior and live Telegram delivery still require the controlled checks in sections 4 and 11; an offline pass is not a fresh deployment rehearsal. Guess scoring and participant-name ownership remain outside the implemented guessing-choice feature.
