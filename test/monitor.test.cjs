const { test } = require('node:test');
const assert = require('node:assert/strict');
const { QuotaMonitor } = require('../src/monitor.cjs');

function harness() {
  let now = 1000, current = 'a';
  const accounts = ['a', 'b', 'c'].map(id => ({ id, email: `${id}@example.com`, models: [{ id: 'claude', fraction: id === 'a' ? 0 : 1 }] }));
  const config = { enabled: true, modelId: 'claude', revision: 1 };
  const prompts = [], switches = [], checks = [], statuses = [];
  const d = { config: () => config, accounts: () => accounts, activeAccount: async () => accounts.find(a => a.id === current),
    isBusy: () => false, now: () => now, acquireLease: async () => () => {},
    check: async a => checks.push(a.id), status: s => statuses.push(s),
    ask: async (a, b) => { prompts.push([a.id, b.id]); return 'switch'; },
    stop: async () => { config.enabled = false; }, switchAccount: async a => { switches.push(a.id); current = a.id; }
  };
  return { d, monitor: new QuotaMonitor(d), accounts, config, prompts, switches, checks, statuses,
    setActive: id => { current = id; }, advance: ms => { now += ms; } };
}
test('monitor asks and follows approved switches across successive exhausted accounts', async () => {
  const h = harness(); await h.monitor.tick();
  assert.deepEqual(h.switches, ['b']);
  h.accounts[1].models[0].fraction = 0;
  await h.monitor.tick();
  assert.deepEqual(h.prompts, [['a', 'b'], ['b', 'c']]);
  assert.deepEqual(h.switches, ['b', 'c']);
});
test('dismissal snoozes prompts; it never switches without approval', async () => {
  const h = harness(); let prompts = 0;
  h.d.ask = async () => { prompts++; return undefined; };
  await h.monitor.tick(); await h.monitor.tick();
  assert.equal(prompts, 1); assert.equal(h.switches.length, 0);
  h.advance(10 * 60000); await h.monitor.tick(); assert.equal(prompts, 2);
});
test('stop disables further monitoring', async () => {
  const h = harness(); h.d.ask = async () => 'stop';
  await h.monitor.tick(); assert.equal(h.config.enabled, false); assert.equal(h.switches.length, 0);
});
test('unknown quotas and request errors are not exhaustion', async () => {
  for (const value of [null, 1]) {
    const h = harness(); h.accounts[0].models[0].fraction = value;
    await h.monitor.tick(); assert.equal(h.prompts.length, 0);
  }
  const h = harness(); h.accounts[0].error = 'offline'; await h.monitor.tick(); assert.equal(h.prompts.length, 0);
});
test('accounts with failed checks or no quota are skipped in saved order', async () => {
  const h = harness(); h.accounts[1].error = 'expired sign-in';
  await h.monitor.tick(); assert.deepEqual(h.switches, ['c']);
});
test('candidate losing quota while notification is open cancels the switch', async () => {
  const h = harness(); h.d.ask = async () => { h.accounts[1].models[0].fraction = 0; return 'switch'; };
  await h.monitor.tick(); assert.equal(h.switches.length, 0);
});
test('changing active account or monitored model invalidates outstanding approval', async () => {
  for (const change of [h => h.setActive('c'), h => { h.config.modelId = 'gemini'; h.config.revision++; }, h => { h.config.enabled = false; }]) {
    const h = harness(); h.d.ask = async () => { change(h); return 'switch'; };
    await h.monitor.tick(); assert.equal(h.switches.length, 0);
  }
});
test('no candidate triggers a bounded retry, not repeated prompts or scans', async () => {
  const h = harness(); h.accounts.forEach(a => { a.models[0].fraction = 0; });
  await h.monitor.tick(); const checks = h.checks.length;
  await h.monitor.tick(); assert.equal(h.checks.length, checks); assert.equal(h.prompts.length, 0);
});
test('lease is released after each poll so a hidden window cannot monopolize the monitor', async () => {
  const h = harness(); let acquired = 0, released = 0;
  h.d.acquireLease = async () => { acquired++; return () => released++; };
  h.accounts[0].models[0].fraction = 1;
  await h.monitor.tick(); await h.monitor.tick();
  assert.equal(acquired, 2); assert.equal(released, 2);
  h.config.enabled = false; await h.monitor.tick(); assert.equal(released, 2);
});
test('background windows do not check or prompt; focused window can resume', async () => {
  const h = harness(); let focused = false;
  h.d.isFocused = () => focused;
  await h.monitor.tick(); assert.equal(h.checks.length, 0);
  focused = true; await h.monitor.tick(); assert.equal(h.prompts.length, 1);
});
test('losing focus while approval is pending cancels the switch', async () => {
  const h = harness(); let focused = true;
  h.d.isFocused = () => focused;
  h.d.ask = async () => { focused = false; return 'switch'; };
  await h.monitor.tick(); assert.equal(h.switches.length, 0);
});
