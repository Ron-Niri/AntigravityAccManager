const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./core.cjs');
const { signIn } = require('./oauth.cjs');
const ACCOUNT_KEY = 'agm.accounts.v1';
const ROLLBACK_KEY = 'agm.rollback.v1';

function activate(context) {
  let panel, busy = false, notice = '', accounts = [], activeId = null;
  let config;
  const api = vscode.antigravityUnifiedStateSync;
  const ready = (async () => {
    const saved = await context.secrets.get(ACCOUNT_KEY);
    if (saved) accounts = JSON.parse(saved);
    config = core.installedConfig(vscode.env.appRoot);
  })();
  ready.catch(() => {});
  const save = () => context.secrets.store(ACCOUNT_KEY, JSON.stringify(accounts));
  async function render() {
    if (!panel) return;
    await panel.webview.postMessage({ type: 'state', busy, notice, activeId, supported: !!api?.OAuthPreferences,
      accounts: accounts.map(a => ({ id: a.id, email: a.email, name: a.name, tier: a.tier, checkedAt: a.checkedAt,
        error: a.error, models: (a.models || []).map(m => ({ ...m, status: core.availability(m) })) })) });
  }
  async function check(a) {
    try {
      a.token = await core.refreshToken(a.token, config);
      // Persist rotated refresh tokens even when the subsequent quota check fails.
      await save();
      const result = await core.quotas(a.token, config);
      Object.assign(a, result, { checkedAt: new Date().toISOString(), error: null });
    } catch (error) { a.error = error.message; }
    await save();
  }
  async function add(token) {
    if (token.isGcpTos) throw new Error('Use a personal Google account for this prototype.');
    token = await core.refreshToken(token, config);
    const identity = await core.profile(token);
    let a = accounts.find(a => a.id === identity.id);
    if (a) Object.assign(a, identity, { token });
    else { a = { ...identity, token, models: [] }; accounts.push(a); }
    await save();
    await check(a);
    return a;
  }
  async function switchAccount(a) {
    if (!api?.OAuthPreferences?.setOAuthTokenInfo) throw new Error('This IDE does not expose the session switching interface.');
    // Explicit click only: the prototype never automatically interrupts an agent turn.
    const choice = await vscode.window.showWarningMessage(
      `Switch the IDE to ${a.email}? Finish or stop running agent tasks first. This experimental switch restarts the language server.`,
      { modal: true }, 'Switch account');
    if (choice !== 'Switch account') return;
    a.token = await core.refreshToken(a.token, config);
    const identity = await core.profile(a.token);
    if (identity.id !== a.id) throw new Error('Account identity did not match. Switch cancelled.');
    await save();
    const previous = await api.OAuthPreferences.getOAuthTokenInfo();
    if (!previous?.accessToken) throw new Error('Sign into the IDE first so a rollback session can be saved.');
    await context.secrets.store(ROLLBACK_KEY, JSON.stringify(previous));
    try {
      await api.OAuthPreferences.setOAuthTokenInfo(a.token);
      await api.UserStatus.clearUserStatus();
      await vscode.commands.executeCommand('antigravity.restartLanguageServer');
      const applied = await api.OAuthPreferences.getOAuthTokenInfo();
      if (applied?.accessToken !== a.token.accessToken) throw new Error('IDE did not retain the selected session.');
      activeId = null;
      notice = 'Session updated. Verify the account in the IDE before continuing. Conversation continuity is not yet verified; Restore previous session is available.';
    } catch (error) {
      await api.OAuthPreferences.setOAuthTokenInfo(previous);
      await api.UserStatus.clearUserStatus();
      await vscode.commands.executeCommand('antigravity.restartLanguageServer');
      throw new Error('Switch failed; the previous session was restored.');
    }
  }
  async function action(message) {
    if (message.type === 'ready') { try { await ready; } catch (e) { notice = e.message; } await render(); return; }
    if (busy) return;
    busy = true; notice = ''; await render();
    try {
      await ready;
      const account = accounts.find(a => a.id === message.id);
      switch (message.type) {
        case 'import': {
          const token = await api?.OAuthPreferences?.getOAuthTokenInfo();
          if (!token?.accessToken) throw new Error('Sign in to Antigravity IDE first.');
          const a = await add(token); activeId = a.id;
          notice = a.error ? 'Account saved. Quota check needs attention.' : 'Current IDE account saved and quotas checked.';
          break;
        }
        case 'login': {
          const token = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
            title: 'Sign in to Google in your browser', cancellable: true }, (_, cancellation) =>
            signIn(config, url => vscode.env.openExternal(vscode.Uri.parse(url)), cancellation));
          const a = await add(token);
          notice = a.error ? 'Account saved. Quota check needs attention.' : 'Account connected and quotas checked.';
          break;
        }
        case 'refresh':
          for (const a of account ? [account] : accounts) { await check(a); await render(); }
          notice = 'Quota check finished.'; break;
        case 'switch': if (account) await switchAccount(account); break;
        case 'restore': {
          const saved = await context.secrets.get(ROLLBACK_KEY);
          if (!saved) throw new Error('No previous session has been saved.');
          const choice = await vscode.window.showWarningMessage('Restore the previous IDE account and restart its language server? Stop running agent tasks first.', { modal: true }, 'Restore');
          if (choice !== 'Restore') break;
          const token = await core.refreshToken(JSON.parse(saved), config);
          await api.OAuthPreferences.setOAuthTokenInfo(token);
          await api.UserStatus.clearUserStatus();
          await vscode.commands.executeCommand('antigravity.restartLanguageServer');
          activeId = null; notice = 'Previous session restored. Verify the account in the IDE.'; break;
        }
        case 'remove':
          if (account && await vscode.window.showWarningMessage(`Remove ${account.email} from this manager?`, { modal: true }, 'Remove') === 'Remove') {
            accounts = accounts.filter(a => a.id !== account.id); await save(); notice = 'Account removed from the manager. Google authorization is unchanged.';
          } break;
      }
    } catch (error) { notice = error.message || 'Operation failed.'; }
    finally { busy = false; await render(); }
  }
  context.subscriptions.push(vscode.commands.registerCommand('agm.open', () => vscode.commands.executeCommand('agm.accounts.focus')));
  context.subscriptions.push(vscode.commands.registerCommand('agm.refresh', () => action({ type: 'refresh' })));
  context.subscriptions.push(vscode.commands.registerCommand('agm.connect', () => action({ type: 'login' })));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('agm.accounts', { resolveWebviewView(view) {
    panel = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
    const nonce = crypto.randomBytes(24).toString('base64');
    let html = fs.readFileSync(path.join(context.extensionPath, 'media', 'panel.html'), 'utf8');
    html = html.replaceAll('{{csp}}', panel.webview.cspSource).replaceAll('{{nonce}}', nonce)
      .replace('{{css}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.css')).toString())
      .replace('{{readiness}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'readiness.js')).toString())
      .replace('{{js}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.js')).toString());
    panel.webview.html = html;
    panel.webview.onDidReceiveMessage(action, null, context.subscriptions);
    panel.onDidDispose(() => { if (panel === view) panel = null; }, null, context.subscriptions);
  } }, { webviewOptions: { retainContextWhenHidden: true } }));
  const timer = setInterval(() => { render().catch(() => {}); }, 30000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  // Development hosts can share the signed-in IDE profile. Unlike the CLI test
  // mode, this does not require closing every existing IDE window.
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    const startup = setTimeout(async () => {
      try {
        await vscode.commands.executeCommand('agm.open');
      } catch { /* The smoke report records integration failures without secrets. */ }
    }, 1000);
    context.subscriptions.push({ dispose: () => clearTimeout(startup) });
  }
}
module.exports = { activate };
