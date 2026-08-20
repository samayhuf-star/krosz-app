import { base44 } from '@/api/base44Client';

// Preserves discovery context (destination, nationality, purpose, visa option)
// across the anonymous → authenticated transition (§31). Stored in localStorage
// so an anonymous visitor who clicks "Start application" and lands on login can
// resume exactly where they were after signup. Never stores answers — only the
// discovery selection.

const KEY = 'worldz_discovery_intent';

export function setDiscoveryIntent(intent) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...intent, savedAt: Date.now() })); } catch {}
}

export function getDiscoveryIntent() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function clearDiscoveryIntent() {
  try { localStorage.removeItem(KEY); } catch {}
}

// Recently viewed destinations (authenticated & anonymous). Lightweight, client-side,
// capped to 8 — never a full browsing-history store (§28).
const RECENT_KEY = 'worldz_recent_destinations';

export function pushRecentlyViewed(countryCode, name) {
  if (!countryCode) return;
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    let list = raw ? JSON.parse(raw) : [];
    list = list.filter((x) => x.code !== countryCode);
    list.unshift({ code: countryCode, name, ts: Date.now() });
    list = list.slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

export function getRecentlyViewed() {
  try { const raw = localStorage.getItem(RECENT_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}

export function clearRecentlyViewed() {
  try { localStorage.removeItem(RECENT_KEY); } catch {}
}

// Conversion analytics (§32/§33). No sensitive application answers are ever sent.
export function trackDiscovery(eventName, props = {}) {
  try {
    base44.analytics.track({
      eventName,
      properties: {
        destination: props.destination || null,
        nationality: props.nationality || null,
        purpose: props.purpose || null,
        visa_option: props.visa_option || null,
        source: props.source || null,
        ...props.extra,
      },
    });
  } catch {}
}

// Build the authenticated "continue" URL after login honoring a returnTo.
export function buildReturnTo(path) {
  return path || '/';
}