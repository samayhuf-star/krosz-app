const LEGACY_ORIGIN = (import.meta.env.VITE_ADIOLOGY_LEGACY_ORIGIN || 'https://adiology.io').replace(/\/$/, '');

const SAFE_PUBLIC_EXACT = new Set([
  '/api/health',
  '/api/analyze-url',
  '/api/ai/generate-negative-keywords',
  '/api/ai/generate-seed-keywords',
  '/api/ai/generate-blog',
  '/api/campaigns/one-click',
  '/api/keywords/alphabet-soup',
  '/api/leads/capture',
  '/api/analytics/track',
  '/api/analytics/heartbeat',
  '/api/stripe/config',
  '/api/stripe/products',
]);

const SAFE_PUBLIC_PREFIXES = [
  '/api/blogs',
];

const BASE44_COMPAT_PREFIXES = [
  '/api/tasks',
  '/api/projects',
  '/api/domains',
];

const BASE44_SAAS_PREFIXES = [
  '/api/campaigns',
  '/api/campaign-history',
  '/api/google-ads',
  '/api/stripe/checkout',
  '/api/stripe/portal',
  '/api/stripe/subscription',
  '/api/user/profile',
  '/api/user/sync',
  '/api/support-tickets',
  '/api/feedback',
  '/api/logs',
  '/api/errors',
];

export function isSafeLegacyPublicPath(path: string): boolean {
  const pathname = path.split('?')[0];
  return SAFE_PUBLIC_EXACT.has(pathname) || SAFE_PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function legacyApiUrl(path: string): string {
  if (!path.startsWith('/api/')) return path;
  return isSafeLegacyPublicPath(path) ? `${LEGACY_ORIGIN}${path}` : path;
}

/**
 * Temporary migration bridge. Only explicitly allowlisted stateless/public
 * endpoints are sent to the still-running Adiology API. Identity-sensitive
 * routes intentionally stay same-origin and fail closed until ported to Base44.
 */
function isBase44CompatPath(path: string): boolean {
  const pathname = path.split('?')[0];
  return BASE44_COMPAT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isBase44SaasPath(path: string): boolean {
  const pathname = path.split('?')[0];
  return BASE44_SAAS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function invokeBase44Function(functionName: string, input: string, init?: RequestInit): Promise<Response> {
  const { base44 } = await import('../api/base44Client');
  const method = String(init?.method || 'GET').toUpperCase();
  let body: any = {};
  if (typeof init?.body === 'string' && init.body) {
    try { body = JSON.parse(init.body); } catch { body = { rawBody: init.body }; }
  }
  let workspace: any = null;
  try { workspace = JSON.parse(localStorage.getItem('adiology_workspace_context') || 'null'); } catch {}
  const result = await base44.functions.invoke(functionName as any, {
    method,
    path: input,
    body,
    workspace_id: workspace?.workspace_id,
    tenant_id: workspace?.tenant_id,
  });
  const payload = result?.data ?? result;
  return new Response(JSON.stringify(payload ?? {}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installLegacyPublicApiBridge(): void {
  if (typeof window === 'undefined') return;
  const marker = '__adiologyLegacyBridgeInstalled';
  const scopedWindow = window as Window & Record<string, any>;
  if (scopedWindow[marker]) return;
  scopedWindow[marker] = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/') && isBase44CompatPath(input)) {
      return invokeBase44Function('adiologyCompatApi', input, init);
    }
    if (typeof input === 'string' && input.startsWith('/api/') && isBase44SaasPath(input)) {
      return invokeBase44Function('adiologySaasApi', input, init);
    }
    if (typeof input === 'string' && input.startsWith('/api/') && isSafeLegacyPublicPath(input)) {
      return nativeFetch(`${LEGACY_ORIGIN}${input}`, init);
    }
    if (input instanceof Request) {
      try {
        const url = new URL(input.url, window.location.origin);
        if (url.origin === window.location.origin && isSafeLegacyPublicPath(`${url.pathname}${url.search}`)) {
          const bridged = new Request(`${LEGACY_ORIGIN}${url.pathname}${url.search}`, input);
          return nativeFetch(bridged, init);
        }
      } catch {
        // Leave non-standard Request objects untouched.
      }
    }
    return nativeFetch(input as any, init);
  }) as typeof window.fetch;
}
