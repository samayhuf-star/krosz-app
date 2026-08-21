/**
 * Launch OS — Customer Journey Architecture (Phase 1).
 *
 * The single source of truth for the end-to-end business journey.
 * Every later phase (Home, guided flow, individual pages) consumes this —
 * nothing should define its own notion of "what comes next".
 *
 * Journey (every feature belongs to exactly one stage):
 *  1  Sign Up            7  Website
 *  2  Create Business    8  SEO
 *  3  AI Discovery       9  CRM
 *  4  AI Business Plan   10 Marketing
 *  5  Domain             11 Daily Operations
 *  6  Email              12 Growth
 *
 * Pure data + pure functions. No React, no API calls here — callers gather
 * entity arrays and pass them in; this module only reasons over them.
 */

const MILESTONE = 'milestone';
const ONGOING = 'ongoing';

// status values: 'locked' | 'todo' | 'in_progress' | 'done' | 'active'
export const JOURNEY_STAGES = [
  {
    ordinal: 1, key: 'signup', type: MILESTONE, label: 'Sign Up',
    customerLabel: 'Create your account', route: '/register', engine: null, est: '1 min',
    customersSeeJargon: false,
  },
  {
    ordinal: 2, key: 'business', type: MILESTONE, label: 'Create Business',
    customerLabel: 'Tell us about your business', route: '/onboarding', engine: 'launchAssistant', est: '1 min',
  },
  {
    ordinal: 3, key: 'discovery', type: MILESTONE, label: 'AI Discovery Interview',
    customerLabel: 'AI learns your business', route: '/onboarding', engine: 'launchAssistant', est: '2 min',
    dataKey: 'blueprints', started: () => true,
    done: (b) => !!b,
  },
  {
    ordinal: 4, key: 'plan', type: MILESTONE, label: 'AI Business Plan',
    customerLabel: 'Approve your business plan', route: '/blueprint', engine: 'blueprintEngine', est: '3 min',
    dataKey: 'blueprints', done: (b) => b.status === 'approved', started: () => true,
  },
  {
    ordinal: 5, key: 'domain', type: MILESTONE, label: 'Domain',
    customerLabel: 'Claim your web address', route: '/domains', engine: 'domainEngine', est: '2 min',
    dataKey: 'domains', done: (d) => d.status === 'active' || d.status === 'registered', started: () => true,
  },
  {
    ordinal: 6, key: 'email', type: MILESTONE, label: 'Professional Email',
    customerLabel: 'Set up your business email', route: '/communications', engine: 'commsHub', est: '3 min',
    dataKey: 'mailboxes', done: (m) => m.status === 'active', started: () => true,
  },
  {
    ordinal: 7, key: 'website', type: MILESTONE, label: 'Website',
    customerLabel: 'Launch your website', route: '/website', engine: 'websiteFactory', est: '4 min',
    dataKey: 'websites', done: (w) => w.status === 'published', started: () => true,
  },
  {
    ordinal: 8, key: 'seo', type: MILESTONE, label: 'Google',
    customerLabel: 'Get found on Google', route: '/seo', engine: 'seoFactory', est: '5 min',
    dataKey: 'seoVersions', done: (s) => s.is_published || s.status === 'published', started: () => true,
  },
  {
    ordinal: 9, key: 'crm', type: MILESTONE, label: 'Customers',
    customerLabel: 'Organize your customers', route: '/crm', engine: 'crmFactory', est: '5 min',
    dataKey: 'crmVersions', done: (c) => c.is_published || c.status === 'published', started: () => true,
  },
  {
    ordinal: 10, key: 'marketing', type: ONGOING, label: 'Marketing',
    customerLabel: 'Bring in more customers', route: '/marketing', engine: 'launchAssistant', est: 'ongoing',
    dataKey: 'leads', deps: ['crm'],
  },
  {
    ordinal: 11, key: 'operations', type: ONGOING, label: 'Daily Operations',
    customerLabel: 'Run your day', route: '/communications', engine: 'commsHub', est: 'ongoing',
    dataKey: 'messages', deps: ['email'],
  },
  {
    ordinal: 12, key: 'growth', type: ONGOING, label: 'Growth',
    customerLabel: 'Grow smarter', route: '/insights', engine: 'knowledgeGraph', est: 'ongoing',
    deps: ['website', 'crm'],
  },
];

const arr = (x) => Array.isArray(x) ? x : [];

function itemsFor(data, stage, businessId) {
  if (!stage.dataKey) return [];
  return arr(data?.[stage.dataKey]).filter((x) => x.business_id === businessId);
}

/**
 * Resolve the full journey for one business.
 * @param {object} business  the active Business record (or null)
 * @param {object} data       map of entity arrays (full lists; filtered by business_id here)
 * @returns {{ stage, status, items }[]}
 */
export function computeJourney(business, data = {}) {
  const bid = business?.id || null;
  const out = [];
  let prevMilestoneDone = true;
  for (const stage of JOURNEY_STAGES) {
    const items = itemsFor(data, stage, bid);
    let status;

    if (stage.type === MILESTONE) {
      const done = stage.done ? items.some(stage.done) : false;
      const started = !done && stage.started ? items.some(stage.started) : false;
      // Navigation is never locked — every stage's page handles its own empty
      // state. We only surface progress, not access gates.
      status = done ? 'done' : started ? 'in_progress' : 'todo';
      if (!done) prevMilestoneDone = false;
    } else {
      const hasActivity = items.length > 0;
      status = hasActivity ? 'active' : 'todo';
    }

    out.push({ ...stage, status, items });
  }
  return out;
}

/**
 * The ONE next best action for the customer — the first milestone that is
 * not done and not locked. Ongoing stages are never the "next" action.
 */
export function nextBestAction(journey) {
  const m = journey.find((s) => s.type === MILESTONE && s.status !== 'done' && s.status !== 'locked');
  return m || null;
}

export function progressPercent(journey) {
  const ms = journey.filter((s) => s.type === MILESTONE);
  const done = ms.filter((s) => s.status === 'done').length;
  return ms.length ? Math.round((done / ms.length) * 100) : 0;
}

export function stageByKey(key) {
  return JOURNEY_STAGES.find((s) => s.key === key) || null;
}