# Angel Mortal Reproducible Release Design

**Date:** 2026-09-03  
**Status:** Approved

## Goal

Create a private, reproducible, and secret-free release of the Angel/Mortal Telegram relay. A new organizer must be able to create an empty Google Form and response workbook, deploy the Apps Script relay and Cloudflare gateway on free service tiers, connect two Telegram bots, and verify the result by following the repository README alone.

The existing production workbook, Apps Script deployment, Cloudflare Worker, Telegram bots, webhooks, tokens, participant messages, and bot behavior must remain unchanged throughout this work.

## Scope

The release includes:

- a Google Form schema and Apps Script form builder;
- an empty Google Sheets workbook template for inspection;
- a formula-driven `Angel Mortal Roster` tab in the Form response workbook;
- the Apps Script Telegram relay;
- the Cloudflare Worker webhook gateway;
- automated tests, repository safety checks, and deployment instructions; and
- an isolated clean-room deployment using new Forms, Sheets, Apps Script, Cloudflare, and Telegram test resources.

The release does not migrate production, reconfigure existing bots, install production triggers, send messages to production participants, copy participant records into Git, or make the GitHub repository public.

## Isolation Model

Four environments remain distinct:

1. **Production:** the current live Sheet, script deployment, Worker, webhooks, secrets, and bots. This is a read-only comparison target.
2. **Staging workbook:** a private Google Drive duplicate of the production response workbook. Bots never point to it.
3. **Release repository:** a new local repository named `angel-mortal-telegram-relay`, later published as a private GitHub repository. It contains code, schemas, documentation, tests, and an empty workbook only.
4. **Clean-room stack:** new resources created from a fresh clone by following the README. It uses new Telegram test bots and synthetic participants only.

Production invariance is checked before and after each staging or clean-room phase. No production identifier, deployment URL, webhook secret, bot token, participant record, response timestamp, or private form link is committed.

## Staging Workbook Transition

The staging workbook proves that the new formula roster can replace the copied roster without changing displayed operational values.

1. Rename the copied `Angel Mortal Roster` tab to `Angel Mortal Roster - Snapshot`.
2. Rebuild the existing formula-test tab as a self-contained formula roster that depends only on `Form Responses 1` plus manual organizer and bot-state cells. Copy `Mortal` and both bot-started timestamps from Snapshot by matching participant identity, not by assuming row order. It must not reference the Snapshot tab.
3. Rename the rebuilt tab to `Angel Mortal Roster`.
4. Compare it with Snapshot across headers, displayed values, formulas, validation, conditional formatting, notes, filters, hidden columns, dimensions, and participant identity fields.
5. Confirm zero formula errors and zero unexpected displayed-value differences.
6. Delete `Angel Mortal Roster - Snapshot`, as explicitly requested.
7. Re-run the formula-error and displayed-value checks after deletion to prove that no Snapshot dependency remains.

All operations occur only in the duplicate. The production workbook remains untouched.

## Roster Layout and Data Flow

The existing 21-column layout stays unchanged:

`Participant Key`, `Name`, `Room`, `Mode Requested`, `Prank Tolerance`, `Gender Preference`, `Mortal`, `Mortal Prank Tolerance`, `Role to Mortal`, `Assignment Fit`, `Assigned Angel/Devil`, `Pairing Status`, `Pairing Issues`, `Telegram ID`, `PersonID`, `Intro`, `Form Row`, `Signup Time`, `Angel Bot Started At`, `Mortal Bot Started At`, and `Form Validation Issues`.

`Form Responses 1` remains the intake source and is never rewritten. `Mortal` remains the organizer's only mapping input. The two bot-started timestamp columns remain writable state used by Apps Script. All other participant and pairing fields are formula-driven.

Each formula-driven column has one spill formula in row 2. Source columns use `ARRAYFORMULA` and `FILTER` against nonblank Form response timestamps. Derived columns use `ARRAYFORMULA` or `MAP` and return blank when the participant key is blank. This provides these properties:

