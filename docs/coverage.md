# Offline functional coverage

This report records the Fedora verification on 17 October 2026, starting from private main `ceee1db448ae291d268d880c1d067f3b47c9eca8`. It is an offline source verification, not a deployment rehearsal or public-release clearance. See [measured production coverage and source fingerprints](coverage-metrics.md).

## Results and verified fixes

The suite passes 78 legacy core checks, 145 Node functional tests, 40 gateway tests, and 34 Python tests: 297 checks in total. The previous baseline had 163 checks. Counts describe the runners' reported cases, not distinct behaviors or correctness guarantees. Parameterized cases contribute separately to the counts.

Two production fixes were justified by failing synthetic regressions:

- Both gateways previously interpolated arbitrary parser/upstream exception messages into logs. They now emit a fixed diagnostic, preserving the generic HTTP 503 response. Network, simulated timeout, and response-read failures are checked separately for both implementations, without real credentials or participant data.
- The Node gateway previously destroyed an oversized request and reset the client socket. It now returns HTTP 413 with `update too large`, matching the Worker. Tests accept exactly 1 MiB and reject 1 MiB plus one byte before forwarding. Request buffering remains bounded by the existing limit.

No participant command was added. Participant `/deregister` still follows the unknown-command/help path and does not clear registration. The existing self-deregistration helper is tested directly; organizer `/reset` and `/deregister` remain the supported reset paths. A participant-facing deregistration command would require a separate product decision.

## Reproduce

Use Node.js 22 or newer and Python 3. This run used Node 22.23.1, Python 3.14.8, c8 10.1.3, and coverage.py 7.10.7. The JS tool is pinned in the development lockfile; Python coverage is pinned separately. Run from the repository root in a complete checkout with relevant remote branches and tags fetched.

```sh
npm ci
npm test
npm run build
npm --prefix gateway ci
npm --prefix gateway test
npm audit
npm --prefix gateway audit
python -m unittest test.test_repository_safety test.test_workbook_artifact
python scripts/verify_repository.py

python -m venv /tmp/angel-coverage-venv
/tmp/angel-coverage-venv/bin/python -m pip install -r scripts/requirements-coverage.txt
npm run test:coverage
/tmp/angel-coverage-venv/bin/python -m coverage run -m unittest test.test_repository_safety test.test_workbook_artifact
/tmp/angel-coverage-venv/bin/python -m coverage run --append scripts/verify_repository.py
/tmp/angel-coverage-venv/bin/python -m coverage json -o coverage/python.json
python scripts/report_coverage.py
```

Choose an unused virtual-environment path on your machine. Gateway tests need loopback binding on `127.0.0.1`; a sandbox that forbids it produces `listen EPERM`, not an application failure. Installation and audit require package-registry access. The functional tests themselves use mocked upstreams and do not call Google or Telegram. No tool grants OAuth, deploys, creates resources or installs production triggers.

`coverage/` is ignored. Its JSON reports retain detailed branch/function execution counts for local inspection. `scripts/report_coverage.py` checks that all nine `.gs` files, both gateway implementations, and the Python scanner are present and have executed code, then writes the portable metrics snapshot. Absolute VM source filenames ensure V8 attributes executions to real `.gs` files. Source SHA-256 fingerprints associate the durable snapshot with production contents; the containing Git commit associates it with the test changes.

## Measurement scope

- **JS:** c8 uses V8 execution counters from the legacy runner and both Node test suites. It reports lines, branches and functions. `--all` includes unexecuted production files. V8 line coverage includes some blank/comment lines and does not mean every expression on an executed line was exercised. V8 branch ranges are not an exhaustive truth table of compound predicates.
- **Python:** coverage.py measures scanner statement lines and branches during synthetic unit tests and a current/reachable-history scan. Its combined percentage is not presented as a cross-language metric. It does not report function coverage in this snapshot.
- **Excluded from the production denominator:** test helpers/tests, coverage/build/report tooling, dependencies, generated `dist/Code.gs` (which duplicates the sources), configuration JSON, documentation and the binary workbook. The build and workbook have separate assertions. No production file, difficult production branch, or line pragma was excluded to increase percentages.
- **Fixture independence:** all new core functional tests and delivery regressions instantiate a fresh shared fixture. The existing 78-check legacy runner still uses one sequential mutable fixture; it was preserved rather than rewritten. New lifecycle tests install deterministic TTL/lock fakes; old core tests retain their simpler cache/lock fakes. The richer fake exercises expiration and injected contention/failures, not real parallel Apps Script executions.

## Behavior-to-test matrix

