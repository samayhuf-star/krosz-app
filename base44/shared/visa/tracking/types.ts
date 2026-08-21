// Worldz Visa (Phase 19) — tracking provider adapter contract (§22).
export interface TrackingProviderAdapter {
  providerType: string;
  capabilities: string[]; // includes "VISA_TRACKING"
  normalizeStatus(raw: string): string;
  fetchStatus?(ctx: { submission_id?: string; application_id?: string; external_reference?: string }): { raw_status: string; normalized_status: string; description: string };
}