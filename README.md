# Angel & Mortal Telebot

Run an Angel & Mortal game on Telegram, with anonymous two-way messaging and a roster you manage in Google Sheets.

Participants sign up through Google Forms and start two Telegram bots. You assign each giver a mortal in the Sheet; the bots handle the conversation without forwarding the giver's Telegram identity.

**[Set up your own bots →](docs/deployment.md)** · [Troubleshooting](docs/deployment.md#12-troubleshooting) · [Security](SECURITY.md)

## What you can do

- Collect signups, preferences and numeric Telegram IDs with a generated Google Form.
- Manage pairings with dropdowns, readiness checks and status indicators in Google Sheets.
- Relay text and supported media between each giver and their mortal.
- Update pairings without redeploying: each incoming message checks the current roster.
- Create an optional end-of-game guessing Form with alphabetically sorted choices.
- Close an event without deleting its private records.

The default deployment uses **Google Apps Script + Cloudflare Workers**. It is designed for low-volume events on free service tiers, not guaranteed permanent free hosting. Provider quotas and pricing can change.

## How it works

```text
Telegram bots → Cloudflare Worker → Google Apps Script → Google Sheets
                                         ↓
                                  Telegram Bot API
```

The Worker validates incoming webhook requests. Apps Script checks the current participant and pairing data, then sends the message through the appropriate bot.

| Bot | What participants use it for |
| --- | --- |
| **Mortal bot** | Message their assigned mortal as a giver. |
| **Angel bot** | Receive messages from their giver and reply. |

Every participant must send `/start` to **both bots**, using the Telegram account whose numeric ID they submitted in the signup Form. There is no registration code. Invalid or incomplete pairings block delivery rather than falling back to an old recipient.

**Anonymity has limits:** messages use the bot's sender identity, but names, faces, voices, filenames and document metadata can still identify a sender. Tell participants not to include identifying information.

## Before you start

You will need:

- A Google account that can deploy an Apps Script web app with **Anyone** access. Some Workspace administrators disable this.
- A Cloudflare account and a Telegram account with access to BotFather.
- Git, Python 3 and a maintained Node.js release. Use **Node 22.23.4 or newer on the Node 22 line**; other maintained lines need equivalent security fixes.
- New private resources and credentials for your event, plus controlled test accounts before inviting participants.

No owned domain is required: the Worker can use its `workers.dev` address. The default target is the Worker, not the optional Node server in `gateway/server.js`.

## Quick start: download and check

```bash
git clone https://github.com/Xateh/angel-mortal-telebot.git
cd angel-mortal-telebot
npm ci
npm test
npm run build
npm --prefix gateway ci
npm --prefix gateway test
python -m unittest discover -s test -p 'test_*.py'
python scripts/verify_repository.py
```

The build produces `dist/Code.gs` for Apps Script. The repository also contains `appsscript.json` and an empty Sheets reference workbook at `templates/angel-mortal-empty.xlsx`. The workbook is a **Google Sheets reference**, not an Excel calculation model.

Automated tests use local mocks. Passing them does not establish that your Google permissions, Sheet formulas, Forms settings or live Telegram delivery are working.

## Deploy your event

Use the linked steps for the full commands, configuration table and checks.

1. **[Create the Form and Sheet](docs/deployment.md#4-create-the-empty-google-form-and-sheet).** Create a standalone Apps Script project, paste the built code and manifest, then run `createEmptyAngelMortalStack` once and `setupProject`. Check the generated Form's questions, branching and sharing settings before distributing it.
2. **[Create two Telegram bots](docs/deployment.md#5-create-telegram-bots).** Use BotFather to create an Angel bot and a Mortal bot.
3. **[Configure Apps Script](docs/deployment.md#6-configure-apps-script-privately).** Store bot tokens and event configuration in private Script Properties—not source files. Set your organizer support handle.
4. **[Deploy the Apps Script web app](docs/deployment.md#7-deploy-apps-script).** Execute as the owner, allow **Anyone**, and use the versioned `/exec` URL.
5. **[Deploy the Cloudflare Worker](docs/deployment.md#8-deploy-the-cloudflare-worker).** Choose a verified-new Worker name, use it explicitly in every Wrangler command, and store the Apps Script URL and webhook keys as Worker secrets. This avoids overwriting another event's Worker.
6. **[Connect the webhooks](docs/deployment.md#9-connect-the-stack-and-install-webhooks).** Set `WEBHOOK_GATEWAY_URL`, run `validateConfiguration` and `setupWebhooks`, then inspect the installed webhook status.
7. **[Test before launch](docs/deployment.md#11-controlled-verification-checklist).** Use controlled participants to test registration, pairings, text, media, replies, invalid mappings and recovery. Only then invite your event participants.

The optional Admin bot is not needed for the basic relay. If enabled, configure an independently verified organizer Telegram ID; do not infer the administrator from whoever last sent `/start`.

## Running the game safely

- **Pair in column G (`Mortal`) only.** Columns S and T record bot registration; other roster columns are formula-driven. Keep the response and roster rows append-only. Do not sort, delete or insert underlying participant rows; use filter views.
- **Pause conversations before changing pairings.** A mapping update cannot recall a message already in flight. Resume only after the relevant pairings are valid.
- **If a Telegram ID changes, start both bots again.** Old timestamps are not proof that the new account is registered.
- **If the response tab is renamed, first update the `FORM_RESPONSES_SHEET_NAME` Script Property to its exact new name, then rerun `setupProject`.** This regenerates the source ranges; it does not make row sorting safe.
- **Keep participant data private.** Restrict Form/Sheet access and agree on consent and retention. Profile details used for introductions are disclosed to the assigned giver.
- **Keep secrets out of Git.** Bot tokens belong in Script Properties; gateway keys belong in Worker secrets. Never commit participant exports, event identifiers, answer keys or populated workbooks.

See [privacy and rotation](docs/deployment.md#15-security-and-rotation), [service limits](docs/deployment.md#13-service-limits-and-call-amplification) and [event shutdown](docs/deployment.md#17-close-an-event-without-deleting-its-records). Deregistration is not data deletion, and shutdown does not erase already-delivered chat messages.

## Optional guessing Form

[Set up a conclusion guessing Form](docs/deployment.md#16-optional-conclusion-guessing-form) when the game ends. It can populate and refresh alphabetical participant choices, with an optional hourly refresh trigger.

This feature does **not** score answers or authenticate ownership of a selected participant name. Decide on identity verification, a frozen answer key and scoring rules separately before using guesses as results.

## Development and maintenance

Source files live at the repository root; `gateway/` contains the Worker and optional Node gateway. `config/form-schema.json` defines the signup schema. Tests are in `test/` and `gateway/test/`.

Alongside the quick-start checks, review dependencies before deployment:

```bash
npm audit
npm --prefix gateway audit
```

See the [coverage guide](docs/coverage.md) for reproducible coverage commands and the [complete operations guide](docs/deployment.md) for troubleshooting, controlled testing, cleanup and release checks. Never use real participant data in fixtures or public bug reports.

## License

[MIT](LICENSE) © 2026 Xateh. Third-party dependencies retain their own licenses.
