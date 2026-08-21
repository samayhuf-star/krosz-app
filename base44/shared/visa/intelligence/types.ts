// Worldz Visa (Phase 22) — Visa Intelligence provider capability + normalized model.
// The application depends on this interface, never on any specific provider.
// Pipeworx is one adapter behind it; the internal Visa Intelligence layer
// (VisaRoute / VisaRequirementsVersion / VisaRequirement) remains the canonical
// contract for application behaviour and rule snapshots.

export const VISA_STATUS = {
  VISA_FREE: "visa_free",
  VISA_ON_ARRIVAL: "visa_on_arrival",
  EVISA: "e_visa",
  ETA: "eta",
  VISA_REQUIRED: "visa_required",
  NO_ADMISSION: "no_admission",
  OTHER: "other",
} as const;
export type VisaStatus = typeof VISA_STATUS[keyof typeof VISA_STATUS];

export const CONFIDENCE = {
  HIGH_CONFIDENCE: "HIGH_CONFIDENCE",
  NORMAL: "NORMAL",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  UNAVAILABLE: "UNAVAILABLE",
} as const;
export type ProviderConfidence = typeof CONFIDENCE[keyof typeof CONFIDENCE];

export const FRESHNESS = { FRESH: "FRESH", STALE: "STALE", EXPIRED: "EXPIRED" } as const;
export type Freshness = typeof FRESHNESS[keyof typeof FRESHNESS];

// Normalized provider result — the ONLY shape the rest of the app consumes.
export interface NormalizedVisaRequirement {
  provider: string;            // e.g. "PIPEWORX"
  provider_endpoint?: string;
  nationality: string;        // ISO alpha-2
  destination: string;         // ISO alpha-2
  visa_status: VisaStatus;
  visa_status_label?: string;
  stay_duration_days?: number | null;
  source?: string;             // human source string from provider
  dataset_last_updated?: string;
  retrieved_at: string;        // ISO timestamp we fetched it
  verified_at?: string;        // dataset_last_updated — NEVER an official embassy decision
  confidence: ProviderConfidence;
  provider_reference?: string;
  disclaimer?: string;
  intelligence_only?: boolean;
  submission_capability?: "UNKNOWN" | "UNSUPPORTED";
}

export interface ProviderResult {
  ok: boolean;
  result?: NormalizedVisaRequirement;
  error?: string;
  transient?: boolean;         // transient => retryable / circuit counts it
}

export interface PassportMobilityCounts {
  visa_free?: number;
  visa_on_arrival?: number;
  e_visa?: number;
  eta?: number;
  visa_required?: number;
  no_admission?: number;
}

export interface VisaFreeDestinationsResult {
  provider: string;
  passport: { code: string; name?: string };
  counts: PassportMobilityCounts;
  groups: { visa_free: any[]; visa_on_arrival: any[]; e_visa: any[]; eta: any[]; visa_required?: any[] };
  source?: string;
  dataset_last_updated?: string;
  disclaimer?: string;
  retrieved_at: string;
  confidence: ProviderConfidence;
}

export interface PassportCompareResult {
  provider: string;
  passports: Array<{ passport: { code: string; name?: string }; counts: PassportMobilityCounts; mobility_score_visa_free_or_on_arrival?: number }>;
  differences?: Array<Record<string, any>>;
  source?: string;
  dataset_last_updated?: string;
  disclaimer?: string;
  retrieved_at: string;
}

// Capability interface every visa-intelligence provider must implement.
export interface VisaIntelligenceProvider {
  key: string;
  displayName: string;
  isAvailable: boolean;
  getVisaRequirement(nationality: string, destination: string): Promise<ProviderResult>;
  getVisaFreeDestinations?(passport: string): Promise<{ ok: boolean; result?: VisaFreeDestinationsResult; error?: string; transient?: boolean }>;
  comparePassports?(passports: string[]): Promise<{ ok: boolean; result?: PassportCompareResult; error?: string; transient?: boolean }>;
}

// Map any provider requirement token into our canonical enum.
const TOKEN_MAP: Record<string, VisaStatus> = {
  visa_free: VISA_STATUS.VISA_FREE,
  visa_not_required: VISA_STATUS.VISA_FREE,
  freedom_of_movement: VISA_STATUS.VISA_FREE,
  visa_on_arrival: VISA_STATUS.VISA_ON_ARRIVAL,
  visa_free_on_arrival: VISA_STATUS.VISA_ON_ARRIVAL,
  e_visa: VISA_STATUS.EVISA,
  evisa: VISA_STATUS.EVISA,
  online_visa_required: VISA_STATUS.EVISA,
  eta: VISA_STATUS.ETA,
  e_ta: VISA_STATUS.ETA,
  visa_waiver_registration: VISA_STATUS.ETA,
  tourist_card: VISA_STATUS.ETA,
  visa_required: VISA_STATUS.VISA_REQUIRED,
  not_admitted: VISA_STATUS.NO_ADMISSION,
  no_admission: VISA_STATUS.NO_ADMISSION,
  "no admission": VISA_STATUS.NO_ADMISSION,
};

export function mapVisaStatusToken(raw: any): VisaStatus {
  const k = String(raw || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return TOKEN_MAP[k] || VISA_STATUS.OTHER;
}

export function isKnownVisaStatus(raw: any): boolean {
  const k = String(raw || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return Object.prototype.hasOwnProperty.call(TOKEN_MAP, k);
}

// Deterministic confidence classification (§9). No invented numeric scores.
export function classifyConfidence(status: VisaStatus, stayDays: number | null | undefined): ProviderConfidence {
  if (status === VISA_STATUS.OTHER || status === VISA_STATUS.NO_ADMISSION) return CONFIDENCE.NEEDS_REVIEW;
  if (status === VISA_STATUS.VISA_REQUIRED) return CONFIDENCE.NORMAL;
  if (stayDays != null && stayDays > 0) return CONFIDENCE.HIGH_CONFIDENCE;
  return CONFIDENCE.NORMAL;
}

// Map a normalized visa status to the internal application method/channel hints.
export function statusToChannel(status: VisaStatus): { category: string; channel: string } {
  switch (status) {
    case VISA_STATUS.VISA_FREE: return { category: "visa_free", channel: "onsite" };
    case VISA_STATUS.VISA_ON_ARRIVAL: return { category: "visa_on_arrival", channel: "onsite" };
    case VISA_STATUS.EVISA: return { category: "evisa", channel: "evisa" };
    case VISA_STATUS.ETA: return { category: "eta", channel: "evisa" };
    default: return { category: "embassy_visa", channel: "embassy" };
  }
}