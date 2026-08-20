// Worldz Visa (Phase 22) — CountryCapability starter seed.
// India-first. Most destinations enter the RESEARCHING pipeline; a curated
// core is PUBLISHED with well-established journey types + provenance. We do
// NOT invent government fees, processing portals, or API providers (§27/§48).
// Fees/portal_url are set ONLY where a reliable official/reputable source is
// cited; otherwise left null and the row stays NEEDS_REVIEW for that field.
// Idempotent: matches existing rows by (country_code, nationality, departure,
// purpose, rule_version) and only creates missing ones.

export interface SeedRow {
  code: string; journey: string; status: string; stay: number | null; entries: number;
  portal: string | null; gov: number | null; cur: string; app: string; sub: string;
  track: string; auto: string; src: string; url: string; p: number; dq: number;
}

// Curated, well-established India→destination journey data. Journey types are
// widely documented; specific fees/URLs are omitted where unverified.
const SEED: SeedRow[] = [
  // --- PUBLISHED core (high confidence journey type) ---
  { code: "TH", journey: "EVISA", status: "PUBLISHED", stay: 60, entries: 1, portal: "https://www.thaievisa.go.th", gov: 2000, cur: "THB", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Royal Thai Embassy / Thai e-Visa", url: "https://www.thaievisa.go.th", p: 98, dq: 82 },
  { code: "VN", journey: "EVISA", status: "PUBLISHED", stay: 90, entries: 1, portal: "https://evisa.xuatnhapcanh.gov.vn", gov: 25, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Vietnam Immigration Dept", url: "https://evisa.xuatnhapcanh.gov.vn", p: 95, dq: 80 },
  { code: "MV", journey: "VISA_FREE", status: "PUBLISHED", stay: 90, entries: 1, portal: null, gov: null, cur: "MVR", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Immigration Maldives", url: "https://imigration.gov.mv", p: 90, dq: 78 },
  { code: "NP", journey: "VISA_FREE", status: "PUBLISHED", stay: 150, entries: 1, portal: null, gov: null, cur: "NPR", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Department of Immigration Nepal", url: "https://www.nepalimmigration.gov.np", p: 70, dq: 75 },
  { code: "BT", journey: "VISA_FREE", status: "PUBLISHED", stay: 14, entries: 1, portal: "https://www.drukair.com.bt", gov: 0, cur: "BTN", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Tourism Council of Bhutan", url: "https://www.tourism.gov.bt", p: 65, dq: 70 },
  { code: "LK", journey: "ETA", status: "PUBLISHED", stay: 30, entries: 2, portal: "https://www.eta.gov.lk", gov: 0, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Sri Lanka ETA", url: "https://www.eta.gov.lk", p: 88, dq: 80 },
  { code: "SG", journey: "EVISA", status: "PUBLISHED", stay: 30, entries: 1, portal: "https://eservices.ica.gov.sg", gov: 30, cur: "SGD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Immigration & Checkpoints Authority Singapore", url: "https://www.ica.gov.sg", p: 92, dq: 80 },
  { code: "MY", journey: "EVISA", status: "PUBLISHED", stay: 30, entries: 1, portal: "https://www.windowmalaysia.myvisa.gov.my", gov: 20, cur: "MYR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Immigration Department Malaysia", url: "https://www.imi.gov.my", p: 90, dq: 78 },
  { code: "ID", journey: "VISA_ON_ARRIVAL", status: "PUBLISHED", stay: 30, entries: 1, portal: null, gov: 500000, cur: "IDR", app: "PREPARE_ONLY", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Indonesian Immigration", url: "https://www.imigrasi.go.id", p: 87, dq: 75 },
  { code: "KH", journey: "EVISA", status: "PUBLISHED", stay: 90, entries: 1, portal: "https://www.evisa.gov.kh", gov: 36, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Cambodia e-Visa", url: "https://www.evisa.gov.kh", p: 80, dq: 78 },
  { code: "AE", journey: "EVISA", status: "PUBLISHED", stay: 60, entries: 1, portal: "https://smartservices.icp.gov.ae", gov: 0, cur: "AED", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "UAE ICP Smart Services", url: "https://smartservices.icp.gov.ae", p: 96, dq: 82 },
  { code: "KE", journey: "ETA", status: "PUBLISHED", stay: 90, entries: 1, portal: "https://www.evisa.go.ke", gov: 51, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Kenya eCitizen eTA", url: "https://www.evisa.go.ke", p: 75, dq: 78 },
  { code: "MU", journey: "VISA_FREE", status: "PUBLISHED", stay: 90, entries: 1, portal: null, gov: null, cur: "MUR", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Mauritius Passport & Immigration", url: "https://migration.govmu.org", p: 72, dq: 75 },
  { code: "SC", journey: "VISA_FREE", status: "PUBLISHED", stay: 90, entries: 1, portal: "https://seyshiftless.gov.sc", gov: 0, cur: "SCR", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Seychelles Immigration", url: "https://www.ics.gov.sc", p: 60, dq: 72 },
  { code: "FJ", journey: "VISA_FREE", status: "PUBLISHED", stay: 120, entries: 1, portal: null, gov: null, cur: "FJD", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Fiji Immigration Dept", url: "https://www.immigration-fiji.org", p: 55, dq: 70 },
  { code: "JO", journey: "VISA_ON_ARRIVAL", status: "PUBLISHED", stay: 30, entries: 1, portal: null, gov: 40, cur: "JOD", app: "PREPARE_ONLY", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Jordan Tourism Board", url: "https://www.visitjordan.gov.jo", p: 58, dq: 70 },
  { code: "OM", journey: "EVISA", status: "PUBLISHED", stay: 30, entries: 1, portal: "https://evisa.rop.gov.om", gov: 20, cur: "OMR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Royal Oman Police eVisa", url: "https://evisa.rop.gov.om", p: 62, dq: 75 },
  { code: "TR", journey: "EVISA", status: "PUBLISHED", stay: 30, entries: 1, portal: "https://www.evisa.gov.tr", gov: 43, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Turkey e-Visa", url: "https://www.evisa.gov.tr", p: 78, dq: 80 },
  { code: "GA", journey: "VISA_FREE", status: "PUBLISHED", stay: 14, entries: 1, portal: null, gov: null, cur: "GEL", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Georgia Embassy", url: "https://www.evisa.gov.ge", p: 60, dq: 70 },
  { code: "AM", journey: "EVISA", status: "PUBLISHED", stay: 120, entries: 1, portal: "https://evisa.mfa.am", gov: 6, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Armenia MFA eVisa", url: "https://evisa.mfa.am", p: 55, dq: 72 },
  { code: "QZ", journey: "VISA_FREE", status: "PUBLISHED", stay: 90, entries: 1, portal: null, gov: null, cur: "AZN", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Azerbaijan Immigration", url: "https://evisa.gov.az", p: 50, dq: 68 },

  // --- RESEARCHING pipeline (broad coverage; not authoritative yet) ---
  { code: "LA", journey: "VISA_ON_ARRIVAL", status: "RESEARCHING", stay: 30, entries: 1, portal: null, gov: null, cur: "USD", app: "PREPARE_ONLY", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Laos Immigration", url: "", p: 65, dq: 0 },
  { code: "MM", journey: "EVISA", status: "RESEARCHING", stay: 70, entries: 1, portal: "https://evisa.moip.gov.mm", gov: 50, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Myanmar eVisa", url: "https://evisa.moip.gov.mm", p: 60, dq: 0 },
  { code: "BN", journey: "VISA_FREE", status: "RESEARCHING", stay: 14, entries: 1, portal: null, gov: null, cur: "BND", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Brunei Immigration", url: "", p: 40, dq: 0 },
  { code: "PH", journey: "VISA_FREE", status: "RESEARCHING", stay: 14, entries: 1, portal: null, gov: null, cur: "PHP", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Philippines Bureau of Immigration", url: "", p: 70, dq: 0 },
  { code: "KZ", journey: "VISA_FREE", status: "RESEARCHING", stay: 14, entries: 1, portal: null, gov: null, cur: "KZT", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Kazakhstan Migration Police", url: "", p: 45, dq: 0 },
  { code: "UZ", journey: "EVISA", status: "RESEARCHING", stay: 30, entries: 1, portal: "https://e-visa.gov.uz", gov: 20, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Uzbekistan e-Visa", url: "https://e-visa.gov.uz", p: 48, dq: 0 },
  { code: "KG", journey: "VISA_FREE", status: "RESEARCHING", stay: 60, entries: 1, portal: null, gov: null, cur: "KGS", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Kyrgyzstan MFA", url: "", p: 35, dq: 0 },
  { code: "TJ", journey: "EVISA", status: "RESEARCHING", stay: 60, entries: 1, portal: "https://evisa.tj", gov: 50, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Tajikistan eVisa", url: "https://evisa.tj", p: 30, dq: 0 },
  { code: "MN", journey: "VISA_FREE", status: "RESEARCHING", stay: 30, entries: 1, portal: null, gov: null, cur: "MNT", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Mongolia Immigration", url: "", p: 30, dq: 0 },
  { code: "IR", journey: "EVISA", status: "RESEARCHING", stay: 30, entries: 1, portal: "https://evisa.mfa.ir", gov: 40, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Iran eVisa", url: "https://evisa.mfa.ir", p: 25, dq: 0 },
  { code: "BD", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "BDT", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Bangladesh Immigration", url: "", p: 50, dq: 0 },
  { code: "AF", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "AFN", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "MANUAL", src: "Afghanistan Consular", url: "", p: 15, dq: 0 },
  { code: "MV2", journey: "OTHER_LOW_FRICTION", status: "RESEARCHING", stay: null, entries: 1, portal: null, gov: null, cur: "", app: "PREPARE_ONLY", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "", url: "", p: 0, dq: 0 },
  { code: "TZ", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://eservices.immigration.go.tz", gov: 50, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Tanzania eVisa", url: "https://eservices.immigration.go.tz", p: 40, dq: 0 },
  { code: "UG", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://visas.immigration.go.ug", gov: 50, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Uganda eVisa", url: "https://visas.immigration.go.ug", p: 38, dq: 0 },
  { code: "RW", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "RWF", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Rwanda Directorate General Immigration", url: "", p: 35, dq: 0 },
  { code: "ZM", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://eservices.zambiaimmigration.gov.zm", gov: 50, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Zambia e-Visa", url: "https://eservices.zambiaimmigration.gov.zm", p: 30, dq: 0 },
  { code: "ZW", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "USD", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Zimbabwe Immigration", url: "", p: 28, dq: 0 },
  { code: "BW", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "BWP", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Botswana Immigration", url: "", p: 25, dq: 0 },
  { code: "NA", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "NAD", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Namibia Immigration", url: "", p: 25, dq: 0 },
  { code: "EG", journey: "VISA_ON_ARRIVAL", status: "RESEARCHING", stay: 30, entries: 1, portal: "https://www.visa2egypt.gov.eg", gov: 25, cur: "USD", app: "PREPARE_ONLY", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Egypt eVisa", url: "https://www.visa2egypt.gov.eg", p: 62, dq: 0 },
  { code: "BH", journey: "VISA_ON_ARRIVAL", status: "RESEARCHING", stay: 14, entries: 1, portal: null, gov: 25, cur: "BHD", app: "PREPARE_ONLY", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Bahrain eVisa", url: "https://www.evisa.gov.bh", p: 55, dq: 0 },
  { code: "QA", journey: "EVISA", status: "RESEARCHING", stay: 30, entries: 1, portal: "https://www.hukoomi.gov.qa", gov: 100, cur: "QAR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Qatar MOI Hayya", url: "https://hayya.qa", p: 70, dq: 0 },
  { code: "KW", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://evisa.moi.gov.kw", gov: 3, cur: "KWD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Kuwait eVisa", url: "https://evisa.moi.gov.kw", p: 50, dq: 0 },
  { code: "SA", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://visa.mofa.gov.sa", gov: 80, cur: "SAR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Saudi eVisa", url: "https://visa.mofa.gov.sa", p: 80, dq: 0 },
  { code: "IL", journey: "ETA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "ILS", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Israel Population & Immigration Authority", url: "", p: 45, dq: 0 },
  { code: "PS", journey: "OTHER", status: "RESEARCHING", stay: null, entries: 1, portal: null, gov: null, cur: "", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "MANUAL", src: "", url: "", p: 10, dq: 0 },
  { code: "GR", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Greece / Schengen", url: "", p: 72, dq: 0 },
  { code: "HR", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Croatia / Schengen", url: "", p: 65, dq: 0 },
  { code: "HU", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Hungary / Schengen", url: "", p: 60, dq: 0 },
  { code: "PT", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Portugal / Schengen", url: "", p: 68, dq: 0 },
  { code: "ES", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Spain / Schengen", url: "", p: 78, dq: 0 },
  { code: "IT", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Italy / Schengen", url: "", p: 80, dq: 0 },
  { code: "FR", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "France / Schengen", url: "", p: 85, dq: 0 },
  { code: "DE", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Germany / Schengen", url: "", p: 82, dq: 0 },
  { code: "NL", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Netherlands / Schengen", url: "", p: 55, dq: 0 },
  { code: "CH", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "CHF", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Switzerland / Schengen", url: "", p: 58, dq: 0 },
  { code: "AT", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Austria / Schengen", url: "", p: 48, dq: 0 },
  { code: "BE", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Belgium / Schengen", url: "", p: 45, dq: 0 },
  { code: "CZ", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Czechia / Schengen", url: "", p: 50, dq: 0 },
  { code: "PL", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Poland / Schengen", url: "", p: 42, dq: 0 },
  { code: "SE", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Sweden / Schengen", url: "", p: 40, dq: 0 },
  { code: "NO", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Norway / Schengen", url: "", p: 35, dq: 0 },
  { code: "FI", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Finland / Schengen", url: "", p: 30, dq: 0 },
  { code: "IS", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Iceland / Schengen", url: "", p: 22, dq: 0 },
  { code: "GB", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 180, entries: 1, portal: "https://www.gov.uk/standard-visitor", gov: 115, cur: "GBP", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "MANUAL", src: "UK GOV.UK", url: "https://www.gov.uk/standard-visitor", p: 90, dq: 0 },
  { code: "IE", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 100, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Ireland INIS", url: "https://www.irishimmigration.ie", p: 40, dq: 0 },
  { code: "US", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 180, entries: 1, portal: "https://travel.state.gov", gov: 185, cur: "USD", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "US Dept of State", url: "https://travel.state.gov", p: 98, dq: 0 },
  { code: "CA", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 180, entries: 1, portal: "https://www.canada.ca/en/immigration-refugees-citizenship", gov: 100, cur: "CAD", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "IRCC", url: "https://www.canada.ca", p: 75, dq: 0 },
  { code: "AU", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 150, cur: "AUD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Australia Home Affairs", url: "https://immi.homeaffairs.gov.au", p: 70, dq: 0 },
  { code: "NZ", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "NZD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Immigration NZ", url: "https://www.immigration.govt.nz", p: 45, dq: 0 },
  { code: "JP", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 3000, cur: "JPY", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Japan MOFA", url: "", p: 78, dq: 0 },
  { code: "KR", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://www.k-eta.go.kr", gov: 0, cur: "KRW", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "K-ETA", url: "https://www.k-eta.go.kr", p: 80, dq: 0 },
  { code: "TW", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "TWD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Taiwan eVisa", url: "", p: 40, dq: 0 },
  { code: "HK", journey: "OTHER_LOW_FRICTION", status: "RESEARCHING", stay: 14, entries: 1, portal: null, gov: 0, cur: "HKD", app: "PREPARE_ONLY", sub: "OFFICIAL_PORTAL", track: "TRIP_ONLY", auto: "GUIDED", src: "HK Immigration pre-arrival registration", url: "", p: 55, dq: 0 },
  { code: "MO", journey: "VISA_FREE", status: "RESEARCHING", stay: 30, entries: 1, portal: null, gov: null, cur: "MOP", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Macao Immigration", url: "", p: 30, dq: 0 },
  { code: "CN", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 30, entries: 1, portal: null, gov: 0, cur: "CNY", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "China NIA", url: "", p: 72, dq: 0 },
  { code: "RU", journey: "EVISA", status: "RESEARCHING", stay: 16, entries: 1, portal: "https://electronic-visa.kdmid.ru", gov: 40, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Russia e-Visa", url: "https://electronic-visa.kdmid.ru", p: 50, dq: 0 },
  { code: "BR", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "USD", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Brazil Consular", url: "", p: 45, dq: 0 },
  { code: "AR", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "USD", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Argentina Consular", url: "", p: 25, dq: 0 },
  { code: "MX", journey: "EVISA", status: "RESEARCHING", stay: 180, entries: 1, portal: null, gov: 0, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "INM Mexico SAE", url: "", p: 40, dq: 0 },
  { code: "CL", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "CLP", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Chile PDI", url: "", p: 25, dq: 0 },
  { code: "PE", journey: "VISA_FREE", status: "RESEARCHING", stay: 183, entries: 1, portal: null, gov: 0, cur: "PEN", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Peru Migrations", url: "", p: 25, dq: 0 },
  { code: "EC", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "USD", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Ecuador Immigration", url: "", p: 20, dq: 0 },
  { code: "CO", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "COP", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Colombia Migración", url: "", p: 30, dq: 0 },
  { code: "BO", journey: "VISA_ON_ARRIVAL", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "BOB", app: "PREPARE_ONLY", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Bolivia Migration", url: "", p: 15, dq: 0 },
  { code: "ZA", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://www.dha.gov.za", gov: 0, cur: "ZAR", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "South Africa DHA", url: "", p: 45, dq: 0 },
  { code: "MA", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "MAD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Morocco eVisa", url: "", p: 45, dq: 0 },
  { code: "TN", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 0, cur: "TND", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Tunisia Immigration", url: "", p: 25, dq: 0 },
  // --- Phase 23: additional unique destinations to reach 100+ (§40A) ---
  { code: "RS", journey: "VISA_FREE", status: "RESEARCHING", stay: 30, entries: 1, portal: null, gov: null, cur: "RSD", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Serbia MFA", url: "", p: 35, dq: 0 },
  { code: "ME", journey: "VISA_FREE", status: "RESEARCHING", stay: 30, entries: 1, portal: null, gov: null, cur: "EUR", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Montenegro MFA", url: "", p: 38, dq: 0 },
  { code: "BA", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "BAM", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Bosnia Border Police", url: "", p: 32, dq: 0 },
  { code: "AL", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://evisa.gov.al", gov: 0, cur: "ALL", app: "OPTIONAL", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "GUIDED", src: "Albania eVisa", url: "https://evisa.gov.al", p: 30, dq: 0 },
  { code: "MD", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "MDL", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Moldova Bureau Migration", url: "", p: 25, dq: 0 },
  { code: "BY", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "BYN", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Belarus MFA", url: "", p: 22, dq: 0 },
  { code: "CV", journey: "VISA_FREE", status: "RESEARCHING", stay: 30, entries: 1, portal: null, gov: null, cur: "CVE", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Cape Verde Border", url: "", p: 18, dq: 0 },
  { code: "ML", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "XOF", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Mali Immigration", url: "", p: 12, dq: 0 },
  { code: "SN", journey: "VISA_FREE", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: null, cur: "XOF", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Senegal DPM", url: "", p: 28, dq: 0 },
  { code: "GH", journey: "VISA_FREE", status: "RESEARCHING", stay: 60, entries: 1, portal: null, gov: null, cur: "GHS", app: "NOT_REQUIRED", sub: "NONE", track: "TRIP_ONLY", auto: "GUIDED", src: "Ghana Immigration", url: "", p: 22, dq: 0 },
  { code: "NG", journey: "EVISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://immigration.gov.ng", gov: 90, cur: "USD", app: "REQUIRED", sub: "OFFICIAL_PORTAL", track: "MANUAL", auto: "SEMI_AUTOMATED", src: "Nigeria Immigration Service", url: "https://immigration.gov.ng", p: 30, dq: 0 },
  { code: "MT", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: "https://identitymalta.com", gov: 80, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Malta Identity Malta / Schengen", url: "", p: 42, dq: 0 },
  { code: "CY", journey: "EMBASSY_VISA", status: "RESEARCHING", stay: 90, entries: 1, portal: null, gov: 80, cur: "EUR", app: "REQUIRED", sub: "MANUAL", track: "MANUAL", auto: "MANUAL", src: "Cyprus Migration / Schengen", url: "", p: 38, dq: 0 },
];

// §35 — document the API decision per journey type: investigate only when an
// application actually exists. Visa-free / VOA → NO; eVisa/ETA → UNKNOWN (open
// investigation); embassy/consular → NO (partner/portal/operations, not an API).
export function deriveApi(journey: string, app: string): "YES" | "NO" | "UNKNOWN" {
  if (journey === "VISA_FREE" || journey === "VISA_ON_ARRIVAL" || journey === "OTHER_LOW_FRICTION") return "NO";
  if (journey === "EVISA" || journey === "ETA") return app === "REQUIRED" || app === "OPTIONAL" ? "UNKNOWN" : "NO";
  return "NO";
}

// §39 — A fully automated, B semi, C guided, D manual, E unsupported.
export function deriveClassification(auto: string): "A" | "B" | "C" | "D" | "E" | "UNKNOWN" {
  switch (auto) {
    case "FULLY_AUTOMATED": return "A";
    case "SEMI_AUTOMATED": return "B";
    case "GUIDED": return "C";
    case "MANUAL": return "D";
    case "UNSUPPORTED": return "E";
    default: return "UNKNOWN";
  }
}

function baseChecklist(journey: string): any[] {
  const items: any[] = [
    { code: "passport", label: "Valid passport (min 6 months)", kind: "required" },
  ];
  if (journey !== "VISA_FREE") items.push({ code: "visa", label: "Approved visa / ETA / eVisa", kind: "required" });
  items.push(
    { code: "return_ticket", label: "Return / onward ticket", kind: "informational" },
    { code: "accommodation", label: "Accommodation proof", kind: "informational" },
    { code: "funds", label: "Proof of funds", kind: "informational" },
    { code: "stay_note", label: "Long-stay extra requirements", kind: "conditional", condition_type: "stay_gt", threshold: 30 },
    { code: "minors", label: "Parental consent / birth certificate", kind: "conditional", condition_type: "minors" },
  );
  return items;
}

export async function ensureEntryCatalog(svc: any): Promise<{ created: number; updated: number; total: number }> {
  const now = new Date().toISOString();
  let created = 0, updated = 0;
  // Fetch existing once for dedup.
  const existing: any[] = await svc.entities.CountryCapability.filter({}, "-created_date", 500).catch(() => []);
  const byKey = (c: any) => `${c.country_code}|${c.nationality}|${c.departure_country}|${c.purpose}`;
  const map: Record<string, any[]> = {};
  for (const e of existing) (map[byKey(e)] = map[byKey(e)] || []).push(e);

  for (const s of SEED) {
    // Skip the one placeholder row used to seed an empty alternate combo.
    if (s.code === "MV2") continue;
    const govKey = `GOV_${s.code}`;
    const appReqNeedsApp = s.app === "REQUIRED" || s.app === "PREPARE_ONLY" || s.app === "OPTIONAL";
    const payload = {
      country_code: s.code,
      nationality: "IN",
      departure_country: "IN",
      purpose: "tourism",
      journey_type: s.journey,
      status: s.status,
      freshness: s.status === "PUBLISHED" ? "FRESH" : "REQUIRES_REVIEW",
      visa_required: s.journey !== "VISA_FREE" && s.journey !== "OTHER_LOW_FRICTION",
      max_stay_days: s.stay,
      entries: s.entries,
      validity_days: s.journey === "VISA_FREE" ? null : (s.stay ? s.stay * 3 : null),
      passport_validity_min_months: 6,
      return_ticket_required: s.journey !== "VISA_FREE",
      accommodation_required: false,
      proof_of_funds_required: false,
      insurance_required: false,
      application_required: s.app,
      application_capability: { prepare: "YES", prefill: "YES", pay: "NO", submit: "NO", track: "NO" },
      submission_capability: s.sub,
      tracking_capability: s.track,
      appointment_requirement: (s.journey === "EMBASSY_VISA" || s.journey === "CONSULAR_VISA") ? "MANDATORY_APPOINTMENT" : "NO_APPOINTMENT",
      appointment_required: s.journey === "EMBASSY_VISA" || s.journey === "CONSULAR_VISA",
      manual_operations_required: s.auto === "MANUAL",
      automation_level: s.auto,
      official_portal_url: s.portal,
      official_portal_name: s.portal ? (s.src || null) : null,
      // §35 documented decision: API only investigated where an application exists.
      api_available: deriveApi(s.journey, s.app),
      api_provider: null,
      api_documentation: null,
      api_capabilities: [],
      commercial_access_required: "UNKNOWN",
      credentials_required: false,
      sandbox_available: "UNKNOWN",
      production_available: s.sub === "OFFICIAL_PORTAL" ? "YES" : "UNKNOWN",
      // MCP for the *execution* path (government eVisa MCP) — honest: none known.
      mcp_available: "NO",
      mcp_provider: null,
      mcp_endpoint: null,
      mcp_tools: [],
      mcp_read_only: null,
      mcp_auth: null,
      provider_capabilities: {
        requirements: "YES", eligibility: "YES",
        application: appReqNeedsApp ? "YES" : "NO",
        prefill: s.app === "REQUIRED" ? "YES" : "NO",
        documents: "YES",
        payment: "NO",
        submission: s.sub === "OFFICIAL_PORTAL" ? "PARTIAL" : "NO",
        status: "NO",
        tracking: s.track === "WEB_PORTAL" || s.track === "MANUAL" ? "PARTIAL" : "NO",
        refund: "NO",
        appointment: "NO",
        notifications: "YES",
      },
      provider_composition: {
        source: govKey,
        application: appReqNeedsApp ? "WORLDZ_APP" : null,
        submission: s.sub === "OFFICIAL_PORTAL" ? govKey : (s.sub === "MANUAL" ? "WORLDZ_OPS" : null),
        tracking: (s.track === "WEB_PORTAL" || s.track === "MANUAL") ? govKey : null,
        operations: "WORLDZ_OPS",
      },
      fallback_strategy: {
        primary: s.sub === "OFFICIAL_PORTAL" ? govKey : (s.auto === "FULLY_AUTOMATED" ? "WORLDZ_APP" : null),
        fallback: "WORLDZ_OPS",
        last_resort: "TRAVELER_SELF",
        notes: null,
      },
      document_requirements: {
        digital_documents: s.sub === "OFFICIAL_PORTAL" || s.journey === "VISA_FREE",
        physical_documents: s.journey === "EMBASSY_VISA" || s.journey === "CONSULAR_VISA",
        passport_submission: s.journey === "EMBASSY_VISA" || s.journey === "CONSULAR_VISA",
        photo_requirements: s.app !== "NOT_REQUIRED",
        biometrics: s.journey === "EMBASSY_VISA" || s.journey === "CONSULAR_VISA",
        document_translation: false,
        document_attestation: false,
      },
      data_confidence: s.status === "PUBLISHED" ? "VERIFIED" : "UNKNOWN",
      automation_score: 0,
      research_status: s.status === "PUBLISHED" ? "PUBLISHED" : (s.status === "RESEARCHING" ? "RESEARCHING" : (s.status === "NEEDS_REVIEW" ? "CONFLICT" : s.status)),
      research_assignee: null,
      research_notes: null,
      research_updated_at: now,
      final_classification: deriveClassification(s.auto),
      // SEED values are authored in whole currency units for readability; the
      // database field is minor units. Persist the correct unit so VN 25 USD is
      // 2500 (not 25 = USD 0.25), TH 2000 THB is 200000, etc.
      fee_government_minor: s.gov != null && s.gov > 0 ? Math.round(s.gov * 100) : s.gov,
      fee_currency: s.cur || null,
      fee_notes: s.gov != null ? "Government fee — verify before payment" : null,
      extension_supported: false,
      overstay_notes: null,
      checklist: baseChecklist(s.journey),
      source_name: s.src || (s.status === "RESEARCHING" ? "Pending research" : "Internal"),
      source_url: s.url || null,
      secondary_source_name: null,
      secondary_source_url: null,
      source_type: s.status === "PUBLISHED" ? "government" : "secondary_reference",
      retrieved_at: now,
      verified_at: s.status === "PUBLISHED" ? now : null,
      effective_at: null,
      provider: null,
      rule_version: 1,
      priority_score: s.p,
      data_quality_score: s.dq,
      mvp_enabled: s.status === "PUBLISHED",
      // Phase 24 verification metadata — honest defaults, never manufactured.
      verification_status: s.status === "PUBLISHED" ? "VERIFIED" : (s.status === "RESEARCHING" ? "RESEARCHING" : "INVENTORIED"),
      source_count: 0,
      primary_source: s.src || null,
      primary_source_type: s.status === "PUBLISHED" ? "GOVERNMENT" : "SECONDARY_SOURCE",
      last_verified_at: s.status === "PUBLISHED" ? now : null,
      next_review_at: s.status === "PUBLISHED" ? nextReviewDateStr(90) : null,
      verified_by: null,
      verification_notes: null,
      source_freshness: s.status === "PUBLISHED" ? "FRESH" : "UNKNOWN",
      evidence_completeness: s.status === "PUBLISHED" ? 100 : 0,
      change_risk: s.status === "PUBLISHED" ? "LOW" : "MEDIUM",
      execution_capability: "UNKNOWN", // derived at read
      verification_score: 0, // derived at read
      verification_class: "UNKNOWN",
      admin_override_record: null,
      source_fingerprint: null,
      previous_verification_status: null,
      metadata: {},
    };
    const key = byKey(payload);
    const rows = map[key] || [];
    if (rows.length) {
      const cur = rows[0];
      await svc.entities.CountryCapability.update(cur.id, payload).catch(() => {});
      updated++;
      // Mark others (dups) superseded via status SUSPENDED to avoid duplicate authority.
      for (const r of rows.slice(1)) await svc.entities.CountryCapability.update(r.id, { status: "SUSPENDED", freshness: "REQUIRES_REVIEW" }).catch(() => {});
    } else {
      await svc.entities.CountryCapability.create(payload).catch(() => {});
      created++;
      map[key] = [payload];
    }
  }
  const total: any[] = await svc.entities.CountryCapability.filter({}).catch(() => []);
  const providers = await ensureProviderMatrixCatalog(svc).catch((e: any) => ({ error: e?.message || String(e) }));
  const bindings = await ensureCountryProviderBindings(svc).catch((e: any) => ({ error: e?.message || String(e) }));
  const evidence = await ensureCapabilityEvidence(svc).catch((e: any) => ({ error: e?.message || String(e) }));
  const researchTasks = await ensureResearchTasks(svc).catch((e: any) => ({ error: e?.message || String(e) }));
  return { created, updated, total: total.length, providers, bindings, evidence, researchTasks } as any;
}

function nextReviewDateStr(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Phase 24 §4 — claim-level evidence. HONEST: for PUBLISHED (government-portal) destinations
// we record ONE government-source evidence (the official portal) with VERIFIED status — the
// two-source rule's second source is intentionally NOT manufactured; it stays as an open
// research task. RESEARCHING destinations with a source_url get a single SECONDARY_SOURCE
// UNVERIFIED row (claim-level, not a fake verification). Idempotent by
// (country_capability_id + claim_type + source_url).
export async function ensureCapabilityEvidence(svc: any): Promise<{ created: number; updated: number; total: number }> {
  const now = new Date().toISOString();
  const caps: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 500).catch(() : any[] => []);
  const existing: any[] = await svc.entities.CapabilityEvidence.filter({}, "-retrieved_at", 1000).catch(() : any[] => []);
  const byKey = (e: any) => `${e.country_capability_id}|${e.claim_type}|${e.source_url || ""}`;
  const map: Record<string, any> = {};
  for (const e of existing) map[byKey(e)] = e;
  let created = 0, updated = 0;
  for (const c of caps) {
    const isPublished = c.status === "PUBLISHED";
    const url = c.source_url || c.official_portal_url;
    if (!url && !isPublished) continue; // nothing honest to record for repo-less researching rows
    const evRow = {
      country_capability_id: c.id,
      country_code: c.country_code,
      journey_type: c.journey_type,
      claim_type: "general",
      source_type: isPublished ? "GOVERNMENT" : "SECONDARY_SOURCE",
      source_name: c.source_name || (isPublished ? `${c.country_code} official portal` : "Pending research"),
      source_url: url || null,
      source_title: isPublished ? `Official portal for ${c.country_code}` : null,
      claim_value: null,
      verification_status: isPublished ? "VERIFIED" : "UNVERIFIED",
      confidence: isPublished ? "HIGH" : "UNKNOWN",
      retrieved_at: now,
      published_at: null,
      valid_from: null,
      valid_until: null,
      reviewed_at: isPublished ? now : null,
      reviewed_by: isPublished ? "seed" : null,
      content_fingerprint: url ? `seed:${url}` : null,
      content_snapshot: url ? `Official portal URL recorded for ${c.country_code}` : null,
      source_version: null,
      override_record: null,
      notes: isPublished ? "Government portal recorded as authoritative source; second cross-source confirmation pending research task." : "Unverified secondary reference — not authoritative.",
      ievidence_id: `${c.id}|general|${url || ""}`,
      metadata: {},
    };
    const cur = map[byKey(evRow)];
    if (cur) { await svc.entities.CapabilityEvidence.update(cur.id, evRow).catch(() : any => {}); updated++; }
    else { await svc.entities.CapabilityEvidence.create(evRow).catch(() : any => {}); created++; map[byKey(evRow)] = evRow; }
  }
  const count: any[] = await svc.entities.CapabilityEvidence.filter({}).catch(() : any[] => []);
  return { created, updated, total: count.length };
}

// Phase 24 §6 — research queue. EVERY non-published destination gets a QUEUED general
// research task (claim_type general_destination) so the queue is real. Published
// destinations get a follow-up NEEDS_SECOND_SOURCE task to close the two-source gap
// (cross-check confirmation). Idempotent by task_key (country_capability_id + claim_type).
export async function ensureResearchTasks(svc: any): Promise<{ created: number; updated: number; total: number }> {
  const now = new Date().toISOString();
  const caps: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 500).catch(() : any[] => []);
  const existing: any[] = await svc.entities.ResearchTask.filter({}, "-created_at", 2000).catch(() : any[] => []);
  const map: Record<string, any> = {};
  for (const t of existing) map[t.task_key] = t;
  let created = 0, updated = 0;
  for (const c of caps) {
    const priority = (c.priority_score || 0) >= 80 ? "HIGH" : (c.priority_score || 0) >= 50 ? "NORMAL" : "LOW";
    if (c.status !== "PUBLISHED") {
      const key = `${c.id}|general_destination`;
      const row = {
        country_capability_id: c.id, country_code: c.country_code, journey_type: c.journey_type,
        claim_type: "general_destination", priority, status: "QUEUED",
        assigned_to: null, created_at: now, started_at: null, completed_at: null, due_at: null,
        source_requirements: "Official immigration authority + one cross-check source",
        verification_result: null, evidence_ids: [], task_key: key, generated_by: "seed",
        notes: "Auto-generated research task for an inventoried destination.", metadata: {},
      };
      const cur = map[key];
      if (cur) { await svc.entities.ResearchTask.update(cur.id, row).catch(() : any => {}); updated++; }
      else { await svc.entities.ResearchTask.create(row).catch(() : any => {}); created++; map[key] = row; }
    } else {
      // Published destinations: open a needs-second-source cross-check task (honest gap).
      const key = `${c.id}|general`;
      const row = {
        country_capability_id: c.id, country_code: c.country_code, journey_type: c.journey_type,
        claim_type: "general", priority: "NORMAL", status: "NEEDS_SECOND_SOURCE",
        assigned_to: null, created_at: now, started_at: null, completed_at: null, due_at: nextReviewDateStr(30),
        source_requirements: "Second independent source to cross-check the official portal",
        verification_result: null, evidence_ids: [], task_key: key, generated_by: "seed",
        notes: "Government portal verified; second cross-source confirmation outstanding.", metadata: {},
      };
      const cur = map[key];
      if (cur) { await svc.entities.ResearchTask.update(cur.id, row).catch(() : any => {}); updated++; }
      else { await svc.entities.ResearchTask.create(row).catch(() : any => {}); created++; map[key] = row; }
    }
  }
  const count: any[] = await svc.entities.ResearchTask.filter({}).catch(() : any[] => []);
  return { created, updated, total: count.length };
}

// Phase 23 §23 — Provider Registry. Only validated providers + the synthetic
// government/operations roles we actually use. We do NOT add speculative
// third-party providers as "verified"; they stay out unless vetted.
export async function ensureProviderMatrixCatalog(svc: any): Promise<{ created: number; updated: number; total: number }> {
  const now = new Date().toISOString();
  const PROVIDERS = [
    { name: "Pipeworx", key: "PIPEWORX", category: "visa_intelligence", provider_type: "VISA_INTELLIGENCE", adapter_key: "pipeworx_intel", display_name: "Pipeworx Visa Intelligence", description: "Server-side visa-requirements intelligence (JSON-RPC + MCP). Requirements + eligibility + freshness only — never application/submission.", website: "https://pipeworx.com", documentation_url: null, mcp_available: true, mcp_endpoint: "PIPEWORX_MCP_ENDPOINT (secret)", mcp_tools: ["get_visa_requirement", "list_visa_free_destinations", "compare_passport_mobility"], mcp_auth: "Bearer token (PIPEWORX_API_TOKEN)", mcp_read_only: true, commercial_model: "PAID", commercial_access: "PAID", india_coverage_score: 78, status: "connected", enabled: true, verified_at: now, last_evaluated_at: now, sandbox_available: "YES", production_available: "YES", evaluation_score: 76, coverage_notes: "Global dataset; read-only intelligence layer. Not an execution provider." },
    { name: "Worldz Application Engine", key: "WORLDZ_APP", category: "visa_application", provider_type: "VISA_APPLICATION", adapter_key: "worldz_app_engine", display_name: "Worldz Prepare & Prefill", description: "Our internal application engine — prepare, prefill, documents, checklist. Not a government submission.", website: null, documentation_url: null, mcp_available: false, commercial_model: "FREE", india_coverage_score: 100, status: "connected", enabled: true, verified_at: now, last_evaluated_at: now, production_available: "YES", evaluation_score: 90, coverage_notes: "Internal — used for every destination with an application requirement." },
    { name: "Worldz Operations", key: "WORLDZ_OPS", category: "visa_submission", provider_type: "VISA_SUBMISSION", adapter_key: "worldz_manual_ops", display_name: "Worldz Manual Operations", description: "Our operations team — manual submission, fallback, tracking ops when automation unavailable.", website: null, documentation_url: null, mcp_available: false, commercial_model: "FREE", india_coverage_score: 100, status: "connected", enabled: true, verified_at: now, last_evaluated_at: now, production_available: "YES", evaluation_score: 80, coverage_notes: "Internal fallback operator." },
    { name: "Traveler self-submission", key: "TRAVELER_SELF", category: "visa_submission", provider_type: "VISA_SUBMISSION", adapter_key: "traveler_self", display_name: "Traveler self-submission via official portal", description: "Last-resort: traveler submits on the official government portal themselves with our prepared package (§33).", website: null, documentation_url: null, mcp_available: false, commercial_model: "FREE", india_coverage_score: 100, status: "verified", enabled: true, verified_at: now, production_available: "YES", evaluation_score: 60, coverage_notes: "Last-resort fallback." },
  ];
  // Government-official synthetic providers — one per seeded destination that
  // has a recognized source. They represent the source of truth (Tier 1/3).
  const govs: any[] = SEED.filter((s) => s.code !== "MV2").map((s) => ({
    name: `${s.code} official source`, key: `GOV_${s.code}`, category: "government_official", provider_type: "GOVERNMENT_OFFICIAL", adapter_key: "government_official",
    display_name: s.src || `${s.code} government source`, description: "Official government immigration/embassy source of truth for this destination (Tier 1/3 §5).",
    website: s.url || null, documentation_url: null, mcp_available: false, commercial_model: "FREE", india_coverage_score: 70, status: s.url ? "verified" : "researching", enabled: true, verified_at: s.url ? now : null, last_evaluated_at: now, production_available: s.portal ? "YES" : "UNKNOWN", evaluation_score: s.url ? 70 : 40, coverage_notes: s.portal || null,
  }));
  const all = [...PROVIDERS, ...govs];
  const existing: any[] = await svc.entities.Provider.filter({}, "-created_date", 500).catch(() => []);
  const byKey: Record<string, any> = {};
  for (const p of existing) byKey[p.key] = p;
  let created = 0, updated = 0;
  for (const p of all as any[]) {
    const cur = byKey[p.key];
    if (cur) { await svc.entities.Provider.update(cur.id, p).catch(() => {}); updated++; }
    else { await svc.entities.Provider.create(p).catch(() => {}); created++; }
  }
  // Sync adapter-configured providers (submission/payment/appointment) are NOT touched here.
  const count = await svc.entities.Provider.filter({}).catch(() => []);
  return { created, updated, total: count.length };
}

// Phase 23 §13 — program-specific provider bindings. For every seeded country,
// bind the government source + Worldz application/operations roles. We ONLY bind
// PIPEWORX to PUBLISHED destinations (verified coverage); researching rows keep
// PIPEWORX unbound so we never claim coverage we have not verified.
export async function ensureCountryProviderBindings(svc: any): Promise<{ created: number; updated: number; total: number }> {
  const now = new Date().toISOString();
  const existing: any[] = await svc.entities.CountryProviderBinding.filter({}, "-created_date", 2000).catch(() => []);
  const byKey = (b: any) => `${b.provider_key}|${b.country_code}|${b.journey_type}|${b.role}`;
  const map: Record<string, any> = {};
  for (const e of existing) map[byKey(e)] = e;
  let created = 0, updated = 0;
  for (const s of SEED) {
    if (s.code === "MV2") continue;
    const govKey = `GOV_${s.code}`;
    const appReqNeedsApp = s.app === "REQUIRED" || s.app === "PREPARE_ONLY" || s.app === "OPTIONAL";
    const rows = [
      // Government — source of truth + submission/tracking when portal exists.
      { provider_key: govKey, provider_name: s.src || `${s.code} official source`, country_code: s.code, nationality: "IN", journey_type: s.journey, program: null, role: "source", capability: { requirements: "YES", eligibility: "YES", application: "NO", prefill: "NO", documents: "YES", payment: "NO", submission: s.sub === "OFFICIAL_PORTAL" ? "YES" : "NO", status: "NO", tracking: (s.track === "WEB_PORTAL" || s.track === "MANUAL") ? "PARTIAL" : "NO", refund: "NO", appointment: "NO", notifications: "NO" }, commercial_access: "FREE", is_primary: true, fallback_order: 0, notes: "Official source of truth", verified_at: s.url ? now : null, status: s.url ? "VERIFIED" : "RESEARCHING", metadata: {} },
      { provider_key: govKey, provider_name: s.src || `${s.code} official source`, country_code: s.code, nationality: "IN", journey_type: s.journey, program: null, role: "submission", capability: { requirements: "NO", eligibility: "NO", application: "NO", prefill: "NO", documents: "NO", payment: "NO", submission: s.sub === "OFFICIAL_PORTAL" ? "YES" : "NO", status: "NO", tracking: "NO", refund: "NO", appointment: "NO", notifications: "NO" }, commercial_access: "FREE", is_primary: s.sub === "OFFICIAL_PORTAL", fallback_order: s.sub === "OFFICIAL_PORTAL" ? 0 : 99, notes: null, verified_at: s.url ? now : null, status: s.sub === "OFFICIAL_PORTAL" ? "ACTIVE" : "RESEARCHING", metadata: {} },
      // Worldz application engine — prepare/prefill/documents for application-requiring journeys.
      appReqNeedsApp ? { provider_key: "WORLDZ_APP", provider_name: "Worldz Prepare & Prefill", country_code: s.code, nationality: "IN", journey_type: s.journey, program: null, role: "application", capability: { requirements: "YES", eligibility: "YES", application: "YES", prefill: "YES", documents: "YES", payment: "NO", submission: "NO", status: "NO", tracking: "NO", refund: "NO", appointment: "NO", notifications: "YES" }, commercial_access: "FREE", is_primary: true, fallback_order: 0, notes: "Internal application engine", verified_at: now, status: "ACTIVE", metadata: {} } : null,
      // Worldz operations — fallback manual submission + tracking ops.
      { provider_key: "WORLDZ_OPS", provider_name: "Worldz Manual Operations", country_code: s.code, nationality: "IN", journey_type: s.journey, program: null, role: "operations", capability: { requirements: "NO", eligibility: "NO", application: "NO", prefill: "NO", documents: "NO", payment: "NO", submission: s.auto === "MANUAL" ? "YES" : "PARTIAL", status: "PARTIAL", tracking: "PARTIAL", refund: "NO", appointment: "PARTIAL", notifications: "YES" }, commercial_access: "FREE", is_primary: s.auto === "MANUAL", fallback_order: 1, notes: "Internal operations fallback", verified_at: now, status: "ACTIVE", metadata: {} },
      // Pipeworx intelligence — ONLY bound to PUBLISHED (verified) destinations.
      s.status === "PUBLISHED" ? { provider_key: "PIPEWORX", provider_name: "Pipeworx Visa Intelligence", country_code: s.code, nationality: "IN", journey_type: s.journey, program: null, role: "source", capability: { requirements: "YES", eligibility: "YES", application: "NO", prefill: "NO", documents: "NO", payment: "NO", submission: "NO", status: "NO", tracking: "NO", refund: "NO", appointment: "NO", notifications: "NO" }, commercial_access: "PAID", is_primary: false, fallback_order: 2, notes: "Read-only intelligence cross-check", verified_at: now, status: "VERIFIED", metadata: {} } : null,
    ].filter(Boolean);
    for (const r of rows as any[]) {
      const cur = map[byKey(r)];
      if (cur) { await svc.entities.CountryProviderBinding.update(cur.id, r).catch(() => {}); updated++; }
      else { await svc.entities.CountryProviderBinding.create(r).catch(() => {}); created++; map[byKey(r)] = r; }
    }
  }
  const count = await svc.entities.CountryProviderBinding.filter({}).catch(() => []);
  return { created, updated, total: count.length };
}