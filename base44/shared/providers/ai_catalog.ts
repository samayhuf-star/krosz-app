// Phase 1.2: registers the runtime AI adapters and exposes the capability matrix
// to the admin surfaces. Importing this module is a side-effect registration into the
// shared provider registry, so the legacy `adaptersMetadata()` (Phase 1.1) also picks
// the AI adapters up without any change to Phase 1.1 logic.
import "./adapters/base44core_ai.ts"; // built-in, zero-credential AI provider
import "./adapters/openai_compatible.ts";
import "./adapters/anthropic.ts";
import "./adapters/gemini.ts";
import { listProviderAdapters } from "./registry.ts";
import type { AIProviderAdapter, CapabilityMatrix } from "./types.ts";

export interface AICatalogEntry {
  key: string;
  displayName: string;
  capabilities: CapabilityMatrix;
  defaultModel?: string;
  credentialSchema: Array<{ name: string; displayName: string; required: boolean }>;
}

export function asAIAdapter(adapter: any): AIProviderAdapter | null {
  return adapter && typeof adapter.chat === "function" ? (adapter as AIProviderAdapter) : null;
}

export function listAIAdapters(): AICatalogEntry[] {
  return listProviderAdapters("ai")
    .filter((a) => typeof (a as AIProviderAdapter).chat === "function")
    .map((a) => {
      const ai = a as AIProviderAdapter;
      return {
        key: ai.key,
        displayName: ai.displayName,
        capabilities: ai.capabilities,
        defaultModel: ai.defaultModel,
        credentialSchema: ai.credentialSchema,
      };
    });
}