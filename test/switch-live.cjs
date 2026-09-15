const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/core.cjs');
const { loadCodec } = require('../src/ide-state.cjs');
const switching = require('../src/switch.cjs');

async function run(context, vscode, mode = 'prepare') {
  const report = { startedAt: new Date().toISOString(), mode };
  const api = vscode.antigravityUnifiedStateSync;
  const codec = loadCodec(vscode.env.appRoot);
  const config = core.installedConfig(vscode.env.appRoot);
  let previous, didMutate = false;
  const output = path.join(context.extensionPath, '.runtime', 'switch-live.json');
  const write = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
  try {
    previous = await switching.capture(api);
    const oldProfile = codec.decode(previous.status);
    report.currentProfileDecoded = !!oldProfile.email;
    const accounts = JSON.parse(await context.secrets.get('agm.accounts.v1') || '[]');
    report.savedAccounts = accounts.length;
    const other = accounts.find(a => a.email.toLowerCase() !== oldProfile.email.toLowerCase());
    const target = await switching.prepare(other?.token || previous.token, config, codec, other?.id);
    report.targetIsDifferent = target.identity.email !== oldProfile.email;
    report.preparedModelCount = codec.decode(target.status).cascadeModelConfigData?.clientModelConfigs?.length || 0;
    // Persist any rotated saved credential; never put it in this report.
    if (other) { other.token = target.token; await context.secrets.store('agm.accounts.v1', JSON.stringify(accounts)); }
    write();
    if (mode === 'switch') {
      didMutate = true;
      await switching.switchSession({ api, commands: vscode.commands, codec, target,
        saveRollback: backup => context.secrets.store('agm.rollback.v1', JSON.stringify(backup)) });
      report.targetVerified = codec.decode(await api.UserStatus.getUserStatus()).email === target.identity.email;
      write();
    }
  } catch (error) { report.error = error.message; }
  finally {
    if (didMutate && previous) {
      try {
        const token = await core.refreshToken(previous.token, config);
        await switching.applySession({ api, commands: vscode.commands, codec,
          target: { ...previous, token, identity: { email: codec.decode(previous.status).email } } });
        report.originalRestored = true;
      } catch (error) { report.restoreError = error.message; }
    }
    report.finishedAt = new Date().toISOString(); write();
  }
}
module.exports = { run };
