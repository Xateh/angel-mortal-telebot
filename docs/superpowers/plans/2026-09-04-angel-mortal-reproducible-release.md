# Angel Mortal Reproducible Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, privately publish, and clean-room verify a secret-free Angel/Mortal Telegram relay without changing production.

**Architecture:** Reuse the tested Apps Script relay and Cloudflare gateway, replacing roster synchronization with native spill formulas and adding a code-built Form/Sheet setup. Prove compatibility in a Drive duplicate, then deploy only isolated test resources from a fresh private-repository clone.

**Tech Stack:** Google Apps Script V8, Google Forms, Google Sheets, Telegram Bot API, Cloudflare Workers Free, Node.js 20+, Python 3 standard library, Git, GitHub CLI

**Spec:** `docs/superpowers/specs/2026-09-03-angel-mortal-reproducible-release-design.md`

## Global Constraints

- Production Sheet, Apps Script deployment, Cloudflare Worker, Telegram bots, webhooks, tokens, messages, and behavior remain unchanged.
- Production is read-only evidence; all writes target the Drive duplicate, local repository, or isolated clean-room resources.
- Repository remains private. User controls any later public release.
- No production identifiers, private links, participant data, response timestamps, credentials, tokens, webhook keys, or deployment URLs enter tracked files or Git history.
- `Form Responses 1` and roster participant order are append-only; organizers use filter views instead of sorting underlying rows.
- No installable form-submit or edit trigger exists in the released system.
- `Mortal` is the only organizer mapping input. `Telegram ID` and participant fields use row-2 spill formulas.
- Native Sheets formulas, validation, notes, filters, and conditional formatting are preferred over scripts.
- Invalid or stale mappings fail closed. No error path forwards to an earlier recipient.
- Only synthetic participants and controlled Telegram accounts are used outside production.
- Provider terms, billing upgrades, paid plans, and public repository visibility remain unaccepted unless the user separately authorizes them.

---

### Task 1: Import the Tested Relay into the Secret-Safe Release Repository

**Files:**
- Create: `Config.gs`
- Create: `FormImport.gs`
- Create: `Storage.gs`
- Create: `Telegram.gs`
- Create: `Game.gs`
- Create: `Admin.gs`
- Create: `Code.gs`
- Create: `appsscript.json`
- Create: `build.mjs`
- Create: `package.json`
- Create: `test/run-tests.js`
- Create: `gateway/worker.mjs`
- Create: `gateway/server.js`
- Create: `gateway/package.json`
- Create: `gateway/test/worker.test.mjs`
- Create: `gateway/test/server.test.js`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `SECURITY.md`
- Create: `scripts/verify_repository.py`
- Test: `test/test_repository_safety.py`

**Interfaces:**
- Consumes: tested source at `../angel-mortal-gas`; approved design spec
- Produces: buildable local relay; `python scripts/verify_repository.py`; `npm test`; `npm run build`; `npm --prefix gateway test`

- [ ] **Step 1: Copy only reviewed source and tests**

Copy the listed files from `../angel-mortal-gas`. Exclude `dist/`, snapshots, logs, deployment state, `.clasp.json`, credentials, and the old README. Confirm the destination has no unlisted files.

- [ ] **Step 2: Run imported baseline tests**

Run:

```powershell
npm test
npm --prefix gateway test
npm run build
```

Expected: both test commands pass; build creates `dist/Code.gs` from seven source files.

- [ ] **Step 3: Write a failing repository-safety test**

Import `scan_bytes` from the scanner. Build a Telegram-shaped token from separate byte fragments so the test source itself never contains a token-shaped string.

```python
import unittest

from scripts.verify_repository import scan_bytes


class RepositorySafetyTests(unittest.TestCase):
    def test_rejects_telegram_shaped_secret(self):
        secret = b"123456789" + b":" + b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"
        findings = scan_bytes("synthetic fixture", secret)
        self.assertEqual([item.rule for item in findings], ["possible Telegram token"])
```

