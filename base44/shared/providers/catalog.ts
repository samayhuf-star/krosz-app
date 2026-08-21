import "./adapters/base44core_ai.ts";
import "./adapters/http_rest.ts";
import "./adapters/openprovider_domain.ts"; // Phase 2: OpenProvider (primary domain registrar)
import "./adapters/opensrs_domain.ts"; // Phase 2: OpenSRS (backup domain registrar)
import "./ai_catalog.ts"; // Phase 1.2: registers OpenAI-compatible, Anthropic, Gemini adapters
import { listProviderAdapters } from "./registry.ts";

export interface AdapterMetadata {
  key: string;
  displayName: string;
  category: string;
  credentialSchema: Array<{ name: string; displayName: string; required: boolean }>;
}

export function adaptersMetadata(): AdapterMetadata[] {
  return listProviderAdapters().map((a) => ({
    key: a.key,
    displayName: a.displayName,
    category: a.category,
    credentialSchema: a.credentialSchema,
  }));
}