- new submissions appear without a form-submit trigger;
- `Telegram ID` is formula-driven;
- values appear only for actual responses;
- no copied-down formulas or fixed 5,000-row preallocation are required; and
- organizer edits to `Mortal` update pairing indicators immediately.

The roster uses its ordinary Sheet row capacity. If the spill result ever outgrows that capacity, the organizer adds rows using the native Sheets command. This is documented as an explicit capacity limit, not hidden automation.

The response and roster row order must remain append-only. Sorting, deleting, or inserting participant rows can misalign the manual `Mortal` mapping and bot-start timestamps. The builder adds header notes, warning-only protection to formula/source regions where permitted, and a README warning. Organizers sort only through temporary filter views and never reorder underlying rows.

For staging parity, `PersonID` retains the copied workbook's existing namespace while becoming formula-driven. The staging conversion derives that namespace from Snapshot without placing it in repository files. A clean-room workbook instead uses its own spreadsheet ID when the builder writes the formula.

## Pairing Rules and Indicators

Every participant is both a giver and exactly one other participant's mortal. A valid mapping is a one-to-one derangement:

- every participant has one selected mortal;
- no participant selects themselves;
- every selected mortal exists in current Form responses;
- every participant appears exactly once in the `Mortal` column;
- participant names and Telegram IDs are unique; and
- required Form fields are valid.

The selected mortal's preference determines whether the giver acts as Angel or Devil. Devil compatibility compares the giver's and mortal's submitted prank-tolerance values. Gaps of 0-1 are green, 2 or a missing giver rating is amber, and 3-4 is red. Invalid or incomplete mappings are red. `Pairing Status` is `Ready` only when the structural and form-validation rules pass; the amber tolerance warning remains advisory.

Google Sheets data validation supplies the `Mortal` dropdown from current participant keys. Native conditional-formatting rules provide the traffic-light indicators. Apps Script independently validates the same mapping before any relay, so a stale or damaged formula cannot cause forwarding to an old or unintended recipient.

## Google Form

GitHub cannot store a native Google Form. The repository therefore stores a machine-readable Form schema and an Apps Script builder. The builder creates the exact questions, choices, required flags, descriptions, and section routing, then links the Form to a new response spreadsheet.

The Angel/Devil question routes Devil selections to the Devil-detail section. Angel selections skip those prank-specific questions. The form does not require email collection or one-response-per-Google-account restrictions. A newly created Form and Sheet contain zero responses and zero participant entries.

## Telegram Relay Behavior

Participants identify themselves using the numeric Telegram ID submitted through the Form; `/start <code>` is not required. The bots are stateless with respect to mappings: every incoming update reloads current Form data and the current `Mortal` mapping before deciding where to route it.

The giver uses the Mortal bot to send anonymously to their mortal. The mortal receives and replies through the Angel bot. The mortal never receives the giver's Telegram identity or Angel/Devil identity. Participants send ordinary messages directly to the bots; no manual forwarding step exists.

If the sender is unregistered, the mapping is incomplete or invalid, the intended recipient has not started the required bot, the Sheet cannot be read, or Telegram delivery fails, the message is not forwarded. The sender receives a short failure message and configurable organizer support handles. No failure path falls back to a previous recipient.

Text and supported media are relayed by downloading and re-uploading through the opposite bot. Telegram rate limits and file-size limits are handled with bounded retries and clear final feedback. Duplicate webhook updates are suppressed for a bounded period.

## Apps Script and Cloudflare Boundary

Apps Script owns Form/Sheet parsing, validation, participant lookup, routing, Telegram calls, and bot-start timestamps. The Cloudflare Worker is a narrow authenticated gateway that accepts Telegram webhooks and forwards them to the Apps Script web app.

The Worker stores only its Apps Script URL and webhook keys as encrypted secrets. Apps Script stores bot tokens, bot usernames, webhook keys, optional admin settings, workbook identifiers, and configurable support handles in Script Properties. The repository contains placeholder names only.

No installable form-submit or edit trigger is part of the final system. Setup creates the Form, linked response Sheet, roster formulas, formatting, validation, and deployment configuration. Runtime is webhook-driven.

## Repository Contents

The private repository contains the minimum reproducible set:

