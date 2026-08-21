// Worldz Visa — Phase 21 Discovery presentation layer engine.
// Presentation/acquisition layer OVER the existing Visa Intelligence domain.
// Never reads/writes visa rules as its own source of truth — it calls the Phase 15
// discovery engine (checkEligibility, getDestinationDetail) and requirements
// resolver, then adds search + SEO + editorial content + related + saved + ranking.

import { checkEligibility, getDestinationDetail } from "../discovery/engine.ts";
import { resolveRequirements } from "../requirements.ts";
import { slugify, ensurePublishCatalog } from "./catalog.ts";

// ---------- Pure search helpers (no DB) — unit-tested by publish/contract.ts ----------

// Levenshtein distance (bounded for short queries).
export function levenshtein(a: string, b: string): number {
  a = String(a || "").toLowerCase();
  b = String(b || "").toLowerCase();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

// A query matches a country/alias with a similarity 0-1.
export function similarity(query: string, candidate: string): number {
  const q = String(query || "").toLowerCase().trim();
  const c = String(candidate || "").toLowerCase().trim();
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) return 0.9;
  const d = levenshtein(q, c);
  const maxLen = Math.max(q.length, c.length);
  return Math.max(0, 1 - d / maxLen);
}

export interface SearchHit {
  country_code: string;
  name: string;
  flag_emoji: string;
  region?: string;
  score: number;
  match_type: "exact" | "alias" | "partial" | "fuzzy";
  alias?: string;
  popularity?: number;
  featured?: boolean;
  badge?: string;
  slug: string;
  active_visa?: boolean;
}

