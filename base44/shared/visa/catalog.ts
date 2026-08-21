// Worldz Visa — Phase 1 catalog seed.
import { isKroszMvpCountry } from "./mvpPricing.ts";
// Dev-labeled seed data ONLY. Every row is source_type=dev_seed, confidence<1.
// Production UI must show "Unverified" until verified against authoritative sources.

export interface SeedCountry {
  code: string; name: string; region: string; flag_emoji: string;
  is_schengen: boolean; requires_visa_for_indian: boolean;
}

export const SEED_COUNTRIES: SeedCountry[] = [
  { code: "IN", name: "India", region: "Asia", flag_emoji: "🇮🇳", is_schengen: false, requires_visa_for_indian: false },
  { code: "AE", name: "United Arab Emirates", region: "Middle East", flag_emoji: "🇦🇪", is_schengen: false, requires_visa_for_indian: true },
  { code: "TH", name: "Thailand", region: "Asia", flag_emoji: "🇹🇭", is_schengen: false, requires_visa_for_indian: true },
  { code: "VN", name: "Vietnam", region: "Asia", flag_emoji: "🇻🇳", is_schengen: false, requires_visa_for_indian: true },
  { code: "SG", name: "Singapore", region: "Asia", flag_emoji: "🇸🇬", is_schengen: false, requires_visa_for_indian: true },
  { code: "ID", name: "Indonesia", region: "Asia", flag_emoji: "🇮🇩", is_schengen: false, requires_visa_for_indian: true },
  { code: "LK", name: "Sri Lanka", region: "Asia", flag_emoji: "🇱🇰", is_schengen: false, requires_visa_for_indian: true },
  { code: "HK", name: "Hong Kong", region: "Asia", flag_emoji: "🇭🇰", is_schengen: false, requires_visa_for_indian: false },
  { code: "MY", name: "Malaysia", region: "Asia", flag_emoji: "🇲🇾", is_schengen: false, requires_visa_for_indian: false },
  { code: "EG", name: "Egypt", region: "Africa", flag_emoji: "🇪🇬", is_schengen: false, requires_visa_for_indian: true },
  { code: "OM", name: "Oman", region: "Middle East", flag_emoji: "🇴🇲", is_schengen: false, requires_visa_for_indian: true },
  { code: "TR", name: "Türkiye", region: "Europe", flag_emoji: "🇹🇷", is_schengen: false, requires_visa_for_indian: true },
  { code: "AZ", name: "Azerbaijan", region: "Asia", flag_emoji: "🇦🇿", is_schengen: false, requires_visa_for_indian: true },
  { code: "GE", name: "Georgia", region: "Europe", flag_emoji: "🇬🇪", is_schengen: false, requires_visa_for_indian: true },
  { code: "KH", name: "Cambodia", region: "Asia", flag_emoji: "🇰🇭", is_schengen: false, requires_visa_for_indian: true },
  { code: "FR", name: "France", region: "Europe", flag_emoji: "🇫🇷", is_schengen: true, requires_visa_for_indian: true },
  { code: "DE", name: "Germany", region: "Europe", flag_emoji: "🇩🇪", is_schengen: true, requires_visa_for_indian: true },
  { code: "IT", name: "Italy", region: "Europe", flag_emoji: "🇮🇹", is_schengen: true, requires_visa_for_indian: true },
  { code: "GB", name: "United Kingdom", region: "Europe", flag_emoji: "🇬🇧", is_schengen: false, requires_visa_for_indian: true },
  { code: "US", name: "United States", region: "North America", flag_emoji: "🇺🇸", is_schengen: false, requires_visa_for_indian: true },
  { code: "JP", name: "Japan", region: "Asia", flag_emoji: "🇯🇵", is_schengen: false, requires_visa_for_indian: true },
];

// Per-destination defaults (dev seed). channel + appointment + typical stay.
const DEST_DEFAULTS: Record<string, { channel: "evisa" | "vac" | "embassy"; appointment: boolean; duration: number }> = {
  AE: { channel: "evisa", appointment: false, duration: 30 },
  TH: { channel: "evisa", appointment: false, duration: 60 },
  VN: { channel: "evisa", appointment: false, duration: 30 },
  SG: { channel: "evisa", appointment: false, duration: 30 },
  ID: { channel: "evisa", appointment: false, duration: 30 },
  LK: { channel: "evisa", appointment: false, duration: 30 },
  HK: { channel: "evisa", appointment: false, duration: 14 },
  MY: { channel: "evisa", appointment: false, duration: 30 },
  EG: { channel: "evisa", appointment: false, duration: 30 },
  OM: { channel: "evisa", appointment: false, duration: 30 },
  TR: { channel: "evisa", appointment: false, duration: 30 },
  AZ: { channel: "evisa", appointment: false, duration: 30 },
  GE: { channel: "evisa", appointment: false, duration: 30 },
  KH: { channel: "evisa", appointment: false, duration: 30 },
  FR: { channel: "vac", appointment: true, duration: 90 },
  DE: { channel: "vac", appointment: true, duration: 90 },
  IT: { channel: "vac", appointment: true, duration: 90 },
  GB: { channel: "embassy", appointment: true, duration: 180 },
  US: { channel: "embassy", appointment: true, duration: 180 },
  JP: { channel: "evisa", appointment: false, duration: 90 },
};

