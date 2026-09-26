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
  function visibleForSelection(account, model, selectedModel) {
    return !selectedModel || model.id === selectedModel && modelState(account, model) === 'available';
  }
  function selectedAvailability(accounts, modelId) {
    const groups = { ready: [], waiting: [], check: [], notOffered: [] };
    for (const account of accounts) {
      const model = account.models.find(item => item.id === modelId);
      if (account.error) groups.check.push(account);
      else if (!model) groups[account.checkedAt ? 'notOffered' : 'check'].push(account);
      else if (modelState(account, model) === 'available') groups.ready.push(account);
      else if (modelState(account, model) === 'exhausted'
        || model.fraction === 0 && model.resetTime && Date.parse(model.resetTime) > Date.now()) groups.waiting.push(account);
      else groups.check.push(account);
    }
    return groups;
  }
  const api = { modelState, summarize, visibleForSelection, selectedAvailability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AccountReadiness = api;
})(globalThis);
