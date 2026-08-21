// Phase 15A — Context Provider port.
//
// A domain-neutral contract for loading the read-only context that grounds an
// AI orchestration run. The interface layer assumes nothing about "business" —
// the platform treats the actual context payload as opaque, domain-provided
// data. Pure types — no runtime, no entity imports, no orchestration imports.

export interface ContextSnapshot {
  /** Schema version of the snapshot (cache/provenance key). */
  version: number;
  /** The subject this context grounds (e.g. a business id in the Business OS product). */
  subject_id: string;
  /** Tenant that owns the subject (tenancy is a platform-level invariant). */
  tenant_id: string;
  /**
   * Opaque, domain-provided context payload. The platform does not interpret,
   * validate, or constrain its shape; the product module fills it and the
   * product module slices it.
   */
  payload?: any;
  /** Optional product context type tag (free-form, platform does not switch on it). */
  kind?: string;
}

/** Domain-neutral descriptor of a prompt the orchestration platform can render. */
export interface PromptDescriptor {
  prompt_id: string;
  version: number;
  content: string;
  variables?: Record<string, any>;
  default_model?: string;
  fallback_models?: string[];
  response_schema?: any;
}

export interface ContextPort {
  /** Load the full read-only context snapshot for a subject. */
  load(subject_id: string): Promise<ContextSnapshot | null>;

  /** Version of the context backing the last load (telemetry / cache key). */
  version(subject_id: string): Promise<number | null>;

  /** Return only the slice of the snapshot a capability needs for grounding. */
  slice(capability: string, snapshot: ContextSnapshot | null): any;

  /** Resolve the active prompt for a logical prompt id. */
  resolvePrompt(prompt_id: string, tenant_id?: string): Promise<PromptDescriptor | null>;
}