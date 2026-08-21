// Worldz Visa (Phase 8) — submission adapter registry.
//
// REUSES the existing provider adapter registry (base44/shared/providers/registry.ts).
// Submission adapters are registered there under their adapter_key (same as AI /
// domain / email adapters), looked up by the Provider entity's adapter_key at
// runtime. This avoids a separate "VisaProviderRegistry" — the spec explicitly
// forbids duplicating the provider/capability architecture.

import { getProviderAdapter, registerProviderAdapter, hasProviderAdapter } from "../../providers/registry.ts";
import type { SubmissionProviderAdapter } from "./types.ts";

export { registerProviderAdapter };

// Cast a registered adapter to the submission contract. Returns null if the
// adapter is not a submission adapter (mirrors asAIAdapter in the AI runtime).
export function asSubmissionAdapter(a: any): SubmissionProviderAdapter | null {
  if (a && typeof a === "object" && "providerType" in a && Array.isArray((a as any).capabilities) && typeof (a as any).submit === "function") {
    return a as SubmissionProviderAdapter;
  }
  return null;
}

export function getSubmissionAdapter(adapterKey: string): SubmissionProviderAdapter {
  const a = getProviderAdapter(adapterKey);
  const sub = asSubmissionAdapter(a);
  if (!sub) throw Object.assign(new Error(`Provider adapter "${adapterKey}" is not a submission provider`), { code: "NOT_SUBMISSION_PROVIDER" });
  return sub;
}

export function hasSubmissionAdapter(adapterKey: string): boolean {
  if (!hasProviderAdapter(adapterKey)) return false;
  return asSubmissionAdapter(getProviderAdapter(adapterKey)) != null;
}