// Per visa_type_key enrichment (dev seed) — stay/validity/processing/entry/authority.
// Merged into the base VisaType upsert so the fields persist on every catalog refresh.
export const VISA_TYPE_ENRICH: Record<string, Partial<any>> = {
  "AE-tourism": { category: "evisa", entry_type: "single", entries: 1, max_stay_days: 30, validity_days: 60, processing_min_days: 1, processing_max_days: 4, expedited_processing_days: 1, processing_type: "both", application_method: "Online eVisa portal", authority: "UAE ICP", description: "30-day single-entry tourist eVisa." },
  "TH-tourism": { category: "evisa", entry_type: "single", entries: 1, max_stay_days: 60, validity_days: 90, processing_min_days: 2, processing_max_days: 5, processing_type: "standard", application_method: "Online eVisa portal", authority: "Thai e-Visa Office", description: "60-day single-entry tourist eVisa." },
  "VN-tourism": { category: "evisa", entry_type: "multiple", entries: -1, max_stay_days: 90, validity_days: 90, processing_min_days: 3, processing_max_days: 5, processing_type: "standard", application_method: "Online eVisa portal", authority: "Vietnam Immigration Dept", description: "90-day multiple-entry eVisa." },
  "SG-tourism": { category: "evisa", entry_type: "multiple", entries: -1, max_stay_days: 30, validity_days: 63, processing_min_days: 1, processing_max_days: 3, processing_type: "standard", application_method: "Singapore e-Service", authority: "ICA Singapore", description: "30-day multiple-entry eVisa." },
  "FR-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 90, validity_days: 180, processing_min_days: 10, processing_max_days: 15, expedited_processing_days: 5, processing_type: "both", application_method: "VAC appointment + biometrics", authority: "French Consulate (Schengen)", description: "Schengen short-stay tourist visa." },
  "DE-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 90, validity_days: 180, processing_min_days: 10, processing_max_days: 15, expedited_processing_days: 5, processing_type: "both", application_method: "VAC appointment + biometrics", authority: "German Consulate (Schengen)", description: "Schengen short-stay tourist visa." },
  "IT-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 90, validity_days: 180, processing_min_days: 10, processing_max_days: 15, expedited_processing_days: 5, processing_type: "both", application_method: "VAC appointment + biometrics", authority: "Italian Consulate (Schengen)", description: "Schengen short-stay tourist visa." },
  "GB-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 180, validity_days: 180, processing_min_days: 10, processing_max_days: 21, expedited_processing_days: 5, processing_type: "both", application_method: "VFS appointment + biometrics", authority: "UK Visas & Immigration", description: "Standard Visitor visa." },
  "US-tourism": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 180, validity_days: 3650, processing_min_days: 7, processing_max_days: 30, expedited_processing_days: 3, processing_type: "both", application_method: "Embassy interview + biometrics", authority: "US Dept of State", description: "B1/B2 Visitor visa." },
  "JP-tourism": { category: "evisa", entry_type: "single", entries: 1, max_stay_days: 90, validity_days: 90, processing_min_days: 5, processing_max_days: 7, processing_type: "standard", application_method: "Online eVisa / VFS", authority: "Japan MOFA", description: "90-day single-entry tourist eVisa." },
  "US-business": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 180, validity_days: 3650, processing_min_days: 7, processing_max_days: 30, expedited_processing_days: 3, processing_type: "both", application_method: "Embassy interview + biometrics", authority: "US Dept of State", description: "B1 business visitor visa." },
  "GB-business": { category: "embassy_visa", entry_type: "multiple", entries: -1, max_stay_days: 180, validity_days: 180, processing_min_days: 10, processing_max_days: 21, expedited_processing_days: 5, processing_type: "both", application_method: "VFS appointment + biometrics", authority: "UK Visas & Immigration", description: "Standard Visitor (business) visa." },
};

export const PURPOSES = ["tourism", "business", "study"];
const PURPOSE_LABEL: Record<string, string> = { tourism: "Tourist", business: "Business", study: "Student" };

export function visaTypeKey(destination: string, purpose: string): string {
  return `${destination}-${purpose}`;
}
export function visaTypeName(countryName: string, purpose: string, schengen: boolean): string {
  const p = PURPOSE_LABEL[purpose] || purpose;
  if (schengen && purpose === "tourism") return `${countryName} Schengen Tourist Visa`;
  return `${countryName} ${p} Visa`;
}
export function requirementsVersion(destination: string, purpose: string): string {
  return `IN-${destination}-${purpose}-2026-08-dev`;
}

