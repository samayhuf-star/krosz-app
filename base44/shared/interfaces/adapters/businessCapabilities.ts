// Phase 15C — Business OS CapabilityRegistry adapter.
//
// Thin adapter that IMPLEMENTS the neutral CapabilityRegistry contract by
// DELEGATING to the EXISTING Business OS capability infrastructure (no second
// capability table):
//   • list() / get()  → actions/capabilities.ts CAPABILITIES (the single table)
//   • resolve()       → actions/interpreter.ts matchIntent (deterministic-first
//                       matcher that returns a registered key or 'not_available')
//   • register()      → an additive overlay for pluggable product modules that
//                       want to contribute capabilities WITHOUT editing the core
//                       table. The overlay is NOT a second registry — the core
//                       CAPABILITIES table remains authoritative; register() only
//                       adds (and can unregister), never overrides core keys.
//
// Source of truth: ONE capability table (actions/capabilities.ts). This adapter
// owns no product data; it maps the existing product Capability shape (already
// structurally compatible with the neutral Capability type) onto the contract.
//
// Note: actions/capabilities.ts exports its own `Capability` interface. Its shape
// is a structural superset of the neutral interfaces Capability (intents required
// vs optional), so the existing records satisfy the neutral contract directly —
// no remapping needed.

import type { CapabilityRegistry, Capability as ICapability, CapabilityResolution } from "../capabilities.ts";
import { CAPABILITIES, CAPABILITY_KEYS } from "../../actions/capabilities.ts";
import { matchIntent } from "../../actions/interpreter.ts";

// Additive-only overlay for runtime `register()`. Core keys win on `get()`.
const OVERLAY = new Map<string, ICapability>();

export function businessCapabilityRegistry(): CapabilityRegistry {
  return {
    list(): ICapability[] {
      const base = Object.values(CAPABILITIES) as ICapability[];
      const extra = Array.from(OVERLAY.values());
      return [...base, ...extra];
    },

    get(key: string): ICapability | null {
      const core = (CAPABILITIES as Record<string, ICapability>)[key];
      if (core) return core;
      return OVERLAY.get(key) ?? null;
    },

    resolve(intent: string): CapabilityResolution {
      const m = matchIntent(intent);
      if (!m) return { capability: null, status: "not_available", reason: "No matching capability." };
      if (m.capability === "not_available") {
        return { capability: null, status: "not_available", reason: "Intent is not automatable yet." };
      }
      const cap = (CAPABILITIES as Record<string, ICapability>)[m.capability] ?? OVERLAY.get(m.capability) ?? null;
      if (!cap) {
        return { capability: null, status: "not_available", reason: `Resolved key '${m.capability}' has no registered capability.` };
      }
      return { capability: cap, status: "resolved" };
    },

    register(cap: ICapability): () => void {
      // Additive only — never overwrite a core key (single source of truth).
      if (CAPABILITY_KEYS.includes(cap.key)) {
        return () => { /* core keys cannot be removed via the overlay */ };
      }
      OVERLAY.set(cap.key, cap);
      return () => { OVERLAY.delete(cap.key); };
    },
  };
}