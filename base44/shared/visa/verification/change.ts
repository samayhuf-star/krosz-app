// Worldz Visa (Phase 25) — Source Snapshot, Change Detection & Verification Maintenance.
// PURE (no DB / no crypto). Fingerprints normalized source payloads, detects material
// changes vs the previous snapshot, decides whether a change invalidates a destination's
// VERIFIED state, and recomputes the verification-freshness window from change_risk.
//
// Pipeline (§3): Official Sources → Snapshot → Fingerprint/Diff → material? → ResearchTask
// → admin verification → update evidence → recompute verification → public entry reflects
// new truth. A material change NEVER silently retains VERIFIED; a non-material change
// never needlessly invalidates it. The previous snapshot is always retained for audit.
//
// "VERIFIED" never means "we know everything" — it means "the claims required for this
// publication state have been independently verified per our evidence policy." That
// distinction matters once there are hundreds of destinations and shifting rules.

export type ChangeClass = "NONE" | "NON_MATERIAL" | "MATERIAL";

// Fields whose change is MATERIAL for a given claim_type. A change to a non-listed field
// for a known claim is NON_MATERIAL (cosmetic/metadata). An unknown claim_type → treat
// every changed field as material (fail-safe for sources we haven't classified).
export const MATERIAL_FIELDS_BY_CLAIM: Record<string, string[]> = {
  entry_mode: ["journey_type", "visa_required"],
  visa_required: ["visa_required"],
  evisa_available: ["evisa_available", "application_url"],
  eta_available: ["eta_available", "application_url"],
  visa_on_arrival: ["visa_on_arrival"],
  visa_free: ["visa_free"],
  fee: ["fee_government_minor", "fee_currency"],
  processing_time: ["processing_time_days"],
  validity: ["validity_days"],
  stay_duration: ["max_stay_days"],
  required_documents: ["required_documents"],
  photo_requirements: ["photo_requirements"],
  biometric_requirements: ["biometric_requirements"],
  insurance_requirements: ["insurance_required"],
  application_url: ["application_url", "official_portal_url"],
  government_application_method: ["application_required", "submission_capability"],
  passport_requirement: ["passport_validity_min_months"],
  tracking_method: ["tracking_capability"],
  transit_rules: ["transit_rules"],
  eligibility: ["eligibility"],
  general: ["journey_type", "visa_required", "max_stay_days", "fee_government_minor", "official_portal_url", "application_required", "submission_capability", "tracking_capability"],
};

export function materialFieldsFor(claimType: string | null | undefined): string[] | null {
  if (!claimType) return null; // null = every field is material (fail-safe)
  return MATERIAL_FIELDS_BY_CLAIM[claimType] ?? null;
}

// Normalize a raw source payload into a stable, sorted-key object for fingerprinting.
// Objects are coerced to JSON strings (stable), null/undefined dropped, scalars kept.
export function normalizeSourcePayload(raw: any): Record<string, any> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, any> = {};
  for (const k of Object.keys(raw).sort()) {
    const v = (raw as any)[k];
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "object" ? JSON.stringify(v) : v;
  }
  return out;
}

// Deterministic fingerprint (djb2 → unsigned 32-bit hex). No crypto dependency so the
// pure contract tests run identically in the browser sandbox and the backend.
export function fingerprintPayload(payload: Record<string, any>): string {
  const keys = Object.keys(payload || {}).sort();
  const s = keys.map((k) => `${k}=${String(payload[k])}`).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "fp_" + (h >>> 0).toString(16).padStart(8, "0");
}

export interface DiffEntry { field: string; previous: any; current: any; material: boolean; }
export interface ChangeResult {
  change: ChangeClass; changedFields: string[]; materialFields: string[];
  diff: DiffEntry[]; fingerprint: string; previousFingerprint: string | null;
}

