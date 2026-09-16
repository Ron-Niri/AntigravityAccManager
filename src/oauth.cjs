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
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/oauth-callback') { res.writeHead(404).end(); return; }
    if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid sign-in state.'); return; }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (url.searchParams.has('error')) { res.end('Sign-in was cancelled. You can close this tab.'); fail(new Error('Google sign-in was cancelled.')); return; }
    const code = url.searchParams.get('code');
    if (!code) { res.writeHead(400).end('Missing authorization code.'); return; }
    res.end('Sign-in received. Return to Antigravity Accounts. You can close this tab.');
    complete(code);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirect = `http://localhost:${server.address().port}/oauth-callback`;
  const timer = setTimeout(() => fail(new Error('Sign-in timed out. Please try again.')), 180000);
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
