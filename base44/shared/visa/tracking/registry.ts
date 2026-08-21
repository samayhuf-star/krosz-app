// Worldz Visa (Phase 19) — tracking adapter registry.
//
// REUSES the existing provider adapter registry (base44/shared/providers/registry.ts)
// — mirrors the submission registry (Phase 8). Tracking adapters are registered
// there under their adapter_key and looked up by the Provider entity's
// adapter_key at runtime, so no second provider architecture is created (§22).

import { getProviderAdapter, registerProviderAdapter, hasProviderAdapter } from "../../providers/registry.ts";
import type { TrackingProviderAdapter } from "./types.ts";

export { registerProviderAdapter };

export function asTrackingAdapter(a: any): TrackingProviderAdapter | null {
  if (a && typeof a === "object" && Array.isArray((a as any).capabilities) && (a as any).capabilities.includes("VISA_TRACKING") && typeof (a as any).normalizeStatus === "function") {
    return a as TrackingProviderAdapter;
  }
  return null;
}

export function getTrackingAdapter(adapterKey: string): TrackingProviderAdapter {
  const a = getProviderAdapter(adapterKey);
  const t = asTrackingAdapter(a);
  if (!t) throw Object.assign(new Error(`Provider adapter "${adapterKey}" is not a tracking provider`), { code: "NOT_TRACKING_PROVIDER" });
  return t;
}

export function hasTrackingAdapter(adapterKey: string): boolean {
  if (!hasProviderAdapter(adapterKey)) return false;
  return asTrackingAdapter(getProviderAdapter(adapterKey)) != null;
}