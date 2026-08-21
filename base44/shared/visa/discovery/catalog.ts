// Worldz Visa — Phase 15 Discovery catalog seed.
// Seeds Nationality + TravelPurpose (new) and enriches VisaType rows with the
// stay/validity/processing/entry/authority metadata the discovery engine needs.
// All seed data is source_type=dev_seed, confidence<1 — never real regulatory advice.

import { SEED_COUNTRIES, ensureVisaCatalog, visaTypeKey } from "../catalog.ts";

export const SEED_NATIONALITIES = [
  { code: "IN", name: "Indian", country_code: "IN", passport_country_code: "IN", dual_nationality_supported: false, flag_emoji: "🇮🇳" },
  { code: "US", name: "United States", country_code: "US", passport_country_code: "US", dual_nationality_supported: true, flag_emoji: "🇺🇸" },
  { code: "GB", name: "British", country_code: "GB", passport_country_code: "GB", dual_nationality_supported: true, flag_emoji: "🇬🇧" },
  { code: "AE", name: "Emirati", country_code: "AE", passport_country_code: "AE", dual_nationality_supported: false, flag_emoji: "🇦🇪" },
];

export const SEED_TRAVEL_PURPOSES = [
  { key: "tourism", label: "Tourism", category: "leisure", order: 1 },
  { key: "business", label: "Business", category: "business", order: 2 },
  { key: "study", label: "Study", category: "education", order: 3 },
  { key: "transit", label: "Transit", category: "transit", order: 4 },
  { key: "family_visit", label: "Family Visit", category: "family", order: 5 },
  { key: "medical", label: "Medical", category: "medical", order: 6 },
  { key: "conference", label: "Conference / Event", category: "event", order: 7 },
  { key: "work", label: "Work", category: "work", order: 8 },
  { key: "other", label: "Other", category: "other", order: 9 },
];

// Per-destination VisaType enrichment (dev seed). Maps visa_type_key → metadata.
const VISA_TYPE_ENRICH: Record<string, Partial<any>> = {
  "AE-tourism": { category: "evisa", entry_type: "single", entries: 1, max_stay_days: 30, validity_days: 60, processing_min_days: 1, processing_max_days: 4, expedited_processing_days: 1, processing_type: "both", application_method: "Online eVisa portal", authority: "UAE ICP", description: "30-day single-entry tourist eVisa." },
  "TH-tourism": { category: "evisa", entry_type: "single", entries: 1, max_stay_days: 60, validity_days: 90, processing_min_days: 2, processing_max_days: 5, processing_type: "standard", application_method: "Online eVisa portal", authority: "Thai e-Visa Office", description: "60-day single-entry tourist eVisa." },
  "VN-tourism": { category: "evisa", entry_type: "multiple", entries: -1, max_stay_days: 90, validity_days: 90, processing_min_days: 3, processing_max_days: 5, processing_type: "standard", application_method: "Online eVisa portal", authority: "Vietnam Immigration Dept", description: "90-day multiple-entry eVisa." },
  "SG-tourism": { category: "evisa", entry_type: "multiple", entries: -1, max_stay_days: 30, validity_days: 63, processing_min_days: 1, processing_max_days: 3, processing_type: "standard", application_method: "Singapore e-Service", authority: "ICA Singapore", description: "30-day multiple-entry eVisa." },
  "FR-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 90, validity_days: 180, processing_min_days: 10, processing_max_days: 15, processing_type: "both", expedited_processing_days: 5, application_method: "VAC appointment + biometrics", authority: "French Consulate (Schengen)", description: "Schengen short-stay tourist visa." },
  "DE-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 90, validity_days: 180, processing_min_days: 10, processing_max_days: 15, processing_type: "both", expedited_processing_days: 5, application_method: "VAC appointment + biometrics", authority: "German Consulate (Schengen)", description: "Schengen short-stay tourist visa." },
  "IT-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 90, validity_days: 180, processing_min_days: 10, processing_max_days: 15, processing_type: "both", expedited_processing_days: 5, application_method: "VAC appointment + biometrics", authority: "Italian Consulate (Schengen)", description: "Schengen short-stay tourist visa." },
  "GB-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 180, validity_days: 180, processing_min_days: 10, processing_max_days: 21, processing_type: "both", expedited_processing_days: 5, application_method: "VFS appointment + biometrics", authority: "UK Visas & Immigration", description: "Standard Visitor visa." },
  "US-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 180, validity_days: 3650, processing_min_days: 7, processing_max_days: 30, processing_type: "both", expedited_processing_days: 3, application_method: "Embassy interview + biometrics", authority: "US Dept of State", description: "B1/B2 Visitor visa." },
  "JP-tourism": { category: "evisa", entry_type: "single", entries: 1, max_stay_days: 90, validity_days: 90, processing_min_days: 5, processing_max_days: 7, processing_type: "standard", application_method: "Online eVisa / VFS", authority: "Japan MOFA", description: "90-day single-entry tourist eVisa." },
  // Business variants reuse processing defaults (faster to populate by purpose).
  "US-business": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 180, validity_days: 3650, processing_min_days: 7, processing_max_days: 30, processing_type: "both", expedited_processing_days: 3, application_method: "Embassy interview + biometrics", authority: "US Dept of State", description: "B1 business visitor visa." },
  "GB-business": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 180, validity_days: 180, processing_min_days: 10, processing_max_days: 21, processing_type: "both", expedited_processing_days: 5, application_method: "VFS appointment + biometrics", authority: "UK Visas & Immigration", description: "Standard Visitor (business) visa." },
};