Run:

```powershell
python -m unittest test.test_repository_safety
```

Expected: FAIL because `scripts/verify_repository.py` does not exist.

- [ ] **Step 4: Add minimal secret and participant-data scanning**

Implement `scripts/verify_repository.py` with Python standard-library modules only. It must:

```python
TOKEN_PATTERNS = {
    "possible Telegram token": rb"\b\d{7,12}:[A-Za-z0-9_-]{30,}\b",
    "possible Google API key": rb"\bAIza[A-Za-z0-9_-]{30,}\b",
    "private key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
}
```

It scans `git ls-files`, every ZIP member inside tracked `.xlsx` files, and `git log -p --all`. Optional `AM_PRIVATE_DENYLIST` points to an ignored newline-delimited local file whose literal entries must not occur. It reports filenames and rule names, never matching secret values.

- [ ] **Step 5: Add repository guard files**

Use this minimum `.gitignore` policy:

```gitignore
.env
.env.*
!.env.example
.private-denylist
.clasp.json
.wrangler/
.dev.vars
credentials*.json
service-account*.json
dist/
coverage/
logs/
snapshots/
verification-private/
*.log
```

`.env.example` contains names with empty values only. `SECURITY.md` states where Script Properties and Worker secrets belong, how to revoke a leaked bot token, and that deleting a secret from the latest commit does not remove it from history.

- [ ] **Step 6: Verify and commit the imported baseline**

Run:

```powershell
python -m unittest test.test_repository_safety
python scripts/verify_repository.py
npm test
npm --prefix gateway test
npm run build
```

Expected: all commands pass; scanner prints `repository safety check passed`.

Commit:

```powershell
git add .
git commit -m "chore: import secret-safe relay baseline"
```

---

### Task 2: Replace Roster Synchronization with Spill Formulas

**Files:**
- Modify: `Storage.gs`
- Modify: `Config.gs`
- Modify: `FormImport.gs`
- Modify: `build.mjs`
- Modify: `test/run-tests.js`

**Interfaces:**
- Consumes: `ROSTER_HEADERS`, `FORM_HEADER_PREFIXES`, `buildParticipantsFromForm_()`, `analyzePairings_()`
- Produces: `rosterSpillFormulas_(personIdNamespace)`, `applyRosterSpillFormulas_(sheet, personIdNamespace)`, trigger-free `setupParticipantsSheet_()`, read-only `syncParticipants_()`

- [ ] **Step 1: Add failing spill-formula contract tests**

Add tests asserting:

```js
test("roster uses one spill formula per generated column", () => {
  setupProject();
  assert.equal(roster.getRange("N2").getFormula().includes("FILTER("), true);
  assert.equal(roster.getRange("N3").getFormula(), "");
});

test("setup installs no spreadsheet triggers", () => {
  setupProject();
  assert.deepEqual(scriptApp.createdTriggers, []);
});

test("server-side validation still reads current mapping on every message", () => {
  assertCurrentMappingWinsWithoutSync();
});
```

Also assert generated formulas contain open-ended `Form Responses 1` ranges, return blanks for absent response timestamps, and never reference `Angel Mortal Roster - Snapshot`.

Run `npm test`.

Expected: FAIL because row-by-row formulas and trigger installation still exist.

- [ ] **Step 2: Implement source spill formulas**

Create `rosterSpillFormulas_(personIdNamespace)` returning formulas for `A2:F2`, `N2:R2`, and `U2`. Use `FILTER(...,'Form Responses 1'!A2:A<>"")` for source projection. Required mappings are:

```text
A Participant Key       = Name + " [" + normalized Telegram ID + "]"
B Name                  = form Name
C Room                  = form Room
D Mode Requested        = Angel or Devil parsed from form choice
E Prank Tolerance       = form tolerance
F Gender Preference     = form gender preference
N Telegram ID           = whitespace-stripped form Telegram ID
O PersonID              = personIdNamespace + source row number
P Intro                 = approved year/faculty/interests/requirements/mode details
Q Form Row              = source row number
R Signup Time           = form timestamp
U Form Validation Issues = required-field and duplicate-input issues
```

