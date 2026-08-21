// Worldz Visa — verified/conservative rule packs for Engines 9-12.
// India-first (ordinary Indian passport, tourism) MVP. These packs are a thin,
// versioned projection of official source facts into deterministic engine policy.
// If an official source is transitional/ambiguous, fields remain null so the
// readiness engine returns REVIEW rather than inventing policy.

import type { TravelPolicy, FinancialPolicy, EligibilityPolicy, HealthPolicy } from "./engine.ts";

export type RulePackState = "VERIFIED" | "REVIEW";
export interface CountryRulePack {
  country: string;
  nationality: "IN";
  departure_country: "IN";
  purpose: "tourism";
  journey: string;
  state: RulePackState;
  rule_version: string;
  effective_from: string | null;
  last_verified_at: string;
  official_sources: string[];
  notes?: string[];
  travel: TravelPolicy;
  financial: FinancialPolicy;
  eligibility: EligibilityPolicy;
  health: HealthPolicy;
  route_conditions?: Record<string, any>;
}

const verified = "2026-08-19";
function meta(country: string, version: string, source: string, effective_from: string | null = null) {
  return { policy_version: version, source, effective_from, last_verified_at: verified };
}

// UAE: ICP has a special 60-day entry visa for ordinary Indian passport holders
// with qualifying visa/residence/Green Card from listed countries. General ICP
// visa guidance also requires 6m passport, ticket and UAE-valid health insurance.
const AE: CountryRulePack = {
  country: "AE", nationality: "IN", departure_country: "IN", purpose: "tourism",
  journey: "EVISA_CONDITIONAL", state: "VERIFIED", rule_version: "AE-IN-TOURISM-2026.08.19",
  effective_from: "2026-06-25", last_verified_at: verified,
  official_sources: [
    "https://icp.gov.ae/en/services-details/?serviceid=68f5bcdb8c587a0011cb16d5",
    "https://icp.gov.ae/en/faq/",
    "https://icp.gov.ae/en/media-center/icp-expands-eligibility-for-uae-entry-visa-for-nationals-of-certain-countries/",
  ],
  notes: ["Route is conditional: ordinary passport + qualifying third-country visa/residence/Green Card is required."],
  travel: { ...meta("AE", "AE-IN-TOURISM-2026.08.19", "UAE ICP"), max_stay_days: 60, return_or_onward_required: true, accommodation_required: null, allowed_entry_points: null, transit_review_required: true },
  financial: { ...meta("AE", "AE-IN-TOURISM-2026.08.19", "UAE ICP"), accommodation_required: null, proof_of_funds_required: null, statement_max_age_days: null, minimum_funds_minor: null, minimum_funds_per_day_minor: null, currency: null, sponsor_allowed: null },
  eligibility: { ...meta("AE", "AE-IN-TOURISM-2026.08.19", "UAE ICP", "2026-06-25"), allowed_nationalities: ["IN"], passport_types: ["ORDINARY"], allowed_purposes: ["tourism"], dual_nationality_review: true, prior_refusal_review: true, prior_overstay_review: true, criminal_history_review: true },
  health: { ...meta("AE", "AE-IN-TOURISM-2026.08.19", "UAE ICP"), insurance_required: true, vaccination_required: null, vaccination_codes: null, health_declaration_required: null, recent_country_history_days: null },
  route_conditions: { qualifying_third_country_status_required: true, qualifying_issuers: ["US", "EU", "UK", "JP", "KR", "AU", "CA", "SG", "NZ"], passport_min_validity_months: 6 },
};

// Vietnam: official eVisa application currently exposes ordinary eVisa form,
// requires portrait + passport data page and collects multiple-nationality / law
// violation declarations. Keep ticket/funds/insurance as REVIEW unless separately
// verified by an official rule page.
const VN: CountryRulePack = {
  country: "VN", nationality: "IN", departure_country: "IN", purpose: "tourism",
  journey: "EVISA", state: "VERIFIED", rule_version: "VN-IN-EVISA-2026.08.19",
  effective_from: null, last_verified_at: verified,
  official_sources: ["https://evisa.gov.vn/e-visa/foreigners/"],
  travel: { ...meta("VN", "VN-IN-EVISA-2026.08.19", "Vietnam Immigration Department"), max_stay_days: 90, return_or_onward_required: null, accommodation_required: null, allowed_entry_points: null, transit_review_required: true },
  financial: { ...meta("VN", "VN-IN-EVISA-2026.08.19", "Vietnam Immigration Department"), accommodation_required: null, proof_of_funds_required: null, statement_max_age_days: null, minimum_funds_minor: null, minimum_funds_per_day_minor: null, currency: null, sponsor_allowed: null },
  eligibility: { ...meta("VN", "VN-IN-EVISA-2026.08.19", "Vietnam Immigration Department"), allowed_nationalities: ["IN"], passport_types: ["ORDINARY"], allowed_purposes: ["tourism"], dual_nationality_review: true, prior_refusal_review: true, prior_overstay_review: true, criminal_history_review: true },
  health: { ...meta("VN", "VN-IN-EVISA-2026.08.19", "Vietnam Immigration Department"), insurance_required: null, vaccination_required: null, vaccination_codes: null, health_declaration_required: null, recent_country_history_days: null },
  route_conditions: { passport_data_page_required: true, portrait_required: true, portrait_format: ["jpg", "jpeg"], portrait_max_bytes: 2_000_000 },
};

