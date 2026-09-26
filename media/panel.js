const api = acquireVsCodeApi();
let state = { accounts: [], busy: false };
const el = id => document.getElementById(id);
for (const answer of ['switch', 'later', 'stop']) el(`offer-${answer}`).onclick = () => {
  if (state.pendingOffer) api.postMessage({ type: 'monitorAnswer', id: state.pendingOffer.id, answer });
};
const preferences = api.getState() || { collapsed: {}, query: '', available: false };
preferences.collapsed ||= {};
el('model').value = preferences.query || '';
el('available').checked = !!preferences.available;
function send(type, id) { api.postMessage({ type, id }); }
for (const name of ['login', 'import', 'chromeImport', 'refresh', 'restore']) el(name).onclick = () => send(name);
if (el('github-link')) el('github-link').onclick = () => send('github');
if (el('github-footer')) el('github-footer').onclick = () => send('github');
function filter() { preferences.query = el('model').value; preferences.available = el('available').checked; preferences.selectedModel = el('selected-model').value; api.setState(preferences); render(); }
el('model').oninput = filter;
el('available').onchange = filter;
el('selected-model').onchange = () => {
  filter();
  if (state.monitor?.enabled) api.postMessage({ type: 'monitor', enabled: !!el('selected-model').value, modelId: el('selected-model').value });
};
el('monitor-enabled').onchange = () => api.postMessage({ type: 'monitor', enabled: el('monitor-enabled').checked, modelId: el('selected-model').value });
function node(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function button(label, action, id) {
  const b = node('button', label); b.disabled = state.busy; b.onclick = () => send(action, id); return b;
}
function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12'); svg.setAttribute('class', 'chevron'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', 'm4 2 4 4-4 4'); svg.append(p); return svg;
}
function resetLabel(time, status) {
  if (!time) return 'Reset not reported';
  const delta = Date.parse(time) - Date.now();
  if (delta <= 0) return status === 'exhausted' ? 'Reset time passed · still exhausted' : 'Reset due · recheck';
  const minutes = Math.ceil(delta / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  return `Resets in ${days ? `${days}d ${hours % 24}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`}`;
}
function providerIcon(id) {
  const provider = /claude/i.test(id) ? 'claude' : /gemini|google/i.test(id) ? 'google' : /gpt|openai/i.test(id) ? 'openai' : 'model';
  const circle = node('span', undefined, `provider-icon ${provider}`);
  const img = node('img'); img.src = new URL(`${provider}.svg`, document.querySelector('script[src]').src).toString();
  img.alt = ''; img.setAttribute('aria-hidden', 'true'); circle.append(img); return circle;
}
function render() {
  const catalog = new Map();
  for (const a of state.accounts) for (const m of a.models) catalog.set(m.id, m.label);
  const select = el('selected-model'); select.replaceChildren();
  const all = node('option', 'All models'); all.value = ''; select.append(all);
  for (const [id, label] of [...catalog].sort((a, b) => a[1].localeCompare(b[1]))) {
    const option = node('option', label); option.value = id; select.append(option);
  }
  select.value = catalog.has(preferences.selectedModel) ? preferences.selectedModel : '';
  const selected = select.value;
  el('monitor-enabled').checked = !!state.monitor?.enabled;
  el('monitor-enabled').disabled = !selected && !state.monitor?.enabled;
  const monitoredLabel = catalog.get(state.monitor?.modelId) || state.monitor?.modelId;
  el('monitor-status').textContent = state.monitor?.enabled ? `${monitoredLabel} · ${state.monitor.status}` : (selected ? 'Checks every 20s. You approve each switch.' : 'Select a model to enable monitoring.');
  el('switch-offer').hidden = !state.pendingOffer;
  el('offer-text').textContent = state.pendingOffer ? `${state.pendingOffer.model} is exhausted on ${state.pendingOffer.from}. ${state.pendingOffer.to} has quota available.` : '';
  const result = el('model-result'); result.hidden = !selected; result.replaceChildren();
  if (selected) {
    const groups = AccountReadiness.selectedAvailability(state.accounts, selected);
    result.append(node('div', `${state.accounts.length} connected · ${groups.ready.length} ready · ${groups.waiting.length} waiting · ${groups.check.length} need refresh${groups.notOffered.length ? ` · ${groups.notOffered.length} not offered` : ''}`, 'model-total'));
    const readyAccounts = node('details', undefined, 'ready-accounts');
    const readySummary = node('summary');
    readySummary.append(node('strong', `${groups.ready.length} account${groups.ready.length === 1 ? '' : 's'} ready`, groups.ready.length ? 'ready-label' : ''));
    readySummary.append(node('span', groups.ready.length ? 'Show accounts' : 'Refresh to check again', 'ready-toggle'));
    readyAccounts.append(readySummary);
    if (groups.ready.length) {
      const readyList = node('div', undefined, 'ready-list');
      for (const account of groups.ready) readyList.append(node('span', account.email));
      readyAccounts.append(readyList);
    } else readyAccounts.append(node('p', 'No fresh available quota.', 'ready-empty'));
    result.append(readyAccounts);
    if (groups.waiting.length) {
      const waitingAccounts = node('details', undefined, 'ready-accounts waiting-accounts');
      const waitingSummary = node('summary');
      waitingSummary.append(node('strong', `${groups.waiting.length} waiting for reset`));
      waitingSummary.append(node('span', 'Show accounts', 'ready-toggle'));
      waitingAccounts.append(waitingSummary);
      const waitingList = node('div', undefined, 'ready-list');
      for (const account of groups.waiting) {
        const model = account.models.find(item => item.id === selected);
        waitingList.append(node('span', `${account.email} · ${resetLabel(model.resetTime, model.status)}${model.status === 'stale' ? ' · cached' : ''}`));
      }
      waitingAccounts.append(waitingList);
      result.append(waitingAccounts);
    }
    if (groups.check.length) {
      const checkAccounts = node('details', undefined, 'ready-accounts check-accounts');
      const checkSummary = node('summary');
      checkSummary.append(node('strong', `${groups.check.length} need refresh`));
      checkSummary.append(node('span', 'Show accounts', 'ready-toggle'));
      checkAccounts.append(checkSummary);
      const checkList = node('div', undefined, 'ready-list');
      for (const account of groups.check) {
        const model = account.models.find(item => item.id === selected);
        const reason = account.error ? 'Check failed' : !model ? 'No quota data' : model.status === 'recheck' ? 'Reset due' : model.status === 'stale' ? 'Reading expired' : 'Quota unknown';
        checkList.append(node('span', `${account.email} · ${reason}`));
      }
      checkAccounts.append(checkList);
      result.append(checkAccounts);
    }
    if (groups.notOffered.length) {
      const unavailable = node('details', undefined, 'ready-accounts');
      const unavailableSummary = node('summary');
      unavailableSummary.append(node('strong', `${groups.notOffered.length} not offered`));
      unavailableSummary.append(node('span', 'Show accounts', 'ready-toggle'));
      unavailable.append(unavailableSummary);
      const unavailableList = node('div', undefined, 'ready-list');
      for (const account of groups.notOffered) unavailableList.append(node('span', account.email));
      unavailable.append(unavailableList);
      result.append(unavailable);
    }
  }
  el('notice').textContent = state.notice || ''; el('notice').hidden = !state.notice;
  el('count').textContent = state.accounts.length;
  el('activity').textContent = state.busy ? 'Updating…' : 'On demand';
  for (const name of ['login', 'import', 'chromeImport', 'refresh', 'restore']) el(name).disabled = state.busy;
  el('empty').hidden = state.accounts.length > 0;
  el('accounts').replaceChildren();
  const query = el('model').value.toLowerCase().trim();
  let visible = 0;
  for (const a of state.accounts) {
    const accountMatch = `${a.email} ${a.name}`.toLowerCase().includes(query);
    const models = a.models.filter(m => AccountReadiness.visibleForSelection(a, m, selected) && (accountMatch || `${m.label} ${m.id}`.toLowerCase().includes(query)) && (!el('available').checked || AccountReadiness.modelState(a, m) === 'available'));
    if (selected && !models.length) continue;
    if (!models.length && (query || el('available').checked) && !(accountMatch && !el('available').checked)) continue;
    visible++;
    const card = node('details', undefined, 'account'); card.open = query ? true : preferences.collapsed[a.id] === false;
    card.addEventListener('toggle', () => { if (!card.isConnected || query) return; preferences.collapsed[a.id] = !card.open; api.setState(preferences); });
    const heading = node('summary');
    const identity = node('div', undefined, 'identity'), email = node('div', a.email, 'email'); email.title = a.email;
    const meta = node('div', undefined, 'meta');
    meta.append(node('span', a.tier || 'Plan unknown'));
    if (state.activeId === a.id) meta.append(node('span', 'Active', 'badge'));
    if (a.checkedAt) { const checked = node('span', `· ${new Date(a.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`); checked.title = `Last checked ${new Date(a.checkedAt).toLocaleString()}`; meta.append(checked); }
    identity.append(email, meta);
    const summary = AccountReadiness.summarize(a);
    const badge = node('span', summary.label, summary.ready ? 'available-count' : 'subtle');
    badge.title = summary.detail;
    heading.append(chevron(), node('span', (a.name || a.email).slice(0, 2).toUpperCase(), 'avatar'), identity, badge);
    card.append(heading);
    const actions = node('div', undefined, 'account-actions'), remove = button('Remove', 'remove', a.id); remove.className = 'remove';
    const switchButton = button(state.activeId === a.id ? 'Active account' : 'Switch account', 'switch', a.id);
    switchButton.disabled = state.busy || state.activeId === a.id;
    actions.append(switchButton, button('Refresh', 'refresh', a.id), remove); card.append(actions);
    if (a.error) card.append(node('p', a.error, 'error'));
    if (models.length) {
      const list = node('div', undefined, 'models');
      for (const m of models) {
        const status = AccountReadiness.modelState(a, m);
        const row = node('div', undefined, `model-row ${status}`), top = node('div', undefined, 'model-title');
        const label = node('span', m.label, 'model-label'); label.title = m.id;
        const percent = node('span', m.fraction === null ? '—' : `${Math.round(m.fraction * 100)}%${status === 'stale' ? ' cached' : ''}`, 'percent');
        if (status === 'stale') percent.title = 'Last known quota; refresh to confirm availability.';
        top.append(providerIcon(m.id), label, percent);
        const bottom = node('div', undefined, 'model-meta');
        const names = { available: 'Available', exhausted: 'Exhausted', stale: 'Stale', recheck: 'Recheck', unknown: 'Unknown' };
        const reset = node('span', m.fraction === 1 ? (status === 'stale' ? 'Full at last check' : 'Quota reported full') : resetLabel(m.resetTime, status), 'reset');
        if (m.resetTime && m.fraction !== 1) reset.title = new Date(m.resetTime).toLocaleString();
        bottom.append(node('span', names[status] || 'Unknown', `status ${status}`), reset);
        row.append(top, bottom);
        if (m.fraction !== null) { const p = node('progress'); p.max = 1; p.value = m.fraction; p.setAttribute('aria-label', `${m.label}: ${Math.round(m.fraction * 100)}% remaining`); row.append(p); }
        list.append(row);
      }
      card.append(list);
    } else card.append(node('div', 'No quota data. Refresh this account to check.', 'no-models'));
    el('accounts').append(card);
  }
  el('no-results').hidden = !state.accounts.length || visible > 0;
}
let receivedInitialState = false;
window.addEventListener('message', ({ data }) => {
  if (data.type === 'state') {
    if (!receivedInitialState && data.monitor?.enabled) preferences.selectedModel = data.monitor.modelId;
    receivedInitialState = true; state = data; render();
  }
});
send('ready');