- `apps-script/`: Apps Script source and manifest;
- `gateway/`: Cloudflare Worker source, configuration example, and tests;
- `config/form-schema.json`: exact Form definition;
- `templates/angel-mortal-empty.xlsx`: empty workbook structure with no participant data;
- `scripts/`: repository secret/data scan and clean-room verification helpers;
- `test/`: Apps Script and roster behavior tests;
- `.env.example`: placeholder variable names only;
- `.gitignore`: local secrets, credentials, deployment state, logs, snapshots, and exports;
- `SECURITY.md`: secret handling and rotation guidance; and
- `README.md`: start-to-finish setup, verification, troubleshooting, limits, and cleanup.

The empty workbook is generated separately from a blank schema. It is never exported from a workbook that has contained production or staging participants.

## Secret and Privacy Controls

Before the first commit and after every clean-room correction, automated checks scan tracked files and Git history for Telegram token shapes, webhook keys, credentials, deployment URLs and IDs, production identifiers, known support/account handles, and participant-like rows. The scan must fail closed.

Real secrets are entered only into Google Script Properties, Cloudflare encrypted secrets, Telegram BotFather, or ignored local environment files. `.clasp.json`, Wrangler state, logs, downloaded snapshots, response exports, and credential files are never tracked. If a secret is ever committed, it is revoked and the repository history is rewritten before verification resumes; deleting only the current file is insufficient.

## Verification Strategy

Verification proceeds in layers:

1. Build the Apps Script bundle and run syntax checks.
2. Run automated Apps Script and gateway tests.
3. Create a fresh Form and response Sheet from the schema.
4. Add synthetic Angel and Devil responses, including tolerance matches and mismatches.
5. Confirm spill formulas add new roster values without a trigger and leave nonparticipant rows blank.
6. Confirm dropdown validation, one-to-one derangement checks, self-pairing rejection, duplicate-mortal rejection, conditional colors, and independent server-side validation.
7. Exercise gateway health, authentication, forwarding, retry, and downstream-failure behavior.
8. Deploy isolated Apps Script and Cloudflare resources, connect two new Telegram test bots, and test `/start`, introductions, anonymous text/media relay, bot-not-started feedback, remapping, invalid-mapping blocking, and identity secrecy using synthetic records and controlled accounts only.
9. Clone the private GitHub repository into a fresh temporary directory and repeat the setup using only the README. Any undocumented step or inaccurate instruction fails verification.
10. Fix the repository, commit, push privately, reclone, and repeat until the README-only run completes without deviation.

Each cycle ends with a production invariance check. Completion requires fresh evidence from the final cycle, not results carried forward from an earlier run.

## Cleanup

After verification:

- delete `Angel Mortal Roster - Snapshot` from the staging duplicate;
- remove webhooks from the two isolated test bots;
- remove test Worker secrets and Apps Script secrets;
- remove any temporary local secret files and deployment state;
- retain only the empty clean-room Form and Sheet as private verification artifacts if useful; and
- keep the GitHub repository private for the user's review.

Production resources remain active and unchanged.

## Service Limits and Cost Claim

The README describes the setup as reproducible using currently available free tiers, not permanently guaranteed free. It documents current Apps Script quotas, Cloudflare Workers Free limits, Telegram Bot API constraints, and the expected low-volume suitability of this event workflow. It also explains how quota or delivery failures appear to participants.

## Acceptance Criteria

Work is complete only when all conditions hold:

- production workbook, deployment, Worker, bots, webhooks, participant messages, and behavior are unchanged;
- staging `Angel Mortal Roster` is self-contained, formula-driven, trigger-free, and value-equivalent to its Snapshot before Snapshot deletion;
- staging remains error-free after Snapshot deletion;
- `Telegram ID` and participant rows update through spill formulas from new Form responses;
- `Mortal` remains a native validated manual column;
- invalid mappings never relay and always give the sender actionable feedback;
- the private repository contains no participant entries or secrets in files or history;
- the Form builder creates the approved branching Form with zero responses;
- a fresh README-only deployment passes automated and live isolated tests; and
- isolated webhooks and secrets are removed after testing.
