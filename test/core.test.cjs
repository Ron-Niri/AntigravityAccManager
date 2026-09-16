const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModels, availability, refreshToken, quotas } = require('../src/core.cjs');
const { signIn } = require('../src/oauth.cjs');
const { createHash } = require('node:crypto');
const { summarize } = require('../media/readiness.js');
const { switchSession } = require('../src/switch.cjs');
const { scanAccounts } = require('../src/scan.cjs');
const { profilesFromState, profileAccounts, uniqueAccounts } = require('../src/chrome.cjs');
const fs = require('node:fs');

test('account scans run concurrently with a fixed upper bound and visit every account', async () => {
  let running = 0, maximum = 0;
  const visited = [];
  await scanAccounts(Array.from({ length: 28 }, (_, id) => id), async id => {
    maximum = Math.max(maximum, ++running);
    await new Promise(resolve => setTimeout(resolve, 2));
    visited.push(id); running--;
  });
  assert.equal(maximum, 5);
  assert.equal(new Set(visited).size, 28);
});
test('packaged sidebar defines its message bridge before binding buttons', () => {
  const panel = fs.readFileSync(require.resolve('../media/panel.js'), 'utf8');
  const definition = panel.indexOf('function send(');
  assert.ok(definition >= 0);
  assert.ok(definition < panel.indexOf('send(name)'));
  for (const control of ['login', 'import', 'chromeImport', 'refresh', 'restore']) assert.match(panel, new RegExp(`['\"]${control}['\"]`));
});
test('Chrome profile discovery uses public profile metadata only', () => {
  assert.deepEqual(profilesFromState({ profile: { info_cache: {
    'Profile 2': { name: 'Work', user_name: 'work@example.com' },
    Default: { name: 'Personal' }
  } } }), [
    { directory: 'Default', name: 'Personal', email: '' },
    { directory: 'Profile 2', name: 'Work', email: 'work@example.com' }
  ]);
});
test('Chrome import enumerates every account in a profile and removes duplicate hints', () => {
  const readFile = () => JSON.stringify({ account_info: [
    { email: 'second@example.com' }, { email: 'first@example.com' }, { email: 'second@example.com' }
  ] });
  assert.deepEqual(profileAccounts('ignored', { directory: 'Profile 1', name: 'Work', email: 'first@example.com' }, readFile), [
    { directory: 'Profile 1', profileName: 'Work', email: 'second@example.com' },
    { directory: 'Profile 1', profileName: 'Work', email: 'first@example.com' }
  ]);
});
test('Chrome profile paths cannot escape the user data directory', () => {
  assert.deepEqual(profileAccounts('ignored', { directory: '..', name: 'Invalid', email: 'test@example.com' }), []);
});
test('Chrome import opens only one login for an account present in multiple profiles', () => {
  assert.deepEqual(uniqueAccounts([
    { directory: 'Default', email: 'same@example.com' },
    { directory: 'Profile 1', email: 'SAME@example.com' },
    { directory: 'Profile 1', email: 'other@example.com' }
  ]), [
    { directory: 'Default', email: 'same@example.com' },
    { directory: 'Profile 1', email: 'other@example.com' }
  ]);
});
test('warm quota checks reuse the account project instead of repeating onboarding discovery', async () => {
  const original = global.fetch, urls = [], cache = {};
  global.fetch = async url => {
    urls.push(url);
    return { ok: true, json: async () => url.endsWith(':loadCodeAssist') ? { cloudaicompanionProject: 'test-project' } : { models: {} } };
  };
  try {
    await quotas({ accessToken: 'test' }, { version: 'test' }, cache);
    await quotas({ accessToken: 'test' }, { version: 'test' }, cache);
    assert.equal(urls.filter(url => url.endsWith(':loadCodeAssist')).length, 1);
    assert.equal(urls.filter(url => url.endsWith(':fetchAvailableModels')).length, 2);
  } finally { global.fetch = original; }
});

function switchHarness(failRestart = false) {
  let token = { accessToken: 'old' }, status = 'old@example.com';
  const order = [];
  const api = {
    OAuthPreferences: { getOAuthTokenInfo: async () => token, setOAuthTokenInfo: async t => { token = t; order.push('token'); } },
    UserStatus: { getUserStatus: async () => status },
    pushUpdate: async update => { status = update.appliedUpdate.newRow.value; order.push('profile'); }
  };
  let failed = false;
  const commands = { executeCommand: async command => {
    order.push(command);
    if (command.includes('handleAuthRefresh')) assert.equal(status, token.accessToken === 'new' ? 'new@example.com' : 'old@example.com');
    if (failRestart && !failed && command.includes('restartLanguageServer')) { failed = true; throw new Error('restart failed'); }
  } };
  return { api, commands, order, codec: { decode: s => ({ email: s }) },
    target: { token: { accessToken: 'new' }, status: 'new@example.com', identity: { email: 'new@example.com' } },
    saveRollback: async previous => { assert.equal(previous.status, 'old@example.com'); order.push('backup'); } };
}
test('switch installs target profile before auth refresh and verifies the result', async () => {
  const h = switchHarness(); await switchSession(h);
  assert.deepEqual(h.order, ['backup', 'token', 'profile', 'antigravity.handleAuthRefresh', 'antigravity.restartLanguageServer']);
});
test('failed switch restores the previous token AND profile', async () => {
  const h = switchHarness(true);
  await assert.rejects(switchSession(h), /previous account and profile were restored/);
  assert.equal((await h.api.OAuthPreferences.getOAuthTokenInfo()).accessToken, 'old');
  assert.equal(await h.api.UserStatus.getUserStatus(), 'old@example.com');
});
test('failed backup prevents all session writes', async () => {
  const h = switchHarness(); h.saveRollback = async () => { throw new Error('storage failed'); };
  await assert.rejects(switchSession(h), /storage failed/); assert.deepEqual(h.order, []);
});