// Resolve a raw query against aliases + country names. Returns ranked hits.
// Pure: given a countries list, an aliases list, and a featured map.
export function resolveQuery(query: string, ctx: {
  countries: { code: string; name: string; flag_emoji?: string; region?: string; active?: boolean }[];
  aliases: { alias: string; country_code: string; alias_type?: string }[];
  featured: { country_code: string; popularity?: number; featured?: boolean; badge?: string }[];
}): SearchHit[] {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [];
  const feats: Record<string, any> = {};
  for (const f of ctx.featured || []) if (f.status !== "archived") feats[f.country_code] = f;

  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  // 1. Exact country name match. Guard against duplicate country rows (known
  //    seed duplication) so each country code yields at most one hit.
  for (const c of ctx.countries || []) {
    if (seen.has(c.code)) continue;
    const name = String(c.name || "").toLowerCase();
    if (name === q) {
      seen.add(c.code);
      hits.push(baseHit(c, feats[c.code], 100, "exact"));
    }
  }
  // 2. Alias exact match.
  for (const a of ctx.aliases || []) {
    if (a.alias === q && !seen.has(a.country_code)) {
      const c = byCode(ctx.countries, a.country_code);
      if (c) { seen.add(c.code); hits.push({ ...baseHit(c, feats[c.code], 92, "alias"), alias: a.alias }); }
    }
  }
  // 3. Partial (name or alias contains query).
  for (const c of ctx.countries || []) {
    if (seen.has(c.code)) continue;
    const name = String(c.name || "").toLowerCase();
    if (name.includes(q) || q.includes(name)) {
      seen.add(c.code); hits.push(baseHit(c, feats[c.code], 75, "partial"));
    }
  }
  for (const a of ctx.aliases || []) {
    if (seen.has(a.country_code)) continue;
    if (a.alias.includes(q) || q.includes(a.alias)) {
      const c = byCode(ctx.countries, a.country_code);
      if (c) { seen.add(c.code); hits.push({ ...baseHit(c, feats[c.code], 65, "partial"), alias: a.alias }); }
    }
  }
  // 4. Fuzzy (name or alias similarity >= 0.6).
  for (const c of ctx.countries || []) {
    if (seen.has(c.code)) continue;
    const s = similarity(q, c.name);
    if (s >= 0.6) { seen.add(c.code); hits.push(baseHit(c, feats[c.code], Math.round(50 * s), "fuzzy")); }
  }
  for (const a of ctx.aliases || []) {
    if (seen.has(a.country_code)) continue;
    const s = similarity(q, a.alias);
    if (s >= 0.6) {
      const c = byCode(ctx.countries, a.country_code);
      if (c) { seen.add(c.code); hits.push({ ...baseHit(c, feats[c.code], Math.round(40 * s), "fuzzy"), alias: a.alias }); }
    }
  }

  // Apply popularity ranking weight (§26): +popularity*0.05, +featured*5, active_visa*8.
  for (const h of hits) {
    h.score += (h.popularity || 0) * 0.05;
    if (h.featured) h.score += 5;
    if (h.active_visa) h.score += 8;
  }
  // If the best score is ambiguous (top two within 3 points AND different countries), keep both — caller decides.
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

function baseHit(c: any, f: any, score: number, match_type: SearchHit["match_type"]): SearchHit {
  return {
    country_code: c.code, name: c.name, flag_emoji: c.flag_emoji, region: c.region,
    score, match_type, popularity: f?.popularity || 0, featured: !!f?.featured, badge: f?.badge,
    slug: slugify(c.name), active_visa: c.active,
  };
}
function byCode(list: any[], code: string): any { return list.find((c) => c.code === code); }

// Is a destination page indexable? (§24) Requires either PUBLISHED content with
// quality above threshold OR at least one active visa route. Pure.
export function isIndexable(content: any, hasActiveRoute: boolean): boolean {
  if (content?.status === "ARCHIVED") return false;
  if (content?.status === "PUBLISHED" && Number(content.content_quality_score || 0) >= 40) return true;
  return !!hasActiveRoute && content?.status !== "DRAFT";
}

// Build SEO metadata with sensible defaults (§18). Pure.
export function buildSeoDefaults(country: any, options: any[], content?: any): any {
  const name = country?.name || "Destination";
  const cheapest = options?.filter((o) => o.fees).sort((a, b) => (a.fees.total_minor - b.fees.total_minor))[0];
  const processing = options?.[0]?.processing?.standard_min != null ? `${options[0].processing.standard_min}–${options[0].processing.standard_max} days` : null;
  const categories = Array.from(new Set((options || []).map((o: any) => String(o.category || o.channel || '').toLowerCase())));
  const routeTerms = [categories.some((x: string) => x.includes('evisa')) ? 'eVisa' : '', categories.some((x: string) => x.includes('arrival')) ? 'Visa on Arrival' : '', categories.some((x: string) => x.includes('visa_free')) ? 'Visa-Free' : ''].filter(Boolean);
  const routePhrase = routeTerms.length ? ` | ${routeTerms.join(' & ')}` : '';
  const title = content?.seo?.title || `${name} Visa for Indians${routePhrase} | Krosz`;
  const description = content?.seo?.description || content?.visa_summary ||
    `${name} visa for Indian passport holders: check eVisa, visa on arrival or other verified entry routes, requirements, fees and processing times. Plus cities, flights, airports, cruises and travel planning.`;
  return {
    title, description,
    canonical_path: content?.seo?.canonical_path || `/visa/${slugify(name)}`,
    og_title: content?.seo?.og_title || title,
    og_description: content?.seo?.og_description || description,
    image_url: content?.seo?.image_url || null,
    robots: content?.seo?.robots || (isIndexable(content, (options?.length || 0) > 0) ? "index,follow" : "noindex,follow"),
    highlights: { cheapest: cheapest ? { total_minor: cheapest.fees.total_minor, currency: cheapest.fees.currency } : null, processing },
  };
}

// Pick an experiment variant deterministically from a key (audience/weight aware). Pure.
export function pickExperimentVariant(experiments: any[], audience: string = "all"): any {
  const now = Date.now();
  const active = (experiments || []).filter((e) => e.status === "ACTIVE" && e.key && e.variant &&
    (!e.start_date || new Date(e.start_date).getTime() <= now) &&
    (!e.end_date || new Date(e.end_date).getTime() >= now) &&
    (e.audience === "all" || e.audience === audience));
  if (!active.length) return null;
  // One variant per key; pick the first by key.
  const byKey: Record<string, any[]> = {};
  for (const e of active) (byKey[e.key] = byKey[e.key] || []).push(e);
  const firstKey = Object.keys(byKey)[0];
  const variants = byKey[firstKey];
  const total = variants.reduce((s, v) => s + Math.max(0, Number(v.weight || 0)), 0) || 1;
  // Deterministic-ish: use a round-robin on total (no user id available in pure fn).
  const r = (now % 1000) / 1000 * total;
  let acc = 0;
  for (const v of variants) { acc += Math.max(0, Number(v.weight || 0)); if (r <= acc) return { ...v, _key: firstKey }; }
  return variants[0];
}

// ---------- Async engine (server-side, uses DB) ----------

export async function searchDestinations(svc: any, query: string, opts: { nationality?: string; purpose?: string } = {}): Promise<{ hits: SearchHit[]; query: string }> {
  const [countries, aliases, featured, routes] = await Promise.all([
    svc.entities.Country.filter({ active: true }).catch(() => []),
    svc.entities.SearchAlias.filter({ status: "active" }).catch(() => []),
    svc.entities.FeaturedDestination.filter({ status: "active" }).catch(() => []),
    svc.entities.VisaRoute.filter({ status: "active" }).catch(() => []),
  ]);
  const activeSet = new Set((routes || []).map((r: any) => String(r.destination).toUpperCase()));
  const countryList = (countries || []).map((c: any) => ({ code: c.code, name: c.name, flag_emoji: c.flag_emoji, region: c.region, active: activeSet.has(c.code) }));
  let hits = resolveQuery(query, { countries: countryList, aliases: aliases || [], featured: featured || [] });

  // Personalize: if nationality given, boost destinations with routes for that nationality+purpose (§27).
  if (opts.nationality && opts.purpose) {
    const nat = String(opts.nationality).toUpperCase();
    const matched = new Set((routes || []).filter((r: any) => String(r.nationality).toUpperCase() === nat && r.purpose === opts.purpose).map((r: any) => String(r.destination).toUpperCase()));
    for (const h of hits) if (matched.has(h.country_code)) h.score += 10;
    hits.sort((a, b) => b.score - a.score);
  }
  return { hits, query };
}

export async function getDestinationPage(svc: any, slug: string, opts: { nationality?: string; purpose?: string } = {}): Promise<any> {
  const code = await resolveSlug(svc, slug);
  if (!code) return { not_found: true };
  const nationality = String(opts.nationality || "IN").toUpperCase();
  const purpose = String(opts.purpose || "tourism").toLowerCase();

  const detail = await getDestinationDetail(svc, code);
  if (!detail.country) return { not_found: true };

  // Eligibility result for the requested nationality/purpose (reuses Phase 15 engine).
  const elig = await checkEligibility(svc, { nationality, destination: code, purpose });

  const content = await getDestinationContent(svc, code);
  const related = await listRelatedDestinations(svc, code, content);
  const featured = await getFeatured(svc, code);

  const requirementPreview = buildRequirementPreview(detail.requirements, elig.options);
  const seo = buildSeoDefaults(detail.country, elig.options, content);

  // Freshness (§37).
  const verifiedAt = elig?.provenance?.verified_at || elig?.version?.last_verified_at;
  const stale = elig?.reason === "rule_not_effective" || (!verifiedAt && !elig?.provenance?.verified);

  return {
    country: detail.country,
    content,
    visa_types: detail.visa_types,
    eligibility: elig,
    options: elig.options,
    requirements: detail.requirements,
    requirement_preview: requirementPreview,
    related,
    featured,
    seo,
    freshness: { verified_at: verifiedAt, stale, source: elig?.provenance?.source_type, source_name: elig?.provenance?.source_name, source_url: elig?.provenance?.source_url, verified: !!elig?.provenance?.verified },
    input: { nationality, purpose },
    indexable: isIndexable(content, (elig.options?.length || 0) > 0),
  };
}

export function normalizeDestinationIdentifier(value: string): string {
  let decoded = String(value || "").trim();
  try { decoded = decodeURIComponent(decoded); } catch { /* keep the raw value */ }
  return slugify(decoded);
}

export function resolveCountryIdentifier(identifier: string, ctx: {
  countries: any[];
  content?: any[];
  aliases?: any[];
}): string | null {
  const normalized = normalizeDestinationIdentifier(identifier);
  const code = String(identifier || "").trim().toUpperCase();
  if (!normalized) return null;

  const activeCountries = (ctx.countries || []).filter((country) => country?.active !== false && country?.code);
  const activeCodes = new Set(activeCountries.map((country) => String(country.code).toUpperCase()));
  const canonicalCode = (candidate: any) => {
    const resolved = String(candidate || "").toUpperCase();
    return activeCodes.has(resolved) ? resolved : null;
  };

  const byCode = canonicalCode(code);
  if (byCode) return byCode;

  const byName = activeCountries.find((country) => normalizeDestinationIdentifier(country.name) === normalized);
  if (byName) return canonicalCode(byName.code);

  const byContent = (ctx.content || []).find((row) =>
    row?.status === "PUBLISHED" && normalizeDestinationIdentifier(row.slug) === normalized);
  const contentCode = canonicalCode(byContent?.country_code);
  if (contentCode) return contentCode;

  const byAlias = (ctx.aliases || []).find((row) =>
    row?.status !== "archived" && normalizeDestinationIdentifier(row.alias) === normalized);
  return canonicalCode(byAlias?.country_code);
}

export async function resolveSlug(svc: any, slug: string): Promise<string | null> {
  const [countries, content, aliases] = await Promise.all([
    svc.entities.Country.filter({ active: true }).catch(() => []),
    svc.entities.DestinationContent.filter({ status: "PUBLISHED" }).catch(() => []),
    svc.entities.SearchAlias.filter({ status: "active" }).catch(() => []),
  ]);
  return resolveCountryIdentifier(slug, { countries, content, aliases });
}

export async function getDestinationContent(svc: any, code: string): Promise<any> {
  const rows: any[] = await svc.entities.DestinationContent.filter({ country_code: code, language: "en" }).catch(() => []);
  return rows[0] || null;
}

export function buildRequirementPreview(requirements: any, options: any[]): any {
  const reqs = requirements;
  const items: any[] = [];
  if (reqs?.documents) {
    for (const d of reqs.documents.slice(0, 6)) items.push({ code: d.code, label: d.label || d.name, mandatory: d.mandatory !== false });
  }
  if (reqs?.questions) {
    for (const q of reqs.questions.slice(0, 3)) items.push({ code: q.code || q.question_code, label: q.label || q.question, mandatory: q.mandatory !== false });
  }
  if (!items.length && options?.[0]) {
    items.push({ code: "passport", label: "Valid passport", mandatory: true });
    items.push({ code: "photo", label: "Photograph", mandatory: true });
  }
  return { items, total: items.length, has_more: !!reqs?.documents && reqs.documents.length > 6 };
}

export async function listRelatedDestinations(svc: any, code: string, content?: any): Promise<any[]> {
  // Editorial override first.
  const explicit = content?.related_destinations || [];
  const codes = explicit.length ? explicit : await relatedFallback(svc, code);
  if (!codes.length) return [];
  const countries: any[] = await svc.entities.Country.filter({ active: true }).catch(() => []);
  const featuredRows: any[] = await svc.entities.FeaturedDestination.filter({ status: "active" }).catch(() => []);
  const featMap: Record<string, any> = {};
  for (const f of featuredRows) featMap[f.country_code] = f;
  const out: any[] = [];
  for (const c of codes) {
    const country = countries.find((x) => x.code === c);
    if (!country) continue;
    out.push({ country_code: c, name: country.name, flag_emoji: country.flag_emoji, region: country.region, slug: slugify(country.name), badge: featMap[c]?.badge, popularity: featMap[c]?.popularity || 0 });
  }
  return out;
}

async function relatedFallback(svc: any, code: string): Promise<string[]> {
  const countries: any[] = await svc.entities.Country.filter({ active: true }).catch(() => []);
  const country = countries.find((c) => c.code === code);
  if (!country) return [];
  const sameRegion = countries.filter((c) => c.region === country.region && c.code !== code).slice(0, 4).map((c) => c.code);
  return sameRegion;
}

async function getFeatured(svc: any, code: string): Promise<any> {
  const rows: any[] = await svc.entities.FeaturedDestination.filter({ country_code: code, status: "active" }).catch(() => []);
  return rows[0] || null;
}

export async function listPopularDestinations(svc: any, limit = 8): Promise<any[]> {
  const [featured, countries, routes] = await Promise.all([
    svc.entities.FeaturedDestination.filter({ status: "active" }).catch(() => []),
    svc.entities.Country.filter({ active: true }).catch(() => []),
    svc.entities.VisaRoute.filter({ status: "active" }).catch(() => []),
  ]);
  const activeSet = new Set((routes || []).map((r: any) => String(r.destination).toUpperCase()));
  const countryMap: Record<string, any> = {};
  for (const c of countries) countryMap[c.code] = c;
  const seen = new Set<string>();
  return (featured || [])
    .filter((f: any) => countryMap[f.country_code] && activeSet.has(f.country_code) && !seen.has(f.country_code) && (seen.add(f.country_code), true))
    .map((f: any) => ({ ...f, country: countryMap[f.country_code], slug: slugify(countryMap[f.country_code].name) }))
    .sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0) || (a.order || 0) - (b.order || 0))
    .slice(0, limit);
}