// Indonesia: official immigration pages list India as eligible for VOA/e-VOA,
// require passport >=6 months and return/onward ticket; B1 stay is 30 days and
// fee is IDR 500,000. e-VOA is a pre-arrival digital route for the same class.
const ID: CountryRulePack = {
  country: "ID", nationality: "IN", departure_country: "IN", purpose: "tourism",
  journey: "EVOA", state: "VERIFIED", rule_version: "ID-IN-EVOA-2026.08.19",
  effective_from: null, last_verified_at: verified,
  official_sources: [
    "https://jakartapusat.imigrasi.go.id/index.php/layanan/warga-negara-asing-wna/visa-republik-indonesia/b1-visa-saat-kedatangan-wisata",
    "https://jakartapusat.imigrasi.go.id/faqs",
  ],
  travel: { ...meta("ID", "ID-IN-EVOA-2026.08.19", "Indonesia Directorate General of Immigration"), max_stay_days: 30, return_or_onward_required: true, accommodation_required: null, allowed_entry_points: null, transit_review_required: true },
  financial: { ...meta("ID", "ID-IN-EVOA-2026.08.19", "Indonesia Directorate General of Immigration"), accommodation_required: null, proof_of_funds_required: false, statement_max_age_days: null, minimum_funds_minor: null, minimum_funds_per_day_minor: null, currency: null, sponsor_allowed: false },
  eligibility: { ...meta("ID", "ID-IN-EVOA-2026.08.19", "Indonesia Directorate General of Immigration"), allowed_nationalities: ["IN"], passport_types: ["ORDINARY"], allowed_purposes: ["tourism"], dual_nationality_review: true, prior_refusal_review: true, prior_overstay_review: true, criminal_history_review: true },
  health: { ...meta("ID", "ID-IN-EVOA-2026.08.19", "Indonesia Directorate General of Immigration"), insurance_required: null, vaccination_required: null, vaccination_codes: null, health_declaration_required: null, recent_country_history_days: null },
  route_conditions: { passport_min_validity_months: 6, passport_biodata_required: true, recent_photo_required: true, government_fee_minor: 50_000_000, fee_currency: "IDR" },
};

// Thailand: May 2026 Cabinet approved a major revision to exemption/VOA lists,
// but the definitive country-by-country rules depend on Ministry of Interior / Royal
// Gazette implementation. Until an authoritative post-effective India classification
// is ingested, do not silently preserve the old 60-day exemption/eVisa assumption.
const TH: CountryRulePack = {
  country: "TH", nationality: "IN", departure_country: "IN", purpose: "tourism",
  journey: "TRANSITION_REVIEW", state: "REVIEW", rule_version: "TH-IN-TRANSITION-2026.08.19",
  effective_from: null, last_verified_at: verified,
  official_sources: [
    "https://www.mfa.go.th/en/content/summary-press-briefing-190526",
    "https://consular.mfa.go.th/th/content/20-5-69-0000",
    "https://www.thaievisa.go.th/",
  ],
  notes: ["Do not auto-offer a legacy 60-day visa-exemption or eVisa route until the post-May-2026 India classification is confirmed from the effective Ministry of Interior/Royal Gazette rule."],
  travel: { ...meta("TH", "TH-IN-TRANSITION-2026.08.19", "Thailand MFA"), max_stay_days: null, return_or_onward_required: null, accommodation_required: null, allowed_entry_points: null, transit_review_required: true },
  financial: { ...meta("TH", "TH-IN-TRANSITION-2026.08.19", "Thailand MFA"), accommodation_required: null, proof_of_funds_required: null, statement_max_age_days: null, minimum_funds_minor: null, minimum_funds_per_day_minor: null, currency: null, sponsor_allowed: null },
  eligibility: { ...meta("TH", "TH-IN-TRANSITION-2026.08.19", "Thailand MFA"), allowed_nationalities: null, passport_types: ["ORDINARY"], allowed_purposes: ["tourism"], dual_nationality_review: true, prior_refusal_review: true, prior_overstay_review: true, criminal_history_review: true },
  health: { ...meta("TH", "TH-IN-TRANSITION-2026.08.19", "Thailand MFA"), insurance_required: null, vaccination_required: null, vaccination_codes: null, health_declaration_required: null, recent_country_history_days: 14 },
};

