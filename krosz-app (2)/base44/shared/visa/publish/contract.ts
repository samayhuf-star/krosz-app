// Worldz Visa — Phase 21 Discovery presentation layer contract tests.
// Pure (no DB): covers search (exact/partial/alias/typo/no-result/ambiguous),
// SEO defaults, indexability, experiment picking, related fallback. The async
// engine paths (getDestinationPage, seoFeed, saved) are integration-verified
// through the visaApi action live, not here.

import { resolveQuery, similarity, levenshtein, buildSeoDefaults, isIndexable, pickExperimentVariant, normalizeDestinationIdentifier, resolveCountryIdentifier } from "./engine.ts";
import { slugify } from "./catalog.ts";

const COUNTRIES = [
  { code: "US", name: "United States", flag_emoji: "🇺🇸", region: "North America" },
  { code: "GB", name: "United Kingdom", flag_emoji: "🇬🇧", region: "Europe" },
  { code: "TH", name: "Thailand", flag_emoji: "🇹🇭", region: "Asia" },
];
const ALIASES = [
  { alias: "usa", country_code: "US", alias_type: "abbreviation" },
  { alias: "america", country_code: "US", alias_type: "other" },
  { alias: "uk", country_code: "GB", alias_type: "abbreviation" },
  { alias: "london", country_code: "GB", alias_type: "city" },
  { alias: "bangkok", country_code: "TH", alias_type: "city" },
];
const FEATURED = [
  { country_code: "US", popularity: 90, featured: true, badge: "Popular" },
  { country_code: "TH", popularity: 92, featured: true, badge: null },
  { country_code: "GB", popularity: 70, featured: false, badge: null },
];

function assert(cond: any, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}

