// Krosz India-first commercial boundary.
// Discovery/eligibility coverage is intentionally broader than the currently
// priced checkout set. The launch list below is based on the current Government
// of India MEA low-friction/e-Visa universe for Indian ordinary passport holders.
// Country-specific capability/verification gates still decide whether a route is
// public/actionable; adding a country here MUST NOT bypass passport-submission,
// biometrics, physical-document, freshness, or verification checks.

// 62 electronic/low-friction candidates. This lets SEO/discovery and the visa
// engine expand without inventing pricing. Checkout pricing remains limited to
// PRICE entries below until government + service fees are verified country-by-country.
export const KROSZ_MVP_COUNTRIES = [
  "AL", "AO", "AG", "AR", "AM", "AU", "AZ", "BH", "BJ", "BW", "BF", "KH",
  "CM", "CL", "CI", "CU", "DJ", "EG", "ET", "GA", "GE", "GQ", "HK", "IL",
  "ID", "JP", "JO", "KZ", "KE", "KG", "LA", "MW", "MY", "MD", "MR", "MN",
  "MA", "MZ", "MM", "NA", "NG", "NZ", "OM", "PH", "GN", "RU", "ST", "SG",
  "ZA", "SS", "LK", "SR", "SY", "TW", "TJ", "TZ", "TH", "TG", "TR", "AE",
  "UG", "UA", "UZ", "VN", "ZM"
] as const;
export const KROSZ_MVP_SET = new Set<string>(KROSZ_MVP_COUNTRIES as readonly string[]);

// The original ten destinations have reviewed INR checkout benchmarks. New
// launch candidates may be discoverable/actionable only when their verified
// capability allows it; no price is fabricated for them.
export const KROSZ_PRICED_COUNTRIES = ["AE", "VN", "ID", "TH", "MY", "LK", "TR", "AZ", "GE", "KH"] as const;
export const KROSZ_PRICED_SET = new Set<string>(KROSZ_PRICED_COUNTRIES as readonly string[]);

export interface MvpPriceBenchmark {
  country_code: string;
  government_inr_minor: number;
  atlys_benchmark_fee_inr_minor: number;
  krosz_service_inr_minor: number;
  currency: "INR";
  benchmark_date: string;
  benchmark_ratio: number;
  service_fee_tax_inclusive: boolean;
}

// Temporary launch benchmark requested by product: Krosz service fee = 75% of
// the current Atlys India-facing benchmark used in the MVP pricing review.
// Keep this in one file so the benchmark can be replaced without touching visa
// rules, case state, or checkout logic.
const PRICE: Record<string, Omit<MvpPriceBenchmark, "country_code">> = {
  AE: { government_inr_minor: 710000, atlys_benchmark_fee_inr_minor: 82100,  krosz_service_inr_minor: 61600,  currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  VN: { government_inr_minor: 248800, atlys_benchmark_fee_inr_minor: 156200, krosz_service_inr_minor: 117200, currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  ID: { government_inr_minor: 299600, atlys_benchmark_fee_inr_minor: 89900,  krosz_service_inr_minor: 67400,  currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  TH: { government_inr_minor: 0,      atlys_benchmark_fee_inr_minor: 40000,  krosz_service_inr_minor: 30000,  currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  MY: { government_inr_minor: 0,      atlys_benchmark_fee_inr_minor: 30000,  krosz_service_inr_minor: 22500,  currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  LK: { government_inr_minor: 0,      atlys_benchmark_fee_inr_minor: 30000,  krosz_service_inr_minor: 22500,  currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  TR: { government_inr_minor: 463200, atlys_benchmark_fee_inr_minor: 321800, krosz_service_inr_minor: 241400, currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  AZ: { government_inr_minor: 287100, atlys_benchmark_fee_inr_minor: 207900, krosz_service_inr_minor: 155900, currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  GE: { government_inr_minor: 355000, atlys_benchmark_fee_inr_minor: 205500, krosz_service_inr_minor: 154100, currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
  KH: { government_inr_minor: 289000, atlys_benchmark_fee_inr_minor: 136000, krosz_service_inr_minor: 102000, currency: "INR", benchmark_date: "2026-08-19", benchmark_ratio: 0.75, service_fee_tax_inclusive: true },
};

export function isKroszMvpCountry(code: any): boolean {
  return KROSZ_MVP_SET.has(String(code || "").toUpperCase());
}

export function hasKroszVerifiedPrice(code: any): boolean {
  return KROSZ_PRICED_SET.has(String(code || "").toUpperCase());
}

export function mvpPricingFor(code: any): MvpPriceBenchmark | null {
  const country_code = String(code || "").toUpperCase();
  const row = PRICE[country_code];
  return row ? { country_code, ...row } : null;
}

// Compatibility with two legacy capability seed codes. Public/application ISO
// codes remain AZ and GE; only the internal capability lookup aliases these.
export const LEGACY_CAPABILITY_ALIAS: Record<string, string> = { AZ: "QZ", GE: "GA" };
