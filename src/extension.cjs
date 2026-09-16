const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./core.cjs');
const { signIn } = require('./oauth.cjs');
const { loadCodec } = require('./ide-state.cjs');
const switching = require('./switch.cjs');
const { QuotaMonitor } = require('./monitor.cjs');
const { scanAccounts } = require('./scan.cjs');
const chrome = require('./chrome.cjs');
const ACCOUNT_KEY = 'agm.accounts.v1';
const ROLLBACK_KEY = 'agm.rollback.v1';

function activate(context) {
  let panel, busy = false, notice = '', accounts = [], activeId = null;
  let config;
  let pendingOffer = null;
  let resolveOffer;
  function finishOffer(answer) { const resolve = resolveOffer; resolveOffer = null; pendingOffer = null; resolve?.(answer); void render(); }
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
    const match = accounts.find(a => a.token.refreshToken && a.token.refreshToken === token?.refreshToken || a.token.accessToken && a.token.accessToken === token?.accessToken);
    if (match) return match;
    if (!token?.accessToken) return undefined;
    // Refresh tokens can rotate independently in the IDE. Resolve identity from
    // the current profile instead of silently losing the active-account match.
    const serialized = await api.UserStatus.getUserStatus();
    const email = serialized ? getCodec().decode(serialized).email : null;
    const account = accounts.find(a => email && a.email.toLowerCase() === email.toLowerCase());
    if (account) account.token = token;
    return account;
  }
  async function render() {
    if (!panel) return;
    try {
      activeId = (await activeAccount())?.id || null;
    } catch { activeId = null; }
    await panel.webview.postMessage({ type: 'state', busy, notice, activeId, pendingOffer, monitor: { ...monitorConfig, status: monitorStatus }, supported: !!api?.OAuthPreferences,
      accounts: accounts.map(a => ({ id: a.id, email: a.email, name: a.name, tier: a.tier, checkedAt: a.checkedAt,
        error: a.error, models: (a.models || []).map(m => ({ ...m, status: core.availability(m) })) })) });
  }
  async function check(a, persist = true) {
    try {
      a.token = await core.refreshToken(a.token, config);
      const result = await core.quotas(a.token, config, a.quotaCache ||= {});
      Object.assign(a, result, { checkedAt: new Date().toISOString(), error: null });
    } catch (error) { a.error = error.message; }
    if (persist) await save();
  }
  async function checkMany(list) {
    try {
      await scanAccounts(list, a => check(a, false), { onProgress: (done, total) => {
        notice = `Checked ${done}/${total} accounts`; void render();
      } });
    } finally { await save(); }
  }
  async function add(token) {
    if (token.isGcpTos) throw new Error('Only personal Google accounts are supported.');
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
    // Manual switches and monitor offers each require explicit approval.
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
    if (message.type === 'monitorAnswer') {
      if (pendingOffer?.id === message.id && ['switch', 'later', 'stop'].includes(message.answer)) finishOffer(message.answer);
      return;
    }
    if (message.type === 'ready') { try { await ready; } catch (e) { notice = e.message; } await render(); return; }
    if (message.type === 'monitor') {
      await ready;
      const modelId = typeof message.modelId === 'string' ? message.modelId : '';
      if (message.enabled && !accounts.some(a => a.models.some(m => m.id === modelId))) return;
      monitorConfig = { enabled: !!message.enabled, modelId, revision: monitorConfig.revision + 1 };
      finishOffer('cancelled');
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
        case 'chromeImport': {
          const found = chrome.discover();
          if (!found.executable || !found.profiles.length) throw new Error('No Google Chrome profiles were found on this device.');
          if (!found.accounts.length) throw new Error('Chrome did not report any Google accounts in its profiles.');
          const savedEmails = new Set(accounts.map(account => account.email.toLowerCase()));
          const pendingAccounts = found.accounts.filter(account => !savedEmails.has(account.email.toLowerCase()));
          if (!pendingAccounts.length) { notice = 'All Chrome accounts are already connected.'; break; }
          const selected = await vscode.window.showQuickPick(pendingAccounts.map(account => ({
            label: account.email,
            description: `Chrome profile: ${account.profileName}`,
            account,
            picked: true
          })), { canPickMany: true, placeHolder: 'Choose Google accounts to connect', title: 'Import accounts from Chrome' });
          if (!selected?.length) { notice = 'Chrome profile import cancelled.'; break; }
          const failures = [];
          let connected = 0;
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
            title: 'Connecting Chrome profiles', cancellable: true }, async (progress, cancellation) => {
            for (let index = 0; index < selected.length; index++) {
              if (cancellation.isCancellationRequested) break;
              const item = selected[index];
              progress.report({ message: `${item.label} (${index + 1}/${selected.length})` });
              try {
                const token = await signIn(config, url => chrome.openProfile(found.executable, item.account.directory, url), cancellation,
                  { loginHint: item.account.email, selectAccount: false, timeoutMs: 45000, closeWindow: true });
                await add(token);
                connected++;
              } catch {
                if (cancellation.isCancellationRequested) break;
                failures.push(item.label);
              }
            }
          });
          notice = `${connected} Chrome profile${connected === 1 ? '' : 's'} connected.` +
            (failures.length ? ` ${failures.length} skipped or failed.` : '');
          break;
        }
        case 'refresh':
          await checkMany(account ? [account] : accounts);
          notice = 'Quota check finished.'; break;
        case 'switch': if (account) await switchAccount(account); break;
        case 'restore': {
          const saved = await context.secrets.get(ROLLBACK_KEY);
          if (!saved) throw new Error('No previous session has been saved.');
          const choice = await vscode.window.showWarningMessage('Restore the previous IDE account and restart its language server? Stop running agent tasks first.', { modal: true }, 'Restore');
          if (choice !== 'Restore') break;
          const previous = JSON.parse(saved);
          // Support the rollback format used before version 0.3.
          const target = await switching.prepare(previous.token || previous, config, getCodec());
          await switching.switchSession({ api, commands: vscode.commands, codec: getCodec(), target,
            saveRollback: current => context.secrets.store(ROLLBACK_KEY, JSON.stringify(current)) });
          notice = `Restored ${target.identity.email}. Account profile and IDE session verified.`; break;
        }
        case 'github':
          void vscode.env.openExternal(vscode.Uri.parse('https://github.com/Ron-Niri/AntigravityAccManager'));
          break;
        case 'remove':
          if (account && await vscode.window.showWarningMessage(`Remove ${account.email} from this manager?`, { modal: true }, 'Remove') === 'Remove') {
            accounts = accounts.filter(a => a.id !== account.id); await save(); notice = 'Account removed from the manager. Google authorization is unchanged.';
          } break;
      }
    } catch (error) { notice = error.message || 'Operation failed.'; }
    finally { busy = false; await render(); if (message.type === 'refresh') void monitor.tick(); }
  }
  const monitor = new QuotaMonitor({
    config: () => monitorConfig, accounts: () => accounts, activeAccount,
    isBusy: () => busy,
    isFocused: () => vscode.window.state.focused,
    check: async a => { if (busy) throw new Error('Another account operation is running.'); busy = true; try { await check(a); } finally { busy = false; await render(); } },
    checkMany: async list => { if (busy) throw new Error('Another account operation is running.'); busy = true; try { await checkMany(list); } finally { busy = false; await render(); } },
    status: text => { monitorStatus = text; void render(); },
    ask: async (active, next, modelId) => {
      const label = active.models.find(m => m.id === modelId)?.label || modelId;
      pendingOffer = { id: crypto.randomUUID(), from: active.email, to: next.email, model: label };
      const offerId = pendingOffer.id;
      const result = new Promise(resolve => { resolveOffer = resolve; });
      await render();
      void vscode.window.showWarningMessage(
        `${label} quota is exhausted on ${active.email}. Switch to ${next.email}, which has quota left? Switching restarts the language server; stop any running agent task first.`,
        'Switch account', 'Later (10 min)', 'Stop monitoring').then(answer => {
          if (!answer || pendingOffer?.id !== offerId) return;
          finishOffer(answer === 'Switch account' ? 'switch' : answer === 'Stop monitoring' ? 'stop' : 'later');
        });
      // Dismissing the toast leaves the offer visible in the sidebar.
      const expiry = setTimeout(() => { if (pendingOffer?.id === offerId) finishOffer('later'); }, 10 * 60000);
      try { return await result; } finally { clearTimeout(expiry); }
    },
    stop: () => action({ type: 'monitor', enabled: false, modelId: monitorConfig.modelId }),
    switchAccount: async a => { if (busy) throw new Error('Another account operation is running.'); busy = true; try { await switchAccount(a, true); } finally { busy = false; await render(); } }
  });
  const monitorTimer = setInterval(() => { void ready.then(() => monitor.tick()).catch(() => {}); }, 20000);
  context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
    if (!state.focused) finishOffer('cancelled');
    else void ready.then(() => monitor.tick()).catch(() => {});
  }));
  context.subscriptions.push({ dispose: () => { monitorConfig = { ...monitorConfig, enabled: false }; finishOffer('cancelled'); monitor.releaseLease(); clearInterval(monitorTimer); } });
  context.subscriptions.push(vscode.commands.registerCommand('agm.open', () => vscode.commands.executeCommand('agm.accounts.focus')));
  context.subscriptions.push(vscode.commands.registerCommand('agm.refresh', () => action({ type: 'refresh' })));
  context.subscriptions.push(vscode.commands.registerCommand('agm.connect', () => action({ type: 'login' })));
  context.subscriptions.push(vscode.commands.registerCommand('agm.openGithub', () => {
    void vscode.env.openExternal(vscode.Uri.parse('https://github.com/Ron-Niri/AntigravityAccManager'));
  }));
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
        const scanRequest = path.join(context.extensionPath, '.runtime', 'scan-check.request');
        if (fs.existsSync(scanRequest)) {
          fs.unlinkSync(scanRequest);
          await require('../test/scan-live.cjs').run(context, vscode);
        }
        await vscode.commands.executeCommand('agm.open');
      } catch { /* Development diagnostics write their own credential-free report. */ }
    }, 1000);
    context.subscriptions.push({ dispose: () => clearTimeout(startup) });
  }
}
module.exports = { activate };
