// Worldz Visa (Phase 38 — Data Integrity) — pure contract tests for catalog
// idempotency, traveler merge survivor selection, and VisaType enrichment
// persistence at the schema/write boundary. PURE (no DB): exercises the
// deterministic seed-key functions, enrichment coverage, survivor selection,
// and category-enum sanity so reruns cannot recreate duplicates and the
// leading-space enum typo can never re-enter the write boundary.

import { visaTypeKey, visaTypeName, VISA_TYPE_ENRICH, SEED_COUNTRIES } from "../catalog.ts";
import { pickTravelerSurvivor } from "../traveler.ts";
import { canonicalCatalogRows } from "../discovery/catalog.ts";

interface TestRes { name: string; pass: boolean; detail?: string; }
const results: TestRes[] = [];
function t(name: string, fn: () => void | { fail?: string }) {
  try { const r = fn(); results.push({ name, pass: !r?.fail, detail: r?.fail }); }
  catch (e: any) { results.push({ name, pass: false, detail: e?.message || String(e) }); }
}
function eq(a: any, b: any, label = "") { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }
function truthy(v: any, label = "") { if (!v) throw new Error(`${label}: expected truthy got ${v}`); }

// P38-DATA-01: catalog dedup keys are deterministic (rerun produces the same key).
t("P38-DATA-01 catalog dedup key deterministic", () => {
  eq(visaTypeKey("JP", "tourism"), "JP-tourism");
  eq(visaTypeKey("JP", "tourism"), visaTypeKey("JP", "tourism")); // stable across calls
  eq(visaTypeKey("US", "business"), "US-business");
  // route composite key shape (nationality|residence|destination|purpose) is deterministic
  const rk = (n: string, r: string, d: string, p: string) => `${n}|${r}|${d}|${p}`;
  eq(rk("IN", "IN", "JP", "tourism"), "IN|IN|JP|tourism");
});

// P38-DATA-02: visaTypeName deterministic (schengen tourist prefix).
t("P38-DATA-02 visaTypeName deterministic", () => {
  eq(visaTypeName("France", "tourism", true), "France Schengen Tourist Visa");
  eq(visaTypeName("Japan", "tourism", false), "Japan Tourist Visa");
  eq(visaTypeName("United States", "business", false), "United States Business Visa");
});

// P38-DATA-03: VISA_TYPE_ENRICH covers all 10 seeded destinations for tourism.
t("P38-DATA-03 enrichment covers all seeded destinations", () => {
  const dests = SEED_COUNTRIES.filter((c) => c.code !== "IN").map((c) => c.code);
  for (const d of dests) truthy(VISA_TYPE_ENRICH[`${d}-tourism`], `missing enrichment for ${d}-tourism`);
  // business enrichment exists for US + GB (the two explicitly seeded).
  truthy(VISA_TYPE_ENRICH["US-business"]);
  truthy(VISA_TYPE_ENRICH["GB-business"]);
});

// P38-DATA-04: every enrichment entry carries the write-boundary fields that
// previously failed to persist (category, max_stay_days, processing_min_days,
// application_method, authority). These must be present on the canonical row.
t("P38-DATA-04 enrichment fields present for persistence", () => {
  const required = ["category", "max_stay_days", "processing_min_days", "processing_max_days", "application_method", "authority"];
  for (const [key, v] of Object.entries(VISA_TYPE_ENRICH)) {
    for (const f of required) truthy((v as any)[f] !== undefined, `${key} missing ${f}`);
  }
});

// P38-DATA-05: every enrichment category is a clean token (no leading/trailing
// whitespace). Guards against the schema enum write-boundary typo
// (" visa_on_arrival" with a leading space) re-entering via seed data.
t("P38-DATA-05 enrichment categories are clean tokens", () => {
  for (const [key, v] of Object.entries(VISA_TYPE_ENRICH)) {
    const c = (v as any).category;
    if (typeof c !== "string" || c !== c.trim() || c.length === 0) throw new Error(`${key} has invalid category "${c}"`);
  }
});

// P38-DATA-06: traveler survivor selection deterministic — most apps, oldest, lowest id.
t("P38-DATA-06 traveler survivor selection deterministic", () => {
  const a = { id: "aaa", created_date: "2026-08-11T10:00:00Z", __appCount: 0 };
  const b = { id: "bbb", created_date: "2026-08-12T10:00:00Z", __appCount: 4 };
  const c = { id: "ccc", created_date: "2026-08-11T09:00:00Z", __appCount: 4 };
  const s = pickTravelerSurvivor([a, b, c]);
  eq(s.id, "ccc"); // most apps (4), oldest (09:00 < 10:00 on the 11th)
  // tiebreak by app count dominates: a (0 apps, oldest) is NOT the survivor
  truthy(s.id !== "aaa");
  // stable across calls
  eq(pickTravelerSurvivor([a, b, c]).id, pickTravelerSurvivor([c, b, a]).id);
  // single-row cluster returns the only row
  eq(pickTravelerSurvivor([a]).id, "aaa");
  // empty cluster returns null
  eq(pickTravelerSurvivor([]), null);
});

// P38-DATA-07: survivor selection never chooses an archived row (status gate is
// applied upstream in canonicalizeTravelers; here we verify the pure picker
// itself is driven only by app count + age + id, so the merge is deterministic
// and independent of row order).
t("P38-DATA-07 survivor selection order-independent", () => {
  const rows = [
    { id: "z", created_date: "2026-08-12T00:00:00Z", __appCount: 2 },
    { id: "a", created_date: "2026-08-11T00:00:00Z", __appCount: 2 },
    { id: "m", created_date: "2026-08-13T00:00:00Z", __appCount: 0 },
  ];
  const s1 = pickTravelerSurvivor(rows).id;
  const s2 = pickTravelerSurvivor([...rows].reverse()).id;
  eq(s1, s2, "survivor must be order-independent");
  eq(s1, "a"); // tie on apps (2), oldest is the 11th
});

// P38-DATA-08: discovery reads return one deterministic row per stable key
// even while a non-destructive archival cleanup is still in progress.
t("P38-DATA-08 discovery catalogs deduplicate deterministically", () => {
  const rows = [
    { id: "new-in", code: "IN", created_date: "2026-08-12T00:00:00Z" },
    { id: "old-us", code: "US", created_date: "2026-08-10T00:00:00Z" },
    { id: "old-in", code: "IN", created_date: "2026-08-10T00:00:00Z" },
    { id: "new-us", code: "US", created_date: "2026-08-12T00:00:00Z" },
  ];
  const canonical = canonicalCatalogRows(rows, "code");
  eq(canonical.map((row) => row.id), ["old-in", "old-us"]);
  eq(canonicalCatalogRows([...rows].reverse(), "code").map((row) => row.id), ["old-in", "old-us"]);
  eq(new Set(canonical.map((row) => row.code)).size, canonical.length);
});

export function runDataContractTests(): { total: number; passed: number; failed: number; failed_names: string[]; results: TestRes[] } {
  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, failed_names: failed.map((r) => r.name), results };
}