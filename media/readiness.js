(function (root) {
  function modelState(account, model) {
    return account.error ? 'stale' : model.status;
  }
  function summarize(account, selectedModel = '') {
    const models = account.models.filter(m => !selectedModel || m.id === selectedModel);
    const ready = models.filter(m => modelState(account, m) === 'available').length;
    const uncertain = models.filter(m => ['stale', 'recheck', 'unknown'].includes(modelState(account, m))).length;
    const cachedAvailable = models.filter(m => modelState(account, m) === 'stale' && m.fraction > 0).length;
    const label = ready ? `${ready} ready` : uncertain || !models.length ? 'Needs refresh' : '0 ready';
    const detail = `${ready} model${ready === 1 ? '' : 's'} with fresh available quota across this account.`
      + (uncertain ? ` ${uncertain} need a fresh check.` : '')
      + (cachedAvailable ? ` ${cachedAvailable} had quota at the last check.` : '');
    return { ready, uncertain, cachedAvailable, label, detail };
  }
  const api = { modelState, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AccountReadiness = api;
})(globalThis);