// Compare a new normalized payload against the previous snapshot. Returns the change
// class and per-field diff. A field is "material" if it's listed for the claim_type, or
// if the claim_type is unknown (fail-safe → everything material).
export function detectChange(previous: { fingerprint?: string; normalized_payload?: any } | null, current: Record<string, any>, claimType?: string | null): ChangeResult {
  const prevPayload: Record<string, any> = previous?.normalized_payload && typeof previous.normalized_payload === "object" ? previous.normalized_payload : {};
  const prevFp = previous?.fingerprint || null;
  const curFp = fingerprintPayload(current);
  if (prevFp && prevFp === curFp) return { change: "NONE", changedFields: [], materialFields: [], diff: [], fingerprint: curFp, previousFingerprint: prevFp };

  const allKeys = Array.from(new Set([...Object.keys(prevPayload), ...Object.keys(current)])).sort();
  const diff: DiffEntry[] = [];
  const changedFields: string[] = [];
  const materialList = materialFieldsFor(claimType);
  const materialFields: string[] = [];
  let anyMaterial = false;
  for (const k of allKeys) {
    const pv = prevPayload[k];
    const cv = current[k];
    if (JSON.stringify(pv) === JSON.stringify(cv)) continue;
    changedFields.push(k);
    const isMaterial = materialList == null || materialList.includes(k);
    if (isMaterial) { materialFields.push(k); anyMaterial = true; }
    diff.push({ field: k, previous: pv ?? null, current: cv ?? null, material: isMaterial });
  }
  if (!changedFields.length) return { change: "NONE", changedFields: [], materialFields: [], diff: [], fingerprint: curFp, previousFingerprint: prevFp };
  return { change: anyMaterial ? "MATERIAL" : "NON_MATERIAL", changedFields, materialFields, diff, fingerprint: curFp, previousFingerprint: prevFp };
}

// A material change invalidates the affected verification. Non-material/none do NOT.
export function shouldInvalidateVerification(change: ChangeClass): boolean {
  return change === "MATERIAL";
}

// ResearchTask priority from change_risk (Phase 25 §3).
export function priorityFromChangeRisk(risk: string): "LOW" | "NORMAL" | "HIGH" | "URGENT" {
  if (risk === "HIGH") return "URGENT";
  if (risk === "MEDIUM") return "HIGH";
  return "NORMAL";
}

// Phase 25 §6: recompute the verification-freshness review window from change_risk.
// LOW=90d, MEDIUM=60d, HIGH=30d.
export function nextReviewFromRisk(risk: string, asOf: string = new Date().toISOString()): string {
  const days = risk === "HIGH" ? 30 : risk === "MEDIUM" ? 60 : 90;
  const d = new Date(asOf); d.setDate(d.getDate() + days);
  return d.toISOString();
}

// Human-readable diff summary for the admin review drawer.
export function summarizeDiff(diff: DiffEntry[]): string {
  if (!diff.length) return "No changes detected.";
  const m = diff.filter((d) => d.material);
  if (!m.length) return `${diff.length} cosmetic change(s) — no re-verification required.`;
  return m.map((d) => `${d.field}: ${formatVal(d.previous)} → ${formatVal(d.current)}`).join("\n");
}

function formatVal(v: any): string {
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 40) + "…" : v;
  return JSON.stringify(v);
}

// Downstate target on a material change. VERIFIED/PARTIALLY_VERIFIED → RESEARCHING
// (previous status retained). Other states are not double-downstated.
export function downstateOnMaterialChange(currentVerificationStatus: string): { target: string; retain_previous: boolean } {
  if (currentVerificationStatus === "VERIFIED" || currentVerificationStatus === "PARTIALLY_VERIFIED") {
    return { target: "RESEARCHING", retain_previous: true };
  }
  return { target: currentVerificationStatus || "RESEARCHING", retain_previous: false };
}

export const __change = {
  normalizeSourcePayload, fingerprintPayload, detectChange, shouldInvalidateVerification,
  priorityFromChangeRisk, nextReviewFromRisk, summarizeDiff, downstateOnMaterialChange,
  materialFieldsFor, MATERIAL_FIELDS_BY_CLAIM,
};