The function accepts a namespace argument so staging can preserve existing `PersonID` values while a clean-room Sheet uses `"form:" + spreadsheet.getId() + ":"`.

- [ ] **Step 3: Implement pairing spill formulas**

Set one `MAP` formula in each of `H2:M2`. Each formula begins with `IF(participantKey="","",...)`. Preserve current meanings:

```text
H Mortal Prank Tolerance = selected mortal lookup
I Role to Mortal         = selected mortal's requested mode
J Assignment Fit         = READY, GOOD, CHECK, INVALID, or MISMATCH
K Assigned Angel/Devil   = reverse unique lookup
L Pairing Status         = Ready only when M is blank
M Pairing Issues         = form, blank, missing, self, duplicate, and occurrence issues
```

Use open column ranges so new response rows become visible without copied formulas. Leave `G`, `S`, and `T` free of spill formulas.

- [ ] **Step 4: Remove synchronization writes and triggers**

Delete `writeParticipants_()`, `applyRosterFormulas_()`, `rosterFormulaRow_()`, `handleRosterFormSubmit()`, `handleRosterEdit()`, and `installRosterTriggers()`. Remove trigger menu entries. Make `syncParticipants_()` calculate and return `participantSummary_()` without writing participant rows.

Set `participant.rowNumber = index + 2` in `buildParticipantsFromForm_()`; continue preserving `Mortal` and bot-start timestamps by Telegram ID. `markParticipantBotStarted_()` and `deregisterParticipant_()` write only columns `S:T` on the participant's current append-only row.

- [ ] **Step 5: Preserve native Sheet controls**

Keep the yellow `Mortal` header, dynamic dropdown sourced from column `A`, hidden helper columns, frozen header, filter, notes, and five traffic-light rules. Add notes warning that Form response and roster rows are append-only and that filter views are safe.

- [ ] **Step 6: Run focused and full checks**

Run:

```powershell
npm test
npm run build
rg -n "handleRosterFormSubmit|installRosterTriggers|Angel Mortal Roster - Snapshot" --glob "*.gs" --glob "*.js"
```

Expected: tests and build pass; search returns no matches outside tests that explicitly assert absence.

Commit:

```powershell
git add Config.gs FormImport.gs Storage.gs build.mjs test/run-tests.js
git commit -m "feat: make roster trigger-free and formula-driven"
```

---

### Task 3: Add the Code-Built Google Form and Empty Workbook Setup

**Files:**
- Create: `config/form-schema.json`
- Create: `FormSetup.gs`
- Modify: `build.mjs`
- Modify: `appsscript.json`
- Create: `test/form-schema.test.js`
- Modify: `test/run-tests.js`

**Interfaces:**
- Consumes: exact current Form labels, choices, required flags, descriptions, and section routing; `setupParticipantsSheet_()`
- Produces: build-generated `FORM_SCHEMA`; `createEmptyAngelMortalStack()` returning `{formId, spreadsheetId, editUrl, publishedUrl}`; `buildFormItems_(form, schema)`

- [ ] **Step 1: Capture the exact Form schema without private metadata**

Read the authorized current Form and transcribe only question structure into `config/form-schema.json`. Use these stable field keys in order:

```json
["name","gender","room","telegramHandle","telegramId","year","faculty","interests","specialRequirements","genderPreference","mode","prankTolerance","roomEntry","boundaries","declaration"]
```

The schema records title, public description text, item type, choices, required flag, help text, section key, and navigation target. It contains no Form ID, response Sheet ID, owner identity, edit URL, responses, or timestamps. `mode=Devil` routes to `devil_details`; `mode=Angel` skips it.

