// Worldz Visa (Phase 10) — Payment adapter registry. Type-gated counterpart of
// the platform provider registry (we keep a separate map so non-payment adapters
// in the same Provider entity are never accidentally dispatched here).

import type { PaymentProviderAdapter } from "./types.ts";

const adapters = new Map<string, PaymentProviderAdapter>();

export function registerPaymentAdapter(adapter: PaymentProviderAdapter) {
  if (adapters.has(adapter.key)) return; // idempotent (catalog import side effect)
  adapters.set(adapter.key, adapter);
}

export function getPaymentAdapter(key: string): PaymentProviderAdapter {
  const a = adapters.get(key);
  if (!a) throw Object.assign(new Error(`Payment adapter not installed: ${key}`), { code: "NO_ADAPTER" });
  return a;
}

export function hasPaymentAdapter(key: string): boolean {
  return adapters.has(key);
}

export function listPaymentAdapters(): PaymentProviderAdapter[] {
  return [...adapters.values()];
}