# Antigravity Account Manager

A local sidebar extension for the VS Code-based **Antigravity IDE**. Open the accounts icon in the activity bar. Connect personal Google accounts, select a model to see which accounts have fresh available quota, and inspect reset countdowns. The compact GitHub-inspired interface supports dark/light themes, collapsible accounts, provider icons and persistent filters. Session switching remains experimental.

## Validation status

On September 15, 2026, a live test in Antigravity IDE 2.5.5 prepared a different saved account with 14 agent models, switched its OAuth token and profile, refreshed authentication, restarted the language server, verified the target session, and restored the original account. Fourteen local tests pass, including switching order, complete rollback and failed-backup protection. This verifies account switching, not transfer of an already-running server-side conversation. The dashboard has not undergone screenshot-based visual QA.

## Run

Requires the installed Antigravity IDE and Node 20+. No npm dependencies.

```powershell
npm test
npm run check
& "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --new-window --extensionDevelopmentPath="$PWD"
```

Click the activity-bar accounts icon, or run **Antigravity Accounts: Open Sidebar**. Choose **Use IDE account**, or **Connect account** and complete Google's sign-in in your browser. Repeat for another account. The model selector lists which accounts have fresh available quota; **Available only** hides exhausted/stale readings. Hover a reset countdown for the exact local date/time. Connect only accounts you own or are authorized to use.

For a normal installation, build once with `powershell -File scripts/package.ps1`, then install the generated VSIX using **Extensions: Install from VSIX**. Rebuilding requires a new output filename/version or removing the previous generated VSIX. Account storage uses the same extension identity as version 0.1.0.

Quota checks are explicit, do not send generation requests, and do not accept onboarding terms. If an account needs onboarding, complete that in Antigravity first. Cached readings become stale after five minutes; a passed reset timestamp requires a fresh check. Models may share quota buckets, so percentages are not additive. An absent quota message means unknown; an omitted fraction inside a quota message means zero under the observed proto3 schema. The IDE's agent model catalog is used to exclude tab-completion and other auxiliary models.

## Switching

### Quota monitor

Select a model in the sidebar and enable **Ask to switch when quota runs out**. The extension checks the active saved account every 60 seconds, including while the sidebar is hidden. Confirmed zero quota triggers fresh checks of subsequent saved accounts, wrapping around the list. The first account with positive quota is offered in an IDE notification. **Switch account** approves that specific switch; **Later (10 min)** or dismissing the notification snoozes it; **Stop monitoring** disables the feature. The approved target and current account are checked again before switching. After a successful switch the same model is monitored on the new active account, so the process repeats as needed.

The model and enabled setting persist across reloads. Only one IDE window owns the monitor at a time to prevent duplicate prompts; configure it in that window. Checks do not send model prompts or consume generation quota. Unknown quotas/network errors never trigger switching. If no alternative is confirmed, the sidebar explains that the next scan is in five minutes. Detection is polling-based, so it can lag usage exhaustion by a check interval plus service response time. Selecting a model here monitors its quota; it does not change the model selected in an IDE conversation.

The monitor has automated tests for successive handoffs, approval/dismissal/stop, unavailable accounts, stale approvals, retry throttling and window ownership. An actual quota-exhaustion event has not been forced in live usage.

Finish/stop running IDE agent work before clicking **Switch account**. The extension fetches the target account's profile, settings and model catalog before changing the session. It then saves the previous token and profile to secret storage, updates both, refreshes the IDE's authentication provider and restarts the language server. The switch succeeds only after the token and profile match the target account. A failure attempts to restore both previous values and reports if restoration cannot be verified. **Restore previous session** restores the saved account. The current account is marked **Active**. Automatic switching and transparent continuation of existing server-side conversations are not implemented.

## Storage and compatibility

Account credentials and quota snapshots use VS Code `SecretStorage`. Credentials are never posted to the webview, logged, or saved as project JSON. Removing an account removes its manager entry; it does not revoke Google consent or clear the separate rollback session. Sign-in uses an ephemeral loopback callback, random state and PKCE. OAuth configuration and protobuf schema data are read from the installed IDE's shipped application code, without evaluating that code. Profile serialization uses the IDE's bundled protobuf library. This is an unofficial integration and may stop working after updates. No client credentials are hardcoded in this repository.

Observed in Antigravity IDE 2.5.5 / VS Code base 1.107.0:

- `antigravityUnifiedStateSync.OAuthPreferences.getOAuthTokenInfo/setOAuthTokenInfo`
- `antigravityUnifiedStateSync.UserStatus.clearUserStatus`
- `antigravity.restartLanguageServer`
- `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`
- `https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`

The IDE's quota-summary UI also uses the language server's `retrieveUserQuotaSummary`. This prototype uses per-model `quotaInfo` from `fetchAvailableModels`; it does not yet collect all short/long-term bucket details from the language server.

Google's public documentation: [model quotas](https://antigravity.google/docs/cli/commands/usage), [quota status fields](https://antigravity.google/docs/cli/statusline/). These documents do not promise support for this extension's internal interfaces.

## Read-only IDE smoke check

```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --new-window --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD\test\ide-smoke.cjs"
```

Writes a credential-free capability and model report to ignored `.runtime/ide-smoke.json`. It does not switch accounts or refresh tokens. The CLI test mode requires all other IDE instances to be closed. Normal sidebar opening does not run this diagnostic. Two-account login/switching must be verified interactively; unit tests do not establish live compatibility.