test('account readiness counts Gemini quota independently of exhausted Claude selection', () => {
  const account = { models: [{ id: 'claude', status: 'exhausted', fraction: 0 },
    { id: 'gemini', status: 'available', fraction: 1 }] };
  assert.equal(summarize(account).label, '1 ready');
  assert.equal(summarize(account, 'claude').ready, 0);
  assert.equal(summarize(account, 'gemini').ready, 1);
});
test('stale or failed quota checks show needs refresh instead of a false zero-ready count', () => {
  const account = { models: [{ id: 'gemini', status: 'stale', fraction: 1 }] };
  assert.equal(summarize(account).label, 'Needs refresh');
  assert.equal(summarize(account).cachedAvailable, 1);
  assert.equal(summarize({ error: 'Network failed', models: [{ status: 'available', fraction: 1 }] }).label, 'Needs refresh');
  assert.equal(summarize({ models: [{ status: 'exhausted', fraction: 0 }] }).label, '0 ready');
});

test('missing quota is unknown, zero is exhausted; invalid fractions never imply availability', () => {
  const models = normalizeModels({ models: { a: {}, b: { quotaInfo: { remainingFraction: 0 } },
    c: { quotaInfo: { remainingFraction: 0.4 } }, d: { quotaInfo: { remainingFraction: 2 } } } });
  assert.deepEqual(models.map(m => m.status), ['unknown', 'exhausted', 'available', 'unknown']);
});
test('passed reset times require rechecking; stale capacity is not presented as available', () => {
  const now = Date.now();
  const m = { checkedAt: new Date(now).toISOString(), status: 'exhausted', resetTime: new Date(now - 1000).toISOString() };
  assert.equal(availability(m, now), 'recheck');
  assert.equal(availability({ ...m, status: 'available', checkedAt: new Date(now - 360000).toISOString() }, now), 'stale');
});
test('unknown response schema fails explicitly', () => {
  assert.throws(() => normalizeModels({ arbitrary: [] }), /Unrecognized/);
  assert.throws(() => normalizeModels({ models: [] }), /Unrecognized/);
});
test('proto3 omitted scalar is zero only when its quota message is present', () => {
  const models = normalizeModels({ models: { a: {}, b: { quotaInfo: {} }, c: { quotaInfo: null },
    d: { quotaInfo: { resetTime: '2026-09-17T12:23:33Z' } } } });
  assert.deepEqual(models.map(m => m.fraction), [null, 0, null, 0]);
});
test('agent catalog excludes tab models, disabled models and internal entries', () => {
  const result = normalizeModels({ agentModelSorts: [{ groups: [{ modelIds: ['chat', 'disabled', 'internal'] }] }],
    models: { chat: {}, tab: {}, disabled: { disabled: true }, internal: { isInternal: true } } });
  assert.deepEqual(result.map(m => m.id), ['chat']);
});
test('token refresh preserves refresh token when Google omits a replacement', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'new', expires_in: 3600 }) });
  try {
    const t = await refreshToken({ refreshToken: 'old', expiryDateSeconds: 0 }, { clientId: 'id', clientSecret: 'secret' });
    assert.equal(t.refreshToken, 'old'); assert.equal(t.accessToken, 'new');
  } finally { global.fetch = original; }
});
test('quota requests use the account project and do not initiate onboarding', async () => {
  const original = global.fetch, requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => requests.length === 1 ? { cloudaicompanionProject: 'project-a' } : { models: {} } };
  };
  try {
    await quotas({ accessToken: 'test' }, { version: 'test' });
    assert.equal(requests.length, 2); assert.deepEqual(requests[1].body, { project: 'project-a' });
    assert.ok(requests[1].url.endsWith(':fetchAvailableModels'));
  } finally { global.fetch = original; }
});
test('service error bodies containing credentials are never surfaced', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'secret-credential' }) });
  try { await assert.rejects(quotas({ accessToken: 'test' }, { version: 'test' }), { message: 'Service returned HTTP 403.' }); }
  finally { global.fetch = original; }
});
test('OAuth rejects wrong state and exchanges a valid callback using matching PKCE', async () => {
  const original = global.fetch;
  let challenge, redirect;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('http://localhost:')) return original(url, options);
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    assert.equal(options.body.get('redirect_uri'), redirect);
    assert.equal(options.body.get('code'), 'test-code');
    assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), challenge);
    return { ok: true, json: async () => ({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 }) };
  };
  try {
    const token = await signIn({ clientId: 'test', clientSecret: 'test', scopes: ['test'] }, async login => {
      const auth = new URL(login);
      assert.equal(auth.searchParams.get('login_hint'), 'profile@example.com');
      assert.equal(auth.searchParams.get('prompt'), 'consent');
      challenge = auth.searchParams.get('code_challenge'); redirect = auth.searchParams.get('redirect_uri');
      const rejected = await fetch(`${redirect}?state=wrong&code=invalid`);
      assert.equal(rejected.status, 400);
      const accepted = await fetch(`${redirect}?state=${auth.searchParams.get('state')}&code=test-code`);
      assert.equal(accepted.status, 200);
      return true;
    }, undefined, { loginHint: 'profile@example.com', selectAccount: false });
    assert.equal(token.refreshToken, 'test-refresh');
  } finally { global.fetch = original; }
});
test('abandoned OAuth windows time out instead of blocking an import batch', async () => {
  await assert.rejects(signIn({ clientId: 'test', clientSecret: 'test', scopes: ['test'] }, async () => true,
    undefined, { timeoutMs: 5 }), { message: 'Sign-in timed out. Please try again.' });
});
