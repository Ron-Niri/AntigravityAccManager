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
    return { nonce, html: `<!doctype html><meta charset="utf-8"><title>Antigravity Accounts</title><p>${message}</p><button onclick="window.close()">Close window</button><script nonce="${nonce}">setTimeout(()=>window.close(),100);</script>` };
  }
  function respond(res, message) {
    const page = callbackPage(message);
    res.setHeader('Cache-Control', 'no-store');
    if (typeof page === 'string') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(page); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${page.nonce}'; style-src 'none'`);
    res.end(page.html);
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/oauth-callback') { res.writeHead(404).end(); return; }
    if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid sign-in state.'); return; }
    if (url.searchParams.has('error')) { respond(res, 'Sign-in was cancelled.'); fail(new Error('Google sign-in was cancelled.')); return; }
    const code = url.searchParams.get('code');
    if (!code) { res.writeHead(400).end('Missing authorization code.'); return; }
    respond(res, options.closeWindow ? 'Sign-in received. This window will close automatically.' : 'Sign-in received. Return to Antigravity Accounts. You can close this tab.');
    complete(code);
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
