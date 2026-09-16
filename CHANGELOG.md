# Changelog

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