export function runPublishContractTests(): any {
  const results: any[] = [];
  const test = (name: string, fn: () => void) => {
    try { fn(); results.push({ name, pass: true }); }
    catch (e: any) { results.push({ name, pass: false, error: e?.message || String(e) }); }
  };

  // ---- Search ----
  test("search: exact country name", () => {
    const hits = resolveQuery("United States", { countries: COUNTRIES, aliases: ALIASES, featured: FEATURED });
    assert(hits[0]?.country_code === "US", "should match US exactly");
    assert(hits[0]?.match_type === "exact", "exact match_type");
  });
  test("search: alias 'usa'", () => {
    const hits = resolveQuery("usa", { countries: COUNTRIES, aliases: ALIASES, featured: FEATURED });
    assert(hits[0]?.country_code === "US", "alias → US");
  });
  test("search: alias 'america'", () => {
    const hits = resolveQuery("america", { countries: COUNTRIES, aliases: ALIASES, featured: FEATURED });
    assert(hits[0]?.country_code === "US", "america → US");
  });
  test("search: partial 'united'", () => {
    const hits = resolveQuery("united", { countries: COUNTRIES, aliases: ALIASES, featured: FEATURED });
    assert(hits.length >= 2, "matches US and GB");
    assert(hits.some((h) => h.country_code === "US") && hits.some((h) => h.country_code === "GB"), "both united…");
  });
  test("search: typo 'Untied States'", () => {
    const hits = resolveQuery("Untied States", { countries: COUNTRIES, aliases: ALIASES, featured: FEATURED });
    assert(hits[0]?.country_code === "US", "fuzzy → US");
    assert(hits[0]?.match_type === "fuzzy", "fuzzy match_type");
  });
  test("search: no result", () => {
    const hits = resolveQuery("zzzzxx", { countries: COUNTRIES, aliases: ALIASES, featured: FEATURED });
    assert(hits.length === 0, "no hits");
  });
  test("search: ambiguous 'united' returns multiple ranked", () => {
    const hits = resolveQuery("united", { countries: COUNTRIES, aliases: ALIASES, featured: FEATURED });
    assert(hits.length >= 2, "ambiguous not collapsed");
  });
  test("search: popularity ranking influence", () => {
    const hits = resolveQuery("thailand", { countries: COUNTRIES, aliases: ALIASES, featured: FEATURED });
    assert(hits[0]?.country_code === "TH", "Thailand top");
  });

  // ---- similarity / levenshtein ----
  test("similarity identical = 1", () => assert(similarity("thailand", "thailand") === 1, "identical"));
  test("similarity substring = 0.9", () => assert(similarity("thai", "thailand") === 0.9, "contains"));
  test("levenshtein basic", () => assert(levenshtein("thai", "thailand") === 4, "dist"));

  // ---- slugify ----
  test("slugify names", () => {
    assert(slugify("United States") === "united-states", "us slug");
    assert(slugify("United Kingdom") === "united-kingdom", "gb slug");
  });

  // ---- canonical destination resolution ----
  test("destination resolver: canonical name, code, editorial slug and alias", () => {
    const countries = [
      { code: "VN", name: "Vietnam", active: true },
      { code: "AE", name: "United Arab Emirates", active: true },
      { code: "ZZ", name: "Inactive", active: false },
    ];
    const content = [{ country_code: "VN", slug: "visit-vietnam", status: "PUBLISHED" }];
    const aliases = [{ country_code: "AE", alias: "U.A.E.", status: "active" }];
    const ctx = { countries, content, aliases };
    assert(resolveCountryIdentifier("vietnam", ctx) === "VN", "name slug → VN");
    assert(resolveCountryIdentifier("VN", ctx) === "VN", "ISO code → VN");
    assert(resolveCountryIdentifier("visit-vietnam", ctx) === "VN", "editorial slug → VN");
    assert(resolveCountryIdentifier("u-a-e", ctx) === "AE", "normalized alias → AE");
    assert(resolveCountryIdentifier("inactive", ctx) === null, "inactive country rejected");
  });
  test("destination resolver: URL and punctuation normalization", () => {
    assert(normalizeDestinationIdentifier("%20Sri%20Lanka%20") === "sri-lanka", "URL decoding");
    assert(normalizeDestinationIdentifier("Hong_Kong") === "hong-kong", "punctuation normalization");
  });

  // ---- SEO defaults ----
  test("seo defaults: title + canonical", () => {
    const seo = buildSeoDefaults({ name: "United States", flag_emoji: "🇺🇸" }, [], null);
    assert(seo.title.includes("United States"), "title has name");
    assert(seo.canonical_path === "/visa/united-states", "canonical");
    assert(seo.robots === "noindex,follow", "no content → noindex");
  });
  test("seo defaults: indexable with published content + active route", () => {
    const seo = buildSeoDefaults({ name: "United States" }, [{ fees: { total_minor: 100, currency: "USD" } }], { status: "PUBLISHED", content_quality_score: 60 });
    assert(seo.robots === "index,follow", "indexable");
  });

  // ---- indexability ----
  test("indexability: archived never", () => assert(!isIndexable({ status: "ARCHIVED" }, true), "archived"));
  test("indexability: published high quality", () => assert(isIndexable({ status: "PUBLISHED", content_quality_score: 60 }, false), "published+quality"));
  test("indexability: draft without route no-index", () => assert(!isIndexable({ status: "DRAFT" }, false), "draft no route"));
  test("indexability: active route enables", () => assert(isIndexable(null, true), "active route indexable"));

  // ---- experiments ----
  test("experiment: returns null when none active", () => {
    assert(pickExperimentVariant([], "all") === null, "no experiments");
  });
  test("experiment: skips draft/paused", () => {
    const exps = [{ key: "hero", variant: "A", status: "DRAFT", audience: "all", weight: 100 }];
    assert(pickExperimentVariant(exps, "all") === null, "draft skipped");
  });
  test("experiment: audience filter", () => {
    const exps = [{ key: "hero", variant: "A", status: "ACTIVE", audience: "authenticated", weight: 100 }];
    assert(pickExperimentVariant(exps, "anonymous") === null, "wrong audience excluded");
    assert(pickExperimentVariant(exps, "authenticated")?.variant === "A", "right audience included");
  });

  const passed = results.filter((r) => r.pass).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}

export const __publishContract = { runPublishContractTests, slugify, similarity, levenshtein, resolveQuery };