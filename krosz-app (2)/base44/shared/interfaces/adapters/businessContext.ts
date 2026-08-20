// Phase 15C — Business OS ContextPort adapter.
//
// Thin adapter that IMPLEMENTS the neutral ContextPort contract by DELEGATING to
// the EXISTING Business OS context implementation (no second context store):
//   • load()      → orchestration/context.ts loadBusinessContext + Business.tenant_id
//   • version()   → orchestration/context.ts loadGraphVersion (Knowledge Graph version)
//   • slice()     → orchestration/context.ts loadCapabilityContext (the CAPABILITY_SLICES table)
//   • resolvePrompt() → orchestration/registry.ts latestPrompt (the shared Prompt Registry)
//
// The port surface is domain-neutral: subject_id == business_id at the seam.
// The existing database field stays `business_id`; nothing is renamed. This file
// only maps the existing payload into the ContextSnapshot envelope.
//
// Source of truth: ONE context implementation (knowledge-graph + orchestration/
// context.ts). This adapter owns no separate state.

import type { ContextPort, ContextSnapshot, PromptDescriptor } from "../context.ts";
import { loadBusinessContext, loadGraphVersion, loadCapabilityContext } from "../../orchestration/context.ts";
import { latestPrompt } from "../../orchestration/registry.ts";

export class BusinessContextPort implements ContextPort {
  constructor(private svc: any) {}

  async load(subject_id: string): Promise<ContextSnapshot | null> {
    // The existing tenant_id lives on the Business entity; we resolve it here so
    // the neutral snapshot carries tenancy without the platform needing to know.
    const business: any = await this.svc.entities.Business.get(subject_id).catch(() => null);
    if (!business) return null;
    const payload = await loadBusinessContext(this.svc, subject_id).catch(() => null);
    const version = await loadGraphVersion(this.svc, subject_id).catch(() => null);
    return {
      version: version ?? 1,
      subject_id,
      tenant_id: business.tenant_id,
      payload,
      kind: "business_kg",
    };
  }

  async version(subject_id: string): Promise<number | null> {
    return loadGraphVersion(this.svc, subject_id).catch(() => null);
  }

  slice(capability: string, snapshot: ContextSnapshot | null): any {
    if (!snapshot) return null;
    // Delegate to the existing capability-slice table (the single slice impl).
    return loadCapabilityContext(capability, snapshot.payload);
  }

  async resolvePrompt(prompt_id: string, tenant_id?: string): Promise<PromptDescriptor | null> {
    const p = await latestPrompt(this.svc, prompt_id, tenant_id).catch(() => null);
    if (!p) return null;
    // PromptRecord.variables is string[] (names); PromptDescriptor.variables is a
    // resolved-values map. We expose names only — callers fill values at render.
    return {
      prompt_id: p.prompt_id,
      version: p.version,
      content: p.content,
      variables: undefined,
      default_model: p.default_model,
      fallback_models: p.fallback_models,
      response_schema: p.response_schema,
    };
  }
}