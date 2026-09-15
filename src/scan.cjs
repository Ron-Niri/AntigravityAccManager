async function scanAccounts(accounts, check, { concurrency = 5, onProgress = () => {}, shouldContinue = () => true } = {}) {
  let cursor = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, accounts.length) }, async () => {
    while (cursor < accounts.length && shouldContinue()) {
      const account = accounts[cursor++];
      await check(account);
      onProgress(++completed, accounts.length);
    }
  }));
}
module.exports = { scanAccounts };
