// Worldz Visa (Phase 19) — mock tracking provider (sandbox only). Simulates a
// government status API for the Japan eVisa route. Clearly labeled mock:
// never presented as real (spec §40). Returns a scripted sequence advancing
// RECEIVED → PROCESSING → APPROVED across calls, keyed by submission id.

import { fallbackNormalize } from "../../operations/catalog.ts";
import type { TrackingProviderAdapter } from "../types.ts";

const SEQUENCE = ["RECEIVED", "PROCESSING", "APPROVED"];

export const MockTrackingProvider: TrackingProviderAdapter = {
  key: "visa_tracking_mock",
  displayName: "Mock Tracking (sandbox only)",
  providerType: "GOVERNMENT_API",
  capabilities: ["VISA_TRACKING", "NORMALIZE", "FETCH"],
  normalizeStatus(raw: string): string { return fallbackNormalize(raw); },
  fetchStatus(ctx: any): { raw_status: string; normalized_status: string; description: string } {
    const seed = String(ctx?.submission_id || ctx?.application_id || "0");
    const idx = Math.abs(hash(seed)) % SEQUENCE.length;
    const raw = SEQUENCE[idx] === "APPROVED" ? "Visa approved and ready for collection"
      : SEQUENCE[idx] === "PROCESSING" ? "Application under consideration"
      : "Application received and queued for processing";
    return { raw_status: raw, normalized_status: SEQUENCE[idx], description: raw };
  },
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}