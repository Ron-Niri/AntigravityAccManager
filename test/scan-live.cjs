const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/core.cjs');
const { scanAccounts } = require('../src/scan.cjs');
async function run(context, vscode) {
  const config = core.installedConfig(vscode.env.appRoot);
  const accounts = JSON.parse(await context.secrets.get('agm.accounts.v1') || '[]');
  const results = [];
  for (const phase of ['cold', 'warm']) {
    const started = Date.now(); let successful = 0, failed = 0;
    await scanAccounts(accounts, async account => {
      try {
        account.token = await core.refreshToken(account.token, config);
        const data = await core.quotas(account.token, config, account.quotaCache ||= {});
        Object.assign(account, data, { error: null, checkedAt: new Date().toISOString() });
        successful++;
      } catch { failed++; }
    });
    await context.secrets.store('agm.accounts.v1', JSON.stringify(accounts));
    results.push({ phase, milliseconds: Date.now() - started, accounts: accounts.length, successful, failed });
  }
  fs.writeFileSync(path.join(context.extensionPath, '.runtime', 'scan-results.json'), JSON.stringify(results, null, 2));
}
module.exports = { run };