// ---------- Saved destinations ----------

export async function saveDestination(svc: any, user: any, code: string): Promise<any> {
  const existing: any[] = await svc.entities.SavedDestination.filter({ user_id: user.id, country_code: String(code).toUpperCase() }).catch(() => []);
  if (existing[0]) return existing[0];
  return await svc.entities.SavedDestination.create({ user_id: user.id, country_code: String(code).toUpperCase(), saved_at: new Date().toISOString() });
}

export async function unsaveDestination(svc: any, user: any, code: string): Promise<any> {
  const existing: any[] = await svc.entities.SavedDestination.filter({ user_id: user.id, country_code: String(code).toUpperCase() }).catch(() => []);
  for (const s of existing) await svc.entities.SavedDestination.delete(s.id).catch(() => {});
  return { removed: true };
}

export async function listSavedDestinations(svc: any, user: any): Promise<any[]> {
  const rows: any[] = await svc.entities.SavedDestination.filter({ user_id: user.id }, "-saved_at", 100).catch(() => []);
  if (!rows.length) return [];
  const codes = rows.map((r) => r.country_code);
  const countries: any[] = await svc.entities.Country.filter({ active: true }).catch(() => []);
  const featured: any[] = await svc.entities.FeaturedDestination.filter({ status: "active" }).catch(() => []);
  const featMap: Record<string, any> = {};
  for (const f of featured) featMap[f.country_code] = f;
  return rows.map((r) => {
    const country = countries.find((c) => c.code === r.country_code);
    return { ...r, country, slug: country ? slugify(country.name) : r.country_code, badge: featMap[r.country_code]?.badge };
  }).filter((r) => r.country);
}