- [ ] **Step 2: Write failing schema and builder tests**

Tests must assert exact item order, unique field keys, required Telegram ID, numeric-ID validation description, Devil routing, Angel skip routing, and zero default responses.

```js
test("Devil choice enters details while Angel skips them", () => {
  assert.equal(choice("mode", "Devil").target, "devil_details");
  assert.equal(choice("mode", "Angel").target, "submit");
});
```

Run:

```powershell
node --test test/form-schema.test.js
npm test
```

Expected: FAIL because schema and builder are absent.

- [ ] **Step 3: Generate the Apps Script schema constant during build**

Update `build.mjs` to read `config/form-schema.json`, validate its JSON, and prepend the generated constant:

```js
const schema = JSON.parse(fs.readFileSync(path.join(root, "config", "form-schema.json"), "utf8"));
const schemaSource = `var FORM_SCHEMA = Object.freeze(${JSON.stringify(schema)});\n`;
```

Then include `FormSetup.gs` before `Config.gs` in `dist/Code.gs`. Do not duplicate question text in two source files.

- [ ] **Step 4: Implement two-pass Form creation**

`buildFormItems_(form, schema)` first creates page-break sections, then creates questions and choices so navigation choices can reference the already-created pages. `createEmptyAngelMortalStack()` performs:

```js
var spreadsheet = SpreadsheetApp.create(FORM_SCHEMA.title + " (Responses)");
var form = FormApp.create(FORM_SCHEMA.title);
buildFormItems_(form, FORM_SCHEMA);
form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());
getScriptProperties_().setProperties({
  SPREADSHEET_ID: spreadsheet.getId(),
  FORM_RESPONSES_SPREADSHEET_ID: spreadsheet.getId(),
  FORM_RESPONSES_SHEET_NAME: "Form Responses 1"
}, false);
setupParticipantsSheet_();
```

It returns identifiers and URLs to the executing organizer only; it never logs them or writes them into repository files.

- [ ] **Step 5: Add required scopes and run tests**

Add Forms scope to `appsscript.json` while retaining Sheets and external-request scopes. Run:

```powershell
node --test test/form-schema.test.js
npm test
npm run build
```

Expected: all pass; built code contains one `FORM_SCHEMA` definition and `createEmptyAngelMortalStack`.

Commit:

```powershell
git add config/form-schema.json FormSetup.gs build.mjs appsscript.json test
git commit -m "feat: add reproducible Form and Sheet builder"
```

---

### Task 4: Package the Free-Tier Deployment and Failure Guidance

**Files:**
- Modify: `Config.gs`
- Modify: `Game.gs`
- Modify: `Code.gs`
- Modify: `Telegram.gs`
- Modify: `test/run-tests.js`
- Modify: `gateway/package.json`
- Create: `gateway/wrangler.jsonc`
- Modify: `gateway/test/worker.test.mjs`
- Create: `README.md`
- Create: `package-lock.json`
- Create: `gateway/package-lock.json`

**Interfaces:**
- Consumes: existing fail-closed routing and Telegram retry functions; Cloudflare `handleRequest()`
- Produces: `SUPPORT_HANDLES` Script Property parsing; deployable Worker; exact README-only setup path

- [ ] **Step 1: Add failing configurable-support and failure-path tests**

Add assertions that missing Sheet access, invalid mapping, recipient-not-started, and exhausted Telegram retries send the sender one short failure response and perform zero target sends. Assert support handles come from `SUPPORT_HANDLES` and default to generic `@organiser` when unset.

Run `npm test`.

Expected: FAIL because support handles are hardcoded.

- [ ] **Step 2: Make support handles configuration-only**

Replace hardcoded handles with:

```js
function supportHandles_() {
  return (getProperty_("SUPPORT_HANDLES") || "@organiser")
    .split(",")
    .map(function (value) { return value.trim(); })
    .filter(Boolean);
}
```

