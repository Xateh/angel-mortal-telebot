# Security

Store Google Apps Script bot tokens, webhook keys, workbook identifiers, support handles, and optional admin/test Telegram IDs in Apps Script Script Properties. Participant Telegram IDs and participant records remain only in the private Form response and roster Sheets. Store gateway `APPS_SCRIPT_URL` and webhook keys in encrypted Worker secrets; never commit either location's values.

Keep `.env`, `.dev.vars`, `.clasp.json`, `.wrangler`, logs, exports, snapshots, credentials, and private verification files untracked. Before release, run `python scripts/verify_repository.py` with release mode and a nonempty ignored private denylist as documented in the README.

If a bot token leaks, revoke it through BotFather, create a replacement token, update Script Properties, then reset the affected webhook. If a webhook key leaks, remove the affected webhook before rotating both the Apps Script property and matching Worker secret. Deleting a secret from the latest commit does not remove it from repository history; rotate it and remove it from every reachable history reference before release.
