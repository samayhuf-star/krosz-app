// Worldz Visa (Phase 19) — manual tracking provider. The operator enters the
// authority's raw status by hand (§22 manual operations); the adapter only
// normalizes it. It never fabricates a status. fetchStatus is unsupported for
// manual (the portal has no API) — operators call enterTrackingUpdate directly.

import { fallbackNormalize } from "../../operations/catalog.ts";
import type { TrackingProviderAdapter } from "../types.ts";

export const ManualTrackingProvider: TrackingProviderAdapter = {
  key: "visa_tracking_manual",
  displayName: "Manual Tracking (operator-entered)",
  providerType: "MANUAL_OPERATOR",
  capabilities: ["VISA_TRACKING", "NORMALIZE"],
  normalizeStatus(raw: string): string { return fallbackNormalize(raw); },
  fetchStatus(_ctx: any): { raw_status: string; normalized_status: string; description: string } {
    throw Object.assign(new Error("Manual tracking provider has no fetchStatus — operator enters raw status"), { code: "UNSUPPORTED" });
  },
};