Keep existing bounded Telegram retry, flood-control delay, media-size guard, duplicate-update suppression, webhook authentication, stateless route lookup, and sender feedback.

- [ ] **Step 3: Add deployable Worker configuration**

Create `gateway/wrangler.jsonc`:

```json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "angel-mortal-telegram-gateway",
  "main": "worker.mjs",
  "compatibility_date": "2026-09-04"
}
```

Pin Wrangler major version 4 in `gateway/package.json`; generate both lockfiles. No secret appears in Wrangler configuration.

- [ ] **Step 4: Write README as the only clean-room runbook**

Document, in execution order:

1. prerequisites and free-account boundaries;
2. clone, install, test, build, and repository scan;
3. create Apps Script project and copy `dist/Code.gs` plus manifest;
4. authorize and run `createEmptyAngelMortalStack()`;
5. set bot tokens, usernames, webhook keys, support handles, and gateway URL in Script Properties;
6. deploy Apps Script as executing user with anonymous web-app access;
7. deploy Worker and enter `APPS_SCRIPT_URL` plus webhook keys with `wrangler secret put`;
8. create two BotFather bots, enter tokens only as secrets, and install webhooks;
9. fill `Mortal`, confirm every participant is `Ready`, and run validation;
10. run automated and controlled live tests;
11. troubleshoot every known failure message; and
12. remove test webhooks/secrets and clear synthetic data.

State that the setup uses current free tiers but future pricing and quotas can change. Include Apps Script quotas, Cloudflare Workers Free request/CPU limits, Telegram message/file limits, and row-capacity behavior with official links.

- [ ] **Step 5: Verify packaging**

Run:

```powershell
npm ci
npm test
npm run build
npm --prefix gateway ci
npm --prefix gateway test
python scripts/verify_repository.py
```

Expected: all pass from a clean dependency install.

Commit:

```powershell
git add Config.gs Game.gs Code.gs Telegram.gs test gateway README.md package-lock.json
git commit -m "docs: add private reproducible deployment runbook"
```

---

### Task 5: Create and Validate the Empty Workbook Artifact

**Files:**
- Create: `templates/angel-mortal-empty.xlsx`
- Modify: `scripts/verify_repository.py`
- Create: `test/test_workbook_artifact.py`

**Interfaces:**
- Consumes: `ROSTER_HEADERS`, spill-formula contract, approved formatting and validation rules
- Produces: participant-free reference workbook; scanner check for nonempty data cells below headers

- [ ] **Step 1: Add a failing artifact test**

Test must inspect the XLSX ZIP/XML and assert:

```text
Sheet names: Form Responses 1, Angel Mortal Roster
Roster columns: exactly 21 approved headers
Rows below headers: no literal participant values
Formula cells: allowed
Hidden columns, header formatting, notes, validation, and conditional rules: present
```

Run `python -m unittest test.test_workbook_artifact`.

Expected: FAIL because workbook is absent.

- [ ] **Step 2: Build the workbook from an empty schema**

Use the spreadsheet artifact tooling to create `templates/angel-mortal-empty.xlsx` directly from headers and formula definitions. Never export production or staging. Keep `Form Responses 1` header-only; keep roster formulas and controls with no participant entries or cached participant values.

- [ ] **Step 3: Extend the scanner for XLSX data rows**

Use Python `zipfile` and `xml.etree.ElementTree` to inspect each worksheet cell below row 1. Reject nonblank literal values; permit formulas and empty cached values. Continue scanning shared strings for denylisted/private content.

- [ ] **Step 4: Verify and commit the artifact**

Run:

```powershell
python -m unittest test.test_workbook_artifact
python scripts/verify_repository.py
```

Expected: both pass; scanner confirms zero participant entries.

Commit:

```powershell
git add templates/angel-mortal-empty.xlsx scripts/verify_repository.py test/test_workbook_artifact.py
git commit -m "docs: add empty workbook reference"
```

