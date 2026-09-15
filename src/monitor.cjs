const net = require('node:net');

// All IDE windows share the account session. Hold one process-wide lease while
// checking/prompting so multiple windows cannot offer competing switches.
async function acquireLease() {
  const server = net.createServer(socket => socket.destroy());
  const acquired = await new Promise(resolve => {
    server.once('error', () => resolve(false));
    server.listen(43129, '127.0.0.1', () => resolve(true));
  });
  if (!acquired) return null;
  server.unref();
  return () => server.close();
}

function exhausted(account, modelId) {
  const model = account?.models?.find(m => m.id === modelId);
  return !account?.error && model?.fraction === 0;
}
function available(account, modelId) {
  const model = account?.models?.find(m => m.id === modelId);
  return !account?.error && typeof model?.fraction === 'number' && model.fraction > 0;
}
function nextAccounts(accounts, activeId) {
  const index = accounts.findIndex(a => a.id === activeId);
  if (index < 0) return [];
  return [...accounts.slice(index + 1), ...accounts.slice(0, index)];
}

class QuotaMonitor {
  constructor(deps) { this.d = deps; this.running = false; this.cooldowns = new Map(); this.now = deps.now || Date.now; }
  async tick() {
    if (this.running || this.d.isBusy()) return;
    const config = { ...this.d.config() };
    if (!config.enabled || !config.modelId) { this.releaseLease(); return; }
    this.running = true;
    try {
      this.release ||= await (this.d.acquireLease || acquireLease)();
      if (!this.release) { this.d.status('Monitoring is owned by another IDE window. Configure it in that window.'); return; }
      const stillEnabled = () => { const c = this.d.config(); return c.enabled && c.modelId === config.modelId && c.revision === config.revision; };
      const active = await this.d.activeAccount();
      if (!active) { this.d.status('Save the active IDE account to monitor its quota.'); return; }
      const key = `${active.id}:${config.modelId}`;
      if ((this.cooldowns.get(key) || 0) > this.now()) return;
      this.d.status('Checking the active account…');
      await this.d.check(active);
      if (!stillEnabled()) return;
      if (active.error) { this.d.status('Quota check failed; retrying in 60 seconds.'); return; }
      if (!active.models.some(m => m.id === config.modelId)) { this.d.status('This model is not reported for the active account.'); return; }
      if (!exhausted(active, config.modelId)) {
        this.cooldowns.delete(key);
        this.d.status(available(active, config.modelId) ? 'Watching active account · checks every 60s' : 'Quota unknown; retrying in 60 seconds.'); return;
      }
      this.d.status('Quota exhausted. Looking for the next account…');
      let candidate;
      for (const account of nextAccounts(this.d.accounts(), active.id)) {
        if (!stillEnabled() || this.d.isBusy()) return;
        await this.d.check(account);
        if (available(account, config.modelId)) { candidate = account; break; }
      }
      if (!stillEnabled()) return;
      if (!candidate) {
        this.cooldowns.set(key, this.now() + 5 * 60000);
        this.d.status('No other account has confirmed quota. Checking again in 5 min.'); return;
      }
      if ((await this.d.activeAccount())?.id !== active.id) return;
      this.d.status(`Waiting for your approval to switch to ${candidate.email}.`);
      const answer = await this.d.ask(active, candidate, config.modelId);
      if (!stillEnabled()) return;
      if (answer === 'stop') { await this.d.stop(); return; }
      if (answer !== 'switch') {
        this.cooldowns.set(key, this.now() + 10 * 60000);
        this.d.status('Reminder paused for 10 min. Monitoring remains enabled.'); return;
      }
      if (!this.d.accounts().some(a => a.id === candidate.id)) return;
      // The notification may have been open for minutes. Revalidate both sides
      // and the active session before honoring this specific approval.
      if (this.d.isBusy() || (await this.d.activeAccount())?.id !== active.id) return;
      await this.d.check(active);
      await this.d.check(candidate);
      if (!stillEnabled() || this.d.isBusy() || (await this.d.activeAccount())?.id !== active.id) return;
      if (!exhausted(active, config.modelId) || !available(candidate, config.modelId)) {
        this.d.status('Quota changed while waiting. Rechecking on the next cycle.'); return;
      }
      await this.d.switchAccount(candidate);
      this.d.status('Switched. Watching the new active account · checks every 60s');
    } catch {
      this.d.status('Monitor could not complete this check. Retrying in 60 seconds.');
    } finally { if (!this.d.config().enabled) this.releaseLease(); this.running = false; }
  }
  releaseLease() { const release = this.release; this.release = null; release?.(); }
}
module.exports = { QuotaMonitor, nextAccounts, exhausted, available };