export async function isDestinationSaved(svc: any, user: any, code: string): Promise<boolean> {
  const rows: any[] = await svc.entities.SavedDestination.filter({ user_id: user.id, country_code: String(code).toUpperCase() }).catch(() => []);
  return rows.length > 0;
}

// ---------- SEO feed: sitemap + robots (§20/§21) ----------
// Private routes are excluded; auth remains authoritative — robots is not access control.

const PRIVATE_DISALLOW = ["/account", "/applications", "/documents", "/admin", "/api/", "/apply", "/checkout", "/orders"];

export async function getSeoFeed(svc: any, base: string = ""): Promise<{ sitemap_xml: string; robots_txt: string; urls: string[] }> {
  const [countries, content, routes] = await Promise.all([
    svc.entities.Country.filter({ active: true }).catch(() => []),
    svc.entities.DestinationContent.filter({ language: "en" }).catch(() => []),
    svc.entities.VisaRoute.filter({ status: "active" }).catch(() => []),
  ]);
  const activeSet = new Set((routes || []).map((r: any) => String(r.destination).toUpperCase()));
  const contentByCode: Record<string, any> = {};
  for (const c of content || []) contentByCode[c.country_code] = c;
  const baseClean = (base || "").replace(/\/$/, "");
  const urlSet = new Set<string>([`${baseClean}/`]);
  const lastmod = new Date().toISOString().slice(0, 10);
  for (const c of countries || []) {
    const cnt = contentByCode[c.code];
    const hasActive = activeSet.has(c.code);
    if (!isIndexable(cnt, hasActive)) continue;
    const slug = cnt?.slug || slugify(c.name);
    urlSet.add(`${baseClean}/visa/${slug}`);
  }
  const urls = Array.from(urlSet);
  const sitemap_xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${u === `${baseClean}/` ? '1.0' : '0.8'}</priority></url>`).join("\n") +
    `\n</urlset>\n`;
  const robots_txt = `User-agent: *\n${PRIVATE_DISALLOW.map((p) => `Disallow: ${p}`).join("\n")}\nAllow: /\nSitemap: ${baseClean}/sitemap.xml\n`;
  return { sitemap_xml, robots_txt, urls };
}

// ---------- Experiments ----------

export async function listExperiments(svc: any, audience: string = "all"): Promise<any[]> {
  const now = Date.now();
  const rows: any[] = await svc.entities.DiscoverExperiment.filter({ status: "ACTIVE" }).catch(() => []);
  return rows.filter((e) =>
    (!e.start_date || new Date(e.start_date).getTime() <= now) &&
    (!e.end_date || new Date(e.end_date).getTime() >= now) &&
    (e.audience === "all" || e.audience === audience));
}

export async function upsertExperiment(svc: any, payload: any): Promise<any> {
  if (!payload?.key || !payload?.variant) throw { message: "key and variant required", code: "BAD_REQUEST" };
  const existing: any[] = await svc.entities.DiscoverExperiment.filter({ key: payload.key, variant: payload.variant }).catch(() => []);
  if (existing[0]) return svc.entities.DiscoverExperiment.update(existing[0].id, payload);
  return svc.entities.DiscoverExperiment.create(payload);
}

export { ensurePublishCatalog };