---

### Task 6: Convert Only the Drive Duplicate and Remove Its Snapshot

**Files:**
- Create outside Git: `verification-private/staging-before.json`
- Create outside Git: `verification-private/staging-after.json`
- Create outside Git: `verification-private/production-before.json`
- Create outside Git: `verification-private/production-after.json`

**Interfaces:**
- Consumes: authenticated production workbook read-only; formula setup from Tasks 2-3
- Produces: private staging workbook with active formula roster and no Snapshot tab; production-invariance evidence

- [ ] **Step 1: Capture production read-only baseline**

Record workbook ID in process memory only. Export metadata, tab names/IDs, dimensions, headers, displayed values, formulas, validation, formatting, notes, filters, conditional rules, and hidden columns into ignored `verification-private/production-before.json`. Do not edit production.

- [ ] **Step 2: Duplicate the response workbook**

Create one private Drive duplicate. Confirm its workbook ID differs from production and that no bot, Worker, webhook, or Apps Script property points to it.

- [ ] **Step 3: Prepare staging tabs and state by identity**

Inside the duplicate only:

1. rename `Angel Mortal Roster` to `Angel Mortal Roster - Snapshot`;
2. use `Angel Mortal Roster - Formula Test` as candidate;
3. copy `Mortal`, `Angel Bot Started At`, and `Mortal Bot Started At` from Snapshot by matching Telegram ID or PersonID;
4. derive the copied PersonID namespace from Snapshot; and
5. apply self-contained spill formulas, validation, formatting, notes, filter, and hidden columns.

Reject the operation if participant identities are duplicated or any state row cannot be matched uniquely.

- [ ] **Step 4: Verify candidate parity before promotion**

Compare Snapshot and candidate. Required result:

```text
Headers: identical
Displayed values: identical
Formula errors: 0
Snapshot references: 0
Validation differences: 0
Formatting/note/filter differences: 0
Participant identity mismatches: 0
```

Save evidence only in ignored `verification-private/staging-before.json`.

- [ ] **Step 5: Promote candidate and test one duplicate-only append**

Rename candidate to `Angel Mortal Roster`. Add one clearly synthetic response in the duplicate, confirm formula columns including `N` appear automatically and `G` stays blank, then remove that synthetic response and confirm original values return. Do not message any bot.

- [ ] **Step 6: Delete Snapshot after the passing gate**

Resolve the exact duplicate workbook and exact `Angel Mortal Roster - Snapshot` tab again. Delete that tab only. Confirm it no longer exists, no `#REF!` appears, no Snapshot reference remains, and displayed values still match the pre-deletion candidate evidence.

- [ ] **Step 7: Prove production remained unchanged**

Capture `verification-private/production-after.json` with the same read-only method and compare it with `production-before.json`.

Expected: zero production differences.

---

### Task 7: Publish Privately and Perform a README-Only Clean-Room Deployment

**Files:**
- Modify only when verification finds an inaccuracy: repository source, tests, or `README.md`
- Create outside Git: clean-room clone and ignored verification notes

**Interfaces:**
- Consumes: completed local repository; GitHub CLI authentication; README
- Produces: private GitHub repository; isolated Form, Sheet, Apps Script deployment, Worker, and two test bots; deviation-free verification run

- [ ] **Step 1: Run final pre-push gates**

Run:

```powershell
npm ci
npm test
npm run build
npm --prefix gateway ci
npm --prefix gateway test
node --test test/form-schema.test.js
python -m unittest test.test_repository_safety
python -m unittest test.test_workbook_artifact
python scripts/verify_repository.py
git status --short
```

Expected: all tests pass, scan passes, working tree clean.

- [ ] **Step 2: Create the private GitHub repository**

Run `gh auth status`, then:

```powershell
gh repo create angel-mortal-telegram-relay --private --source . --remote origin --push
gh repo view angel-mortal-telegram-relay --json nameWithOwner,visibility
```