export function canonicalCatalogRows(rows: any[], keyField: "code" | "key"): any[] {
  const sorted = [...rows].sort((a, b) => {
    const byCreated = String(a.created_date || "").localeCompare(String(b.created_date || ""));
    return byCreated || String(a.id || "").localeCompare(String(b.id || ""));
  });
  const canonical = new Map<string, any>();
  for (const row of sorted) {
    const key = String(row?.[keyField] || "").trim();
    if (key && !canonical.has(key)) canonical.set(key, row);
  }
  return [...canonical.values()];
}

async function canonicalizeSeedRow(entity: any, keyField: "code" | "key", seed: any): Promise<void> {
  const rows: any[] = await entity.filter({ [keyField]: seed[keyField] }).catch(() => []);
  if (!rows.length) {
    await entity.create({ ...seed, status: "active" }).catch(() => {});
    return;
  }

  const canonical = canonicalCatalogRows(rows, keyField)[0];
  await entity.update(canonical.id, { ...seed, status: "active" }).catch(() => {});
  for (const duplicate of rows.filter((row) => row.id !== canonical.id && row.status !== "archived")) {
    await entity.update(duplicate.id, { status: "archived" }).catch(() => {});
  }
}

export async function ensureDiscoveryCatalog(svc: any): Promise<{ countries: number; visa_types: number; routes: number; nationalities: number; purposes: number }> {
  // Base countries + routes first.
  const base = await ensureVisaCatalog(svc);

  // Nationalities.
  let natCount = 0;
  for (const n of SEED_NATIONALITIES) {
    await canonicalizeSeedRow(svc.entities.Nationality, "code", n);
    natCount++;
  }

  // Travel purposes.
  let purposeCount = 0;
  for (const p of SEED_TRAVEL_PURPOSES) {
    await canonicalizeSeedRow(svc.entities.TravelPurpose, "key", p);
    purposeCount++;
  }

  // Enrich VisaType rows with stay/validity/processing/entry metadata.
  for (const d of SEED_COUNTRIES) {
    if (d.code === "IN") continue;
    const types: any[] = await svc.entities.VisaType.filter({ country_code: d.code, status: "active" }).catch(() => []);
    for (const t of types) {
      const enrich = VISA_TYPE_ENRICH[t.visa_type_key] || {};
      if (Object.keys(enrich).length) {
        await svc.entities.VisaType.update(t.id, enrich).catch(() => {});
      }
    }
  }

  return { countries: base.countries, visa_types: base.visaTypes, routes: base.routes, nationalities: natCount, purposes: purposeCount };
}

export async function listNationalities(svc: any): Promise<any[]> {
  const rows: any[] = await svc.entities.Nationality.filter({ status: "active" }).catch(() => []);
  const canonical = canonicalCatalogRows(rows, "code");
  canonical.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return canonical;
}

export async function listTravelPurposes(svc: any): Promise<any[]> {
  const rows: any[] = await svc.entities.TravelPurpose.filter({ status: "active" }).catch(() => []);
  const canonical = canonicalCatalogRows(rows, "key");
  canonical.sort((a, b) => (a.order || 0) - (b.order || 0));
  return canonical;
}