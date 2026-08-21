// Product Learning Engine — lightweight, local, anonymous.
// Collects usage signals (frequently used actions, visited screens) to surface
// product-improvement insights and personalize the customer dashboard order.
// NEVER modifies production/business logic — purely client-side hints.
const ACTIONS_KEY = 'launchos:product:actions';
const PAGES_KEY = 'launchos:product:pages';
const FAILURES_KEY = 'launchos:product:failures';

function readArr(k, cap) {
  try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a.slice(-cap) : []; } catch { return []; }
}
function writeArr(k, a) { try { localStorage.setItem(k, JSON.stringify(a)); } catch {} }

export function trackAction(name) {
  if (!name) return;
  const a = readArr(ACTIONS_KEY, 200); a.push({ name, ts: Date.now() }); writeArr(ACTIONS_KEY, a);
}
export function trackPage(path) {
  if (!path) return;
  const a = readArr(PAGES_KEY, 200); a.push({ path, ts: Date.now() }); writeArr(PAGES_KEY, a);
}
export function trackFailure(flow) {
  if (!flow) return;
  const a = readArr(FAILURES_KEY, 50); a.push({ flow, ts: Date.now() }); writeArr(FAILURES_KEY, a);
}

export function topActions(limit = 6) {
  const counts = {};
  readArr(ACTIONS_KEY, 2000).forEach((x) => { counts[x.name] = (counts[x.name] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
}
export function topPages(limit = 6) {
  const counts = {};
  readArr(PAGES_KEY, 2000).forEach((x) => { counts[x.path] = (counts[x.path] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([path, count]) => ({ path, count }));
}
export function failureCount() { return readArr(FAILURES_KEY, 200).length; }

// Personalization helper: 0 = most-used. Unknown actions rank last (kept in their base order).
export function actionRank(name) {
  const t = topActions(50);
  const idx = t.findIndex((x) => x.name === name);
  return idx < 0 ? 9999 : idx;
}