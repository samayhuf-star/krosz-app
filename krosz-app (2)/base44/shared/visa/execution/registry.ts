// Worldz Visa (Phase 11) — execution adapter registry.
// REUSES the existing provider adapter registry (providers/registry.ts).
// Execution adapters are registered there under their adapter_key, the same way
// submission adapters are. No duplicate architecture (§1/§40).

import { getProviderAdapter, registerProviderAdapter, hasProviderAdapter } from "../../providers/registry.ts";
import type { ExecutionProviderAdapter } from "./types.ts";

export { registerProviderAdapter };

export function asExecutionAdapter(a: any): ExecutionProviderAdapter | null {
  if (a && typeof a === "object" && "strategy" in a && typeof (a as any).executeStep === "function") {
    return a as ExecutionProviderAdapter;
  }
  return null;
}

export function getExecutionAdapter(adapterKey: string): ExecutionProviderAdapter {
  const a = getProviderAdapter(adapterKey);
  const ex = asExecutionAdapter(a);
  if (!ex) throw Object.assign(new Error(`Adapter "${adapterKey}" is not an execution provider`), { code: "NOT_EXECUTION_PROVIDER" });
  return ex;
}

export function hasExecutionAdapter(adapterKey: string): boolean {
  if (!hasProviderAdapter(adapterKey)) return false;
  return asExecutionAdapter(getProviderAdapter(adapterKey)) != null;
}