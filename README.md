# Antigravity Account Manager

**Find an account with quota. Switch without another sign-in.**

A sidebar extension for Antigravity IDE that brings your Google accounts, model quotas, and reset times into one view.

## What it does

| Feature | Details |
| --- | --- |
| Account overview | Remaining quota and reset countdowns for each account’s agent models. |
| Model availability | Select a model to see which accounts can run it now. |
| Fast refresh | Check up to five accounts at once, with progress shown as results arrive. |
| Account switching | Switch the IDE session and profile together. Restore the previous session when needed. |
| Quota monitor | Detect exhaustion and offer the next account with available quota. Every switch requires your approval. |
| Local credential storage | Credentials stay in the IDE’s encrypted secret storage. |

## Get started

1. Install the VSIX through **Extensions: Install from VSIX** in Antigravity IDE, then reload the window.
2. Open the **Accounts** icon in the activity bar.
3. Choose **Use IDE account** to save your current session, **Connect account** to sign in through Google, or **Import Chrome profiles** to connect several Chrome profiles in sequence.
4. Add your other accounts. Select a model or use the search box to narrow the list.

Use accounts you own or are authorized to access. New accounts must complete Antigravity’s onboarding in the IDE before they can be used here.

Chrome import reads Chrome's profile names and account email hints from its local profile metadata, including multiple Google accounts within one profile. It does not read cookies or passwords. You choose the accounts, and Google authorization opens in each account's Chrome profile; each account still requires its own explicit OAuth approval.

Accounts already connected to the extension, and duplicate account hints found in more than one Chrome profile, are skipped automatically. If an authorization window is closed or abandoned, that account times out after 45 seconds and the batch continues with the next account.

Chrome authorization uses a temporary app window. After Google returns the authorization result, that window closes automatically before the next account starts. If Chrome blocks automatic closing, the callback page also includes a **Close window** button.

## Switch accounts

Choose **Switch account** on a saved account. Finish or stop running agent tasks first: switching restarts the language server. The extension verifies the resulting token and profile, marks the account **Active**, and saves the previous session for restoration.

To undo a switch, expand **Session controls** and choose **Restore previous session**. Switching does not guarantee that an existing server-side conversation can continue under a different account.

## Watch a model’s quota

Select a model and enable **Ask to switch when quota runs out**.

- The focused IDE window checks the active account every **20 seconds**, even when the sidebar is hidden.
- When quota reaches zero, it checks other saved accounts in order, in small parallel batches.
- A notification and a persistent sidebar offer identify the next account with confirmed quota.
- Choose **Switch account**, **Later**, or **Stop**. Closing the notification leaves the sidebar offer available.
- After an approved switch, the same model is monitored on the new account.

The monitor rechecks both accounts before switching. Network errors and missing quota information do not count as exhaustion. **Later** pauses reminders for ten minutes; if no alternative has quota, the next search runs after five minutes. Monitoring resumes when an Antigravity window gains focus. Choosing a model here does not change the model selected in your conversation.

## Reading the results

| Status | Meaning |
| --- | --- |
| Available | The last fresh check reported positive quota. |
| Exhausted | The service reported zero quota. |
| Needs refresh / Stale | Cached data is over five minutes old, or the last request failed. |
| Recheck | A reported reset time has passed; availability needs confirmation. |
| Unknown | The service did not report usable quota information. |

Hover a reset countdown to see the exact local date and time. A full-quota model does not show a countdown: the service may report a rolling seven-day timestamp while quota is full, which is not a useful renewal estimate. The focused IDE window rechecks exhausted accounts when their reported reset times pass, then backs off between retries if they still have no quota. Some models share quota buckets, so their percentages should not be added together. Service response times and polling intervals mean detection is not instantaneous.

Selecting a model shows only accounts with fresh quota for that model. The collapsed summaries account for every connected account: ready, waiting for reset, needing refresh, or not offered that model. A cached exhausted reading keeps its last reported reset time; an expired positive reading moves to **Need refresh** until confirmed again. Use **Refresh accounts** to update those readings.

## Privacy

- OAuth credentials and account snapshots use the IDE’s `SecretStorage`.
- Credentials are not sent to the sidebar, logged, or stored in project files.
- Requests go directly to Google’s authentication and Antigravity services; there is no intermediary service or extension telemetry.
- Removing an account deletes its manager entry. It does not revoke Google consent or clear a separate saved rollback session.

## Compatibility

Requires the **VS Code-based Antigravity IDE**. Account integration has been tested with Antigravity IDE 2.5.5. Quota requests use the Cloud Code service host configured by the running IDE. This extension depends on internal account interfaces and schemas shipped with the IDE; an IDE update may require an extension update. It does not intercept TLS traffic.

This is an independent project, not an official Google extension. Provider names and logos belong to their respective owners.

## Build from source

```sh
npm ci
npm run check
npm test
npm run package
```

The resulting VSIX is ready to install locally. See [Publishing](PUBLISHING.md) for publisher setup and registry uploads, and [Changelog](CHANGELOG.md) for release notes.

To run a development window on Windows:

```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --new-window --extensionDevelopmentPath="$PWD"
```

## License

Copyright 2026 Antigravity Account Manager contributors. Licensed under the [Apache License 2.0](LICENSE). Third-party names and trademarks belong to their respective owners.

## Troubleshooting

**The sidebar icon is missing:** run **Developer: Reload Window**, then **Antigravity Accounts: Open Sidebar** from the command palette.

**The monitor finds exhaustion but no notification appears:** open the sidebar; pending offers remain there. Make sure monitoring is enabled for the intended model and that the active account is saved. Monitoring runs in the focused IDE window.

**An account needs to sign in again:** reconnect it through **Connect account**. Refresh-token rotation is handled automatically when the IDE profile can identify the saved account.

**A quota check fails:** retry with **Refresh**. If onboarding is incomplete, sign in to that account in Antigravity and finish onboarding first.