// Malaysia: official Immigration Dept currently states Indian citizens are visa
// exempt through 31 Dec 2026 for social visits. Do not route Indian tourists into
// a paid eVisa flow during that exemption window.
const MY: CountryRulePack = {
  country: "MY", nationality: "IN", departure_country: "IN", purpose: "tourism",
  journey: "VISA_FREE_TEMPORARY", state: "VERIFIED", rule_version: "MY-IN-VISAEXEMPT-2026.08.19",
  effective_from: "2023-12-01", last_verified_at: verified,
  official_sources: [
    "https://www.imi.gov.my/index.php/en/main-services/visa/visa-requirement-by-country/",
    "https://malaysiavisa.imi.gov.my/faq/",
  ],
  notes: ["Indian citizens are visa-exempt for social visit through 2026-12-31; re-verify before/at expiry."],
  travel: { ...meta("MY", "MY-IN-VISAEXEMPT-2026.08.19", "Malaysia Immigration Department", "2023-12-01"), max_stay_days: 30, return_or_onward_required: true, accommodation_required: true, allowed_entry_points: null, transit_review_required: true },
  financial: { ...meta("MY", "MY-IN-VISAEXEMPT-2026.08.19", "Malaysia Immigration Department", "2023-12-01"), accommodation_required: true, proof_of_funds_required: true, statement_max_age_days: null, minimum_funds_minor: null, minimum_funds_per_day_minor: null, currency: null, sponsor_allowed: null },
  eligibility: { ...meta("MY", "MY-IN-VISAEXEMPT-2026.08.19", "Malaysia Immigration Department", "2023-12-01"), allowed_nationalities: ["IN"], passport_types: ["ORDINARY"], allowed_purposes: ["tourism"], dual_nationality_review: true, prior_refusal_review: true, prior_overstay_review: true, criminal_history_review: true },
  health: { ...meta("MY", "MY-IN-VISAEXEMPT-2026.08.19", "Malaysia Immigration Department", "2023-12-01"), insurance_required: null, vaccination_required: null, vaccination_codes: null, health_declaration_required: null, recent_country_history_days: null },
  route_conditions: { visa_exempt_until: "2026-12-31", do_not_sell_evisa_during_exemption: true },
};

// Cambodia: official eVisa site gives Tourist Visa T, single entry, 3-month visa
// validity, one-month stay, passport >6 months, recent digital passport photo and
// enumerated eVisa entry ports. All travelers must submit Cambodia e-Arrival.
const KH: CountryRulePack = {
  country: "KH", nationality: "IN", departure_country: "IN", purpose: "tourism",
  journey: "EVISA", state: "VERIFIED", rule_version: "KH-IN-EVISA-2026.08.19",
  effective_from: null, last_verified_at: verified,
  official_sources: [
    "https://www.evisa.gov.kh/information/visa_type/4",
    "https://www.evisa.gov.kh/",
  ],
  travel: { ...meta("KH", "KH-IN-EVISA-2026.08.19", "Cambodia eVisa Government"), max_stay_days: 30, return_or_onward_required: null, accommodation_required: null, allowed_entry_points: ["KTI", "SAI", "KOS", "BAVET", "TROPAENG KREAL"], transit_review_required: true },
  financial: { ...meta("KH", "KH-IN-EVISA-2026.08.19", "Cambodia eVisa Government"), accommodation_required: null, proof_of_funds_required: false, statement_max_age_days: null, minimum_funds_minor: null, minimum_funds_per_day_minor: null, currency: null, sponsor_allowed: null },
  eligibility: { ...meta("KH", "KH-IN-EVISA-2026.08.19", "Cambodia eVisa Government"), allowed_nationalities: ["IN"], passport_types: ["ORDINARY"], allowed_purposes: ["tourism"], dual_nationality_review: true, prior_refusal_review: true, prior_overstay_review: true, criminal_history_review: true },
  health: { ...meta("KH", "KH-IN-EVISA-2026.08.19", "Cambodia eVisa Government"), insurance_required: null, vaccination_required: null, vaccination_codes: null, health_declaration_required: true, recent_country_history_days: null },
  route_conditions: { passport_min_validity_months: 6, recent_photo_required: true, e_arrival_required: true, e_arrival_window_days: 7, visa_validity_days: 90, entries: 1, government_fee_minor: 3000, fee_currency: "USD" },
};

export const COUNTRY_RULE_PACKS: Record<string, CountryRulePack> = { AE, VN, ID, TH, MY, KH };

export function getCountryRulePack(country: string, nationality = "IN", purpose = "tourism"): CountryRulePack | null {
  if (String(nationality).toUpperCase() !== "IN" || String(purpose).toLowerCase() !== "tourism") return null;
  return COUNTRY_RULE_PACKS[String(country || "").toUpperCase()] || null;
}

export function listCountryRulePacks(): CountryRulePack[] {
  return Object.values(COUNTRY_RULE_PACKS);
}
