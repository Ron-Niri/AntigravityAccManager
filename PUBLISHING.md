# Packaging and publishing

## Build a VSIX

Requirements: Node.js 20 or newer and npm.

```sh
npm ci
npm run check
npm test
npm run package
```

This uses the official VS Code extension packager. The `.vscodeignore` allowlist includes only the runtime, interface assets, manifest, README, changelog, and license. Tests, account data, diagnostics, development scripts, and Git metadata are excluded. Re-running the build replaces the generated VSIX.

Install the result through **Extensions: Install from VSIX** in Antigravity IDE. The package requires Antigravity's account interfaces; it is not a general-purpose VS Code extension.

## Prepare the first public release

1. Choose a publisher ID you control. The existing `local-tools` ID is for local development; ownership of that registry namespace is not implied. Set `publisher` in `package.json` before the first public release. Changing it changes the extension identity and its access to previously saved extension credentials.
2. Keep the Apache 2.0 `LICENSE` in the distribution. The manifest declares `Apache-2.0`.
3. Add the public source repository URL to `package.json` if desired. No personal repository URL is embedded in this template.
4. Update the version and changelog, run the checks, and rebuild the VSIX.
5. Review the archive contents with `npx vsce ls --no-dependencies` and run `npm run audit:privacy` before uploading.

## Visual Studio Marketplace

Create or select your publisher in the Marketplace publisher-management page. Upload the generated VSIX manually, or configure the current supported authentication flow and use the official CLI. Authentication requirements can change; follow the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

The `npm run package` command only creates an artifact. It never publishes or uploads anything.

## Open VSX

Create an Eclipse account, accept its publisher agreement, and create or join the namespace matching `publisher`. Follow the [Open VSX publishing guide](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions). Once configured, upload the VSIX using `ovsx publish <package.vsix>` with the registry's documented authentication method. Keep publishing tokens outside the repository and command history.

Registry acceptance is not guaranteed: this extension uses internal Antigravity interfaces and is not affiliated with Google. Describe that dependency clearly in the listing.

## Privacy and history

`npm run audit:privacy` checks tracked files and reachable commit metadata for common credential formats, personal filesystem paths, and personal email addresses. It also checks for common generated attribution trailers. No pattern-based scanner can prove the absence of every possible secret; review release contents as well.

Rewriting a local commit does not remove copies already pushed to a remote, cached by a hosting provider, or cloned by someone else. Coordinate before replacing remote history. Never include `.runtime`, `.data`, account exports, OAuth responses, or local diagnostics in a release.

The default audit includes remote-tracking references. To inspect only the proposed local replacement before updating a remote, run `node scripts/audit-privacy.cjs --local`. This does not certify the remote history as clean.