| Behavior | Tests | Assertions and limits |
| --- | --- | --- |
| Authorized admin status/list/person/sync and aliases | `test/admin-functional.test.js` | Replies stay on organizer bot/chat; expected participant, partner and count data; active/missing/failed webhook reads; `/codes` alias and help paths. |
| Admin reset and identifier errors | `test/admin-functional.test.js`, existing core identifier tests | `/reset` and `/deregister` clear only selected timestamps/bindings; mappings, account identity and other rows remain; absent/empty/ambiguous identifiers do not mutate. |
| Announcements | `test/admin-functional.test.js`, delivery regressions | Empty usage, exact synthetic recipients, per-recipient failure isolation and delivery counts; existing long-message splitting tests. |
| Full media transfer | `test/media-functional.test.js` | `getFile` and binary download use source token; upload uses destination bot/chat; bytes/caption/name survive; outgoing payload has only intended fields. Photo, static/animated/video sticker, video, voice, document, animation, video note. |
| Media errors and limits | `test/media-functional.test.js` | Unsupported kind, reported/actual oversize, exact 20 MiB byte-length boundary, download HTTP/exception paths; no target upload on download failure. Large byte-length cases use a synthetic blob length, not a Google Blob. |
| Text/caption delivery outcomes | `test/delivery-regressions.test.js`, `test/media-functional.test.js`, legacy core | Unicode preservation, long captions, partial sends, rejected/unknown failures, non-JSON retry exhaustion, cooldowns and acknowledgements. |
| Gateway routing/configuration/acknowledgement | `gateway/test/server.test.js`, `worker.test.mjs`, `failures.test.mjs` | Health, ordinary method/path/config failures, malformed JSON, exact forwarding, non-OK HTTP or missing `ok` acknowledgement -> 503, body-size boundaries. |
| Gateway diagnostic failures | `gateway/test/failures.test.mjs` | Network, simulated timeout, response-read failures return generic 503 and do not log synthetic exception data. Timeout tests verify a signal is supplied and inject a timeout error; they do not wait 55 seconds or exercise remote cancellation. |
| Webhook processing lifecycle | `test/lifecycle-functional.test.js`, `test/config-functional.test.js`, legacy core | Processing/done TTLs, per-bot keys, duplicate suppression, handler failure recovery, lock acquisition/release and cache get/put/remove failures, completion/status-write failures. Completion-marker failure documents possible reprocessing after expiry; exactly-once delivery is not promised. |
| Registration/reset persistence | `test/lifecycle-functional.test.js`, delivery regressions, legacy core | Sheet/property failures release locks, preserve unrelated rows, fail closed when a binding is absent and recover on retry. No claim of transactionality across Sheets and PropertiesService. |
| Participant dispatcher | `test/lifecycle-functional.test.js`, legacy core | Missing fields, group leave path, unknown command, `/mortal`, `/angel`, existing `/deregister` behavior; legacy route ambiguity/current mapping/required-form validation checks. |
| Roster migrations | `test/lifecycle-functional.test.js` | Both supported old layouts preserve manual mapping and both start columns, grow width and install current headers/formulas; unfamiliar headers are refused before mutation. |
| Configuration and compatibility | `test/config-functional.test.js`, legacy core | Selective test-mode cleanup, UI/menu behavior, missing admin binding, invalid summaries, sync aliases preserving manual state, compatibility registration rejecting codes. |
| Signup Form builder | `test/form-schema.test.js` | Schema, section routing/item settings, invalid configuration, partial Sheet/Form/destination/property/roster failures; no automatic retry, trigger or duplicate resource creation. Partial resources still require manual cleanup in a real project. |
| Guessing Form | `test/guess-form.test.js` | Choice sorting/routing, empty roster, absent candidate category, changed layout, missing sources, each choice-list write failure and all-list rollback, explicit restore failure, trigger-list/create/delete failures and lock release. |
| Webhook management | `test/media-functional.test.js`, legacy core | Real helper functions call mocked APIs for setup/status/reset/removal with exact enabled bot scope, keys, allowed updates and pending-update policy. No real webhooks changed. |
| Repository scanner | `test/test_repository_safety.py` | Synthetic current/history/ZIP/renamed artifact cases, formula caches, denylist loader failure/success cases, and location/category-only output. |
| Workbook artifact | `test/test_workbook_artifact.py` | Empty data and caches, expected sheets/headers/formula anchors, hidden columns, metadata/comment patterns, formatting and dropdown structure. This does not evaluate Google Sheets formulas. |

## Remaining meaningful gaps

The [snapshot](coverage-metrics.md) lists uncovered lines for every production file. Uncovered branches also exist on executed lines. In particular:

- Some nested participant feedback failures, safe-test fallback paths, stale route exceptions and combinations of concurrent state changes remain unexercised. Tests cannot enumerate every multi-service failure ordering.
- Legacy compatibility helpers and some missing-property/unfamiliar-layout guards have unexecuted paths. The Node server's standalone process startup/listen callback is not invoked; its actual HTTP server handler is exercised over loopback.
- Some guessing-choice validation/fallback combinations and unsuccessful rollback combinations remain unexercised beyond the individual write/restore failures tested.
- Scanner `git cat-file` object-order/framing corruption guards remain unexecuted. These are not bypassed or excluded from the denominator.
- There is no native Sheets formula engine here. Spill behavior, recalculation, locale effects and actual Forms page navigation/access settings need an isolated integration check. The workbook is not recalculated or resaved by Excel-compatible tooling.
- Real Telegram uploads/downloads, Apps Script/Cloudflare quotas, API response fidelity, timing, cache eviction and concurrent execution are unverified. Mock API success is not live-delivery evidence; retry/deduplication is best-effort.

## Privacy and release status

Repository checks cover tracked files plus objects reachable from all locally fetched refs, including historical workbook content. The private identifier denylist remains unavailable. Synthetic denylist tests validate scanner behavior; they do **not** provide identifier coverage for any real event. A passing ordinary pattern scan is not strict release clearance or proof that every private identifier has been removed.

Keep the repository private. Public release still requires owner review of identifier coverage and workbook hidden content/metadata, the controlled integration checks, and explicit visibility/licensing decisions. No live resource, production credential, participant record or network/security setting was changed by this work.
