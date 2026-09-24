# Changelog

## 0.5.6

- Hide rolling seven-day reset timestamps for models whose quota is reported as full.
- Show exhausted accounts and their reset times in a collapsed selected-model summary.
- Recheck exhausted quotas when their reported reset time passes, with bounded retries.

## 0.5.5

- Close each completed Chrome login window through a uniquely targeted Windows message.
- Style the OAuth completion page and fix its manual close control under the page security policy.
- Collapse the selected-model account list and hide exhausted accounts while a model is selected.

## 0.5.4

- Open Chrome imports in dedicated app windows and close each window automatically after its OAuth callback succeeds or is cancelled.
- Keep account cards collapsed by default while preserving explicitly opened cards.

## 0.5.3

- Skip Chrome accounts that are already connected or duplicated across profiles.
- Skip abandoned Chrome authorization windows after 45 seconds instead of blocking the remaining batch.

## 0.5.2

- Enumerate every Google account recorded in each Chrome profile instead of importing only the primary account.
- Open authorization in the owning Chrome profile with the selected account as the login hint.

## 0.5.1

- Fix sidebar controls failing to initialize in the published extension.
- Add an opt-in importer that connects selected Google Chrome profiles through OAuth.
- Add a packaged-sidebar regression check.

## 0.5.0

- Scan up to five accounts concurrently and reuse recently discovered account projects.
- Save scan results in one batch instead of writing after every request.
- Check the active account every 20 seconds in the focused IDE window.
- Keep switch offers visible in the sidebar when their notification is dismissed.
- Detect active accounts after the IDE rotates its refresh token.
- Add standard VSIX packaging, publishing instructions, and a release-file allowlist.

## 0.4.0

- Add opt-in model quota monitoring and approval-based account handoffs.

## 0.3.0

- Switch account profiles and authentication sessions together, with rollback.

## 0.2.1

- Distinguish stale quota readings from exhausted models in account summaries.

## 0.2.0

- Add an activity-bar view, model selector, provider icons, and compact account lists.

## 0.1.0

- Connect accounts and display model quotas and reset times.
