# Antigravity Account Manager

A local sidebar extension for the VS Code-based **Antigravity IDE**. Open the accounts icon in the activity bar. Connect personal Google accounts, select a model to see which accounts have fresh available quota, and inspect reset countdowns. The compact GitHub-inspired interface supports dark/light themes, collapsible accounts, provider icons and persistent filters. Session switching remains experimental.

## Validation status

On September 14, 2026, the extension activated successfully inside the installed Antigravity IDE 2.5.5. A live read using its current session returned 14 agent models, all with quota/reset data. Both session read and write methods are exposed, but the write method has not been exercised. Nine local tests pass, including OAuth callback state/PKCE, quota schema/default handling, model filtering, refresh-token preservation and error redaction. Google browser sign-in for a second account and actual account switching remain unverified. The dashboard has not undergone screenshot-based visual QA.

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

Finish/stop running IDE agent work before clicking **Switch IDE**. The prototype saves the previous session to secret storage, updates the IDE OAuth state and restarts the language server. Verify the account in the IDE afterward. **Restore previous IDE session** restores the saved session. Applying the token is not proof that server-side conversations transfer between accounts. Automatic switching and transparent continuation are not implemented.

## Storage and compatibility

Account credentials and quota snapshots use VS Code `SecretStorage`. They are never posted to the webview, logged, or saved as project JSON. Removing an account removes its manager entry; it does not revoke Google consent or clear the separate rollback session. Sign-in uses an ephemeral loopback callback, random state and PKCE. The OAuth client configuration is read from the installed IDE's shipped application code; this is an unofficial integration and may stop working after updates. No client credentials are hardcoded in this repository.

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