// Idempotently upsert the catalog. Safe to call on every API request.
export async function ensureVisaCatalog(svc: any): Promise<{ countries: number; visaTypes: number; routes: number }> {
  // Countries
  for (const c of SEED_COUNTRIES) {
    // Idempotent upsert + duplicate canonicalization. Country has an `active`
    // boolean (no status enum): keep the OLDEST row per code as canonical,
    // update it with the current seed payload (active: true), and deactivate
    // duplicate rows (active: false) so they no longer surface in discovery.
    const existing = await svc.entities.Country.filter({ code: c.code }).catch(() : any=> []);
    if (existing && existing.length) {
      const canonical = [...existing].sort((a: any, b: any) => String(a.created_date || a.id || '').localeCompare(String(b.created_date || b.id || '')))[0];
      await svc.entities.Country.update(canonical.id, { ...c, active: true }).catch(() => {});
      for (const dup of existing) if (dup.id !== canonical.id && dup.active !== false) {
        await svc.entities.Country.update(dup.id, { active: false, metadata: { ...(dup.metadata || {}), duplicate_of: canonical.id, duplicate_reason: "seed_race" } }).catch(() => {});
      }
    } else {
      await svc.entities.Country.create({ ...c, active: true }).catch(() => {});
    }
  }
  // Visa types + routes IN -> dest x purpose
  const dests = SEED_COUNTRIES.filter((c) => c.code !== "IN");
  let vtCount = 0, routeCount = 0;
  for (const d of dests) {
    const def = DEST_DEFAULTS[d.code];
    for (const purpose of PURPOSES) {
      const key = visaTypeKey(d.code, purpose);
      const name = visaTypeName(d.name, purpose, d.is_schengen);
      const vtExisting = await svc.entities.VisaType.filter({ visa_type_key: key }).catch(() => []);
      const vt = {
        country_code: d.code, purpose, visa_type_key: key, name,
        channel: def.channel, appointment_required: def.appointment,
        typical_duration_days: def.duration, status: "active",
        ...(VISA_TYPE_ENRICH[key] || {}),
      };
      if (vtExisting && vtExisting.length) {
        // Canonicalize repeated seed races: keep the oldest stable row so existing
        // foreign-key references remain valid, update it with the complete current
        // schema (including enrichment fields), and archive duplicate active rows.
        const canonical = [...vtExisting].sort((a: any, b: any) => String(a.created_date || a.id || '').localeCompare(String(b.created_date || b.id || '')))[0];
        await svc.entities.VisaType.update(canonical.id, vt).catch(() => {});
        for (const dup of vtExisting) if (dup.id !== canonical.id && dup.status !== "archived") {
          await svc.entities.VisaType.update(dup.id, { status: "archived", metadata: { ...(dup.metadata || {}), duplicate_of: canonical.id, duplicate_reason: "seed_race" } }).catch(() => {});
        }
      } else await svc.entities.VisaType.create(vt).catch(() => {});
      vtCount++;
      const route = {
        nationality: "IN", residence: "IN", destination: d.code, purpose,
        visa_type_key: key, channel: def.channel, appointment_required: def.appointment,
        requirements_version: requirementsVersion(d.code, purpose), eligible: true,
        source: "dev_seed", confidence: 0.4, status: "active",
      };
      const rExisting = await svc.entities.VisaRoute.filter({ nationality: "IN", residence: "IN", destination: d.code, purpose }).catch(() => []);
      if (rExisting && rExisting.length) {
        const canonical = [...rExisting].sort((a: any, b: any) => String(a.created_date || a.id || '').localeCompare(String(b.created_date || b.id || '')))[0];
        await svc.entities.VisaRoute.update(canonical.id, route).catch(() => {});
        // VisaRoute historically allowed repeated seed rows. Preserve rows for audit,
        // but make only the canonical row active so discovery cannot double-count.
        for (const dup of rExisting) if (dup.id !== canonical.id && dup.status !== "archived") {
          await svc.entities.VisaRoute.update(dup.id, { status: "archived", metadata: { ...(dup.metadata || {}), duplicate_of: canonical.id, duplicate_reason: "seed_race" } }).catch(() => {});
        }
      } else await svc.entities.VisaRoute.create(route).catch(() => {});
      routeCount++;
    }
  }
  return { countries: SEED_COUNTRIES.length, visaTypes: vtCount, routes: routeCount };
}

// Lightweight destination listing for the consumer surface (no full entity rows).
export async function listDestinationsFromCatalog(svc: any): Promise<any[]> {
  const dests = SEED_COUNTRIES.filter((c) => c.code !== "IN");
  const out: any[] = [];
  for (const d of dests) {
    const def = DEST_DEFAULTS[d.code];
    const types: any[] = await svc.entities.VisaType.filter({ country_code: d.code, status: "active" }).catch(() => []);
    out.push({
      code: d.code, name: d.name, region: d.region, flag_emoji: d.flag_emoji,
      is_schengen: d.is_schengen, channel: def.channel, appointment_required: def.appointment,
      typical_duration_days: def.duration,
      mvp_live: isKroszMvpCountry(d.code),
      availability: isKroszMvpCountry(d.code) ? "LIVE" : "COMING_SOON",
      visa_types: (types || []).map((t) => ({ purpose: t.purpose, name: t.name, channel: t.channel, appointment_required: !!t.appointment_required })),
    });
  }
  return out;
}