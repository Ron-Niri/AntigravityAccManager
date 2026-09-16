const http = require('node:http');
const { randomBytes, createHash } = require('node:crypto');
const { jsonRequest } = require('./core.cjs');

async function signIn(config, openExternal, cancellation, options = {}) {
  const state = randomBytes(32).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  let complete, fail;
  const codePromise = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  // Attach immediately so cancellation during browser launch is handled.
  codePromise.catch(() => {});
  function callbackPage(message) {
    if (!options.closeWindow) return message;
    const nonce = randomBytes(18).toString('base64');
    const windowTitle = `Antigravity OAuth ${randomBytes(8).toString('hex')}`;
    return { nonce, windowTitle, html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${windowTitle}</title><style nonce="${nonce}">:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;font:14px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(420px,calc(100% - 32px));padding:28px;border:1px solid #30363d;border-radius:12px;background:#161b22;box-shadow:0 18px 48px #0008}.mark{width:42px;height:42px;display:grid;place-items:center;margin-bottom:18px;border:1px solid #2ea043;border-radius:50%;background:#12261a;color:#3fb950;font-size:22px}h1{margin:0 0 6px;font-size:19px;letter-spacing:-.01em}p{margin:0;color:#8b949e}.status{margin-top:18px;padding-top:16px;border-top:1px solid #30363d;font-size:12px}button{width:100%;margin-top:18px;padding:9px 12px;border:1px solid #2ea043;border-radius:7px;background:#238636;color:white;font:600 13px inherit;cursor:pointer}button:hover{background:#2ea043}button:focus-visible{outline:2px solid #58a6ff;outline-offset:2px}</style></head><body><main class="shell"><div class="mark" aria-hidden="true">✓</div><h1>Account connected</h1><p>${message}</p><p class="status">Returning to Antigravity Account Manager…</p><button id="close" type="button">Close this window</button></main><script nonce="${nonce}">document.getElementById('close').addEventListener('click',()=>window.close());setTimeout(()=>window.close(),150);</script></body></html>` };
  }
  function respond(res, message) {
    const page = callbackPage(message);
    res.setHeader('Cache-Control', 'no-store');
    if (typeof page === 'string') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(page); return null; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${page.nonce}'; style-src 'nonce-${page.nonce}'`);
    res.end(page.html);
    return options.onCloseWindow?.(page.windowTitle);
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/oauth-callback') { res.writeHead(404).end(); return; }
    if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid sign-in state.'); return; }
    if (url.searchParams.has('error')) {
      Promise.resolve(respond(res, 'Sign-in was cancelled.')).catch(() => {}).finally(() => fail(new Error('Google sign-in was cancelled.'))); return;
    }
    const code = url.searchParams.get('code');
    if (!code) { res.writeHead(400).end('Missing authorization code.'); return; }
    Promise.resolve(respond(res, options.closeWindow ? 'Sign-in received. This window will close automatically.' : 'Sign-in received. Return to Antigravity Accounts. You can close this tab.'))
      .catch(() => {}).finally(() => complete(code));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirect = `http://localhost:${server.address().port}/oauth-callback`;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 180000;
  const timer = setTimeout(() => fail(new Error('Sign-in timed out. Please try again.')), timeoutMs);
  const subscription = cancellation?.onCancellationRequested(() => fail(new Error('Sign-in cancelled.')));
  try {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    const parameters = { client_id: config.clientId, redirect_uri: redirect, response_type: 'code',
      scope: config.scopes.join(' '), access_type: 'offline', prompt: options.selectAccount === false ? 'consent' : 'consent select_account', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
    if (options.loginHint) parameters.login_hint = options.loginHint;
    url.search = new URLSearchParams(parameters).toString();
    if (!await openExternal(url.toString())) throw new Error('Could not open the sign-in browser.');
    const code = await codePromise;
    const result = await jsonRequest('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirect,
      grant_type: 'authorization_code', code_verifier: verifier
    }) });
    if (!result.access_token || !result.refresh_token || !Number.isFinite(result.expires_in)) throw new Error('Google did not provide a persistent sign-in. Try reconnecting.');
    return { accessToken: result.access_token, refreshToken: result.refresh_token,
      expiryDateSeconds: Math.floor(Date.now() / 1000) + result.expires_in, tokenType: result.token_type || 'Bearer', isGcpTos: false };
  } finally { clearTimeout(timer); subscription?.dispose(); server.closeAllConnections(); server.close(); }
}
module.exports = { signIn };