Expected: visibility is `PRIVATE`. Stop if GitHub reports public visibility.

- [ ] **Step 3: Clone into a fresh temporary directory**

Create a new OS temporary directory, obtain the authenticated clone URL from `gh repo view`, clone there, and discard all knowledge of local uncommitted files. Use only the cloned README from this point.

- [ ] **Step 4: Follow README verbatim to create isolated resources**

Create a new empty Form/Sheet stack, new Apps Script project and deployment, new Cloudflare Worker, and two new Telegram test bots. Select only free plans. Enter secrets through Script Properties, `wrangler secret put`, and BotFather; never place them in files or command output.

- [ ] **Step 5: Run synthetic Sheet and mapping tests**

Use synthetic Angel and Devil rows to verify automatic spill, blank `G`, dropdown validation, valid derangement, self-pairing rejection, duplicate-mortal rejection, missing participant rejection, tolerance green/amber/red indicators, and server-side fail-closed validation.

- [ ] **Step 6: Run controlled live bot tests**

Using controlled accounts only, verify:

```text
/start without code identifies a submitted Telegram ID
giver sends through Mortal bot; mortal receives through Angel bot
reply travels through Angel bot to giver through Mortal bot
sender identity and Angel/Devil identity are absent from mortal-facing text
text and one small supported media item relay through opposite bots
changing G affects the next message without restart or redeploy
invalid G sends failure feedback and performs no relay
recipient-not-started and simulated downstream failure send useful feedback
duplicate Telegram update is not delivered twice
```

- [ ] **Step 7: Repeat until README needs no unstated action**

For every deviation, write the exact missing or wrong instruction in ignored notes, fix code/docs with a failing regression test where applicable, run all local gates, commit, push, destroy the failed isolated resources, reclone into a new temporary directory, and restart from README step 1. A partial rerun does not count as final verification.

Commit corrections with focused messages such as:

```powershell
git commit -m "fix: correct clean-room deployment step"
```

Final result: one full fresh-clone run completes without deviation.

---

### Task 8: Remove Test Access and Produce Final Evidence

**Files:**
- Modify: `README.md` only if cleanup instructions proved inaccurate
- Remove outside Git: temporary clones, local secret files, and deployment state

**Interfaces:**
- Consumes: passing clean-room stack and staging evidence
- Produces: inactive isolated bots; secret-free private repository; empty retained Form/Sheet; production invariance report

- [ ] **Step 1: Remove isolated Telegram webhooks**

Call `deleteWebhook` for both new test bots with `drop_pending_updates=true`. Verify `getWebhookInfo.url` is empty for both.

- [ ] **Step 2: Remove isolated secrets and synthetic data**

Delete Worker secrets, Apps Script Script Properties containing tokens/keys/URLs, ignored local secret files, and temporary deployment state. Delete synthetic Form responses and roster mappings so retained Form/Sheet artifacts contain no participant rows. Do not delete or alter production secrets.

- [ ] **Step 3: Re-run repository and history scans**

Run:

```powershell
python scripts/verify_repository.py
git status --short
git log --oneline --decorate -10
gh repo view angel-mortal-telegram-relay --json visibility
```

Expected: safety scan passes, tree clean, visibility `PRIVATE`.

- [ ] **Step 4: Recheck staging and production end state**

Confirm staging has `Form Responses 1` and one active `Angel Mortal Roster`, with no `Angel Mortal Roster - Snapshot`, no formula errors, and no Snapshot references. Repeat production read-only comparison against Task 6 baseline.

Expected: zero production differences.

- [ ] **Step 5: Report verified limits and artifact locations**

Report private repository URL, retained empty Form/Sheet locations, latest commit, exact test commands and outcomes, clean-room cycle count, staging parity result, production-invariance result, removed webhook/secret status, and current free-tier limits with official source links. Do not expose secret values, participant data, private collaborator identities, or webhook query keys.
