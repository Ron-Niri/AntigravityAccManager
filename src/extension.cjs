const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./core.cjs');
const { signIn } = require('./oauth.cjs');
const { loadCodec } = require('./ide-state.cjs');
const switching = require('./switch.cjs');
const { QuotaMonitor } = require('./monitor.cjs');
const ACCOUNT_KEY = 'agm.accounts.v1';
const ROLLBACK_KEY = 'agm.rollback.v1';

function activate(context) {
  let panel, busy = false, notice = '', accounts = [], activeId = null;
  let config;
  let monitorConfig = { enabled: false, modelId: '', revision: 0, ...context.globalState.get('agm.monitor.v1', {}) };
  let monitorStatus = monitorConfig.enabled ? 'Waiting for the first quota check…' : 'Select a model to enable monitoring.';
  let codec;
  const getCodec = () => codec ||= loadCodec(vscode.env.appRoot);
  const api = vscode.antigravityUnifiedStateSync;
  const ready = (async () => {
    const saved = await context.secrets.get(ACCOUNT_KEY);
    if (saved) accounts = JSON.parse(saved);
    config = core.installedConfig(vscode.env.appRoot);
  })();
  ready.catch(() => {});
  const save = () => context.secrets.store(ACCOUNT_KEY, JSON.stringify(accounts));
  async function activeAccount() {
    const token = await api?.OAuthPreferences?.getOAuthTokenInfo();
    return accounts.find(a => a.token.refreshToken && a.token.refreshToken === token?.refreshToken);
  }
  async function render() {
    if (!panel) return;
    try {
      const token = await api?.OAuthPreferences?.getOAuthTokenInfo();
      activeId = accounts.find(a => a.token.refreshToken && a.token.refreshToken === token?.refreshToken)?.id || null;
    } catch { activeId = null; }
    await panel.webview.postMessage({ type: 'state', busy, notice, activeId, monitor: { ...monitorConfig, status: monitorStatus }, supported: !!api?.OAuthPreferences,
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
  async function switchAccount(a, confirmed = false) {
    if (!api?.OAuthPreferences?.setOAuthTokenInfo) throw new Error('This IDE does not expose the session switching interface.');
    // Explicit click only: the prototype never automatically interrupts an agent turn.
    const choice = confirmed ? 'Switch account' : await vscode.window.showWarningMessage(
      `Switch the IDE to ${a.email}? Finish or stop running agent tasks first. This experimental switch restarts the language server.`,
      { modal: true }, 'Switch account');
    if (choice !== 'Switch account') return;
    const target = await switching.prepare(a.token, config, getCodec(), a.id);
    a.token = target.token;
    await save();
    await switching.switchSession({ api, commands: vscode.commands, codec: getCodec(), target,
      saveRollback: previous => context.secrets.store(ROLLBACK_KEY, JSON.stringify(previous)) });
    activeId = a.id;
    notice = `Switched to ${a.email}. Account profile and IDE session verified.`;
  }
  async function action(message) {
    if (message.type === 'ready') { try { await ready; } catch (e) { notice = e.message; } await render(); return; }
    if (message.type === 'monitor') {
      await ready;
      const modelId = typeof message.modelId === 'string' ? message.modelId : '';
      if (message.enabled && !accounts.some(a => a.models.some(m => m.id === modelId))) return;
      monitorConfig = { enabled: !!message.enabled, modelId, revision: monitorConfig.revision + 1 };
      await context.globalState.update('agm.monitor.v1', monitorConfig);
      monitorStatus = monitorConfig.enabled ? 'Waiting for the first quota check…' : 'Monitoring off.';
      if (!monitorConfig.enabled && !monitor.running) monitor.releaseLease();
      await render();
      if (monitorConfig.enabled) void monitor.tick();
      return;
    }
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
          const previous = JSON.parse(saved);
          // Support rollback entries written by the token-only prototype.
          const target = await switching.prepare(previous.token || previous, config, getCodec());
          await switching.switchSession({ api, commands: vscode.commands, codec: getCodec(), target,
            saveRollback: current => context.secrets.store(ROLLBACK_KEY, JSON.stringify(current)) });
          notice = `Restored ${target.identity.email}. Account profile and IDE session verified.`; break;
        }
        case 'remove':
          if (account && await vscode.window.showWarningMessage(`Remove ${account.email} from this manager?`, { modal: true }, 'Remove') === 'Remove') {
            accounts = accounts.filter(a => a.id !== account.id); await save(); notice = 'Account removed from the manager. Google authorization is unchanged.';
          } break;
      }
    } catch (error) { notice = error.message || 'Operation failed.'; }
    finally { busy = false; await render(); }
  }
  const monitor = new QuotaMonitor({
    config: () => monitorConfig, accounts: () => accounts, activeAccount,
    isBusy: () => busy,
    check: async a => { if (busy) throw new Error('Another account operation is running.'); busy = true; try { await check(a); } finally { busy = false; await render(); } },
    status: text => { monitorStatus = text; void render(); },
    ask: async (active, next, modelId) => {
      const label = active.models.find(m => m.id === modelId)?.label || modelId;
      const answer = await vscode.window.showWarningMessage(
        `${label} quota is exhausted on ${active.email}. Switch to ${next.email}, which has quota left? Switching restarts the language server; stop any running agent task first.`,
        'Switch account', 'Later (10 min)', 'Stop monitoring');
      return answer === 'Switch account' ? 'switch' : answer === 'Stop monitoring' ? 'stop' : 'later';
    },
    stop: () => action({ type: 'monitor', enabled: false, modelId: monitorConfig.modelId }),
    switchAccount: async a => { if (busy) throw new Error('Another account operation is running.'); busy = true; try { await switchAccount(a, true); } finally { busy = false; await render(); } }
  });
  const monitorTimer = setInterval(() => { void ready.then(() => monitor.tick()).catch(() => {}); }, 60000);
  context.subscriptions.push({ dispose: () => { monitorConfig = { ...monitorConfig, enabled: false }; monitor.releaseLease(); clearInterval(monitorTimer); } });
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
        const request = path.join(context.extensionPath, '.runtime', 'switch-check.request');
        if (fs.existsSync(request)) {
          const mode = fs.readFileSync(request, 'utf8').trim();
          fs.unlinkSync(request);
          await require('../test/switch-live.cjs').run(context, vscode, mode);
        }
        await vscode.commands.executeCommand('agm.open');
      } catch { /* Development diagnostics write their own credential-free report. */ }
    }, 1000);
    context.subscriptions.push({ dispose: () => clearTimeout(startup) });
  }
}
module.exports = { activate };
