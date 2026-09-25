// Run only inside an Antigravity extension development host. Never emits tokens.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/core.cjs');
async function run() {
  const report = { checkedAt: new Date().toISOString(), appName: vscode.env.appName };
  try {
    const config = core.installedConfig(vscode.env.appRoot);
    if (typeof vscode.getCloudCodeUrl === 'function') config.cloudCodeUrl = await vscode.getCloudCodeUrl();
    report.ideVersion = config.version;
    const api = vscode.antigravityUnifiedStateSync;
    report.canReadSession = !!api?.OAuthPreferences?.getOAuthTokenInfo;
    report.canWriteSession = !!api?.OAuthPreferences?.setOAuthTokenInfo;
    const token = await api?.OAuthPreferences?.getOAuthTokenInfo();
    report.hasSession = !!token?.accessToken;
    if (token?.accessToken && token.expiryDateSeconds * 1000 > Date.now()) {
      const result = await core.quotas(token, config);
      report.modelCount = result.models.length;
      report.modelsWithQuota = result.models.filter(m => m.fraction !== null).length;
      report.modelsWithReset = result.models.filter(m => m.resetTime).length;
      report.models = result.models;
    }
    const extension = vscode.extensions.getExtension('local-tools.antigravity-account-manager');
    await extension?.activate();
    report.extensionActivated = !!extension?.isActive;
  } catch (error) { report.error = error.message; }
  fs.mkdirSync(path.join(__dirname, '..', '.runtime'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', '.runtime', 'ide-smoke.json'), JSON.stringify(report, null, 2));
}
module.exports = { run };
