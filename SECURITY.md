# Security

Store Google Apps Script bot tokens, webhook keys, workbook/Form/item identifiers, support handles, and optional admin/test Telegram IDs in Apps Script Script Properties. Participant records remain in the private Form response and roster Sheets; the private account-binding properties also store the numeric account ID that completed each bot's registration. Store gateway `APPS_SCRIPT_URL` and webhook keys in encrypted Worker secrets; never commit either location's values.

Keep `.env`, `.dev.vars`, `.clasp.json`, `.wrangler`, logs, exports, snapshots, credentials, and private verification files untracked. Before release, run `python scripts/verify_repository.py` with release mode and a nonempty ignored private denylist as documented in the README.

The empty workbook must contain no participant entries or nonempty formula caches. Pattern-based scans are not a substitute for the private denylist or structural artifact tests. Ignore rules do not remove already tracked content or old commits.

Guessing Form refresh only updates participant/candidate choices; it never creates an answer key, grades responses, or reveals results. Keep any future answers/results private. Hidden Sheet tabs are not access control. Name selection, verified email, and one response per Google account do not prove participant identity. Decide ownership verification and a frozen scoring-key/cutoff policy separately before awarding results.

The optional guessing refresh timer runs as its creator and requires the manifest's trigger-management scope. It is installed only by an explicit organizer command. Remove each owner's matching trigger before freezing or retiring the guessing event. No production resource, trigger, OAuth grant, webhook or deployment is changed by a repository update alone.

If a bot token leaks, revoke it through BotFather, create a replacement token, update Script Properties, then reset the affected webhook. If a webhook key leaks, remove the affected webhook before rotating both the Apps Script property and matching Worker secret. Deleting a secret from the latest commit does not remove it from repository history; rotate it and remove it from every reachable history reference before release.
