// Phase 15A — Capability Registry port.
//
// A domain-neutral contract for the registry that maps an intent to an
// executable backend (a workflow run, a standalone task, a read, or a tool).
// The Action Engine and Agent Runtime resolve intents through this contract;
// they never read a literal capability array owned by any product module. The
// concrete capability table is supplied by the product module at runtime. Pure
// types, no runtime, no entity imports.

export type CapabilityKind = 'workflow' | 'standalone_task' | 'read' | 'tool';

export interface Capability {
  key: string;
  label: string;
  summary: string;
  kind: CapabilityKind;
  // workflow
  templateId?: string;
  // standalone_task
  taskType?: string;
  taskKey?: string;
  /** Provider capability requested (e.g. "ai_generation"); owned by the platform provider layer. */
  capability?: string;
  /** For agent-backed standalone tasks: the standard agent to resolve/auto-seed. */
  agentPurpose?: string;
  // tool
  /** JSON schema validating tool-call arguments. */
  argsSchema?: any;
  /** Plain-language reason approval may be required (authoritative policy lives in the plan template). */
  approvalReason?: string;
  /** Re-running makes sense once completed. */
  regenerateable?: boolean;
  /** Natural-language phrases that resolve to this capability. */
  intents?: string[];
}

export type CapabilityResolution =
  | { capability: Capability | null; status: 'resolved' }
  | { capability: null; status: 'not_available'; reason: string };

export interface CapabilityRegistry {
  /** All capabilities the registry currently knows about. */
  list(): Capability[];

  /** Look up a single capability by key. */
  get(key: string): Capability | null;

  /**
   * Resolve a natural-language intent to a capability, or 'not_available'.
   * The interpreter may ONLY return a capability present here, or 'not_available' —
   * no capability is faked. Implementations must be deterministic.
   */
  resolve(intent: string): CapabilityResolution;

  /**
   * Register a capability at runtime (additive). Returns an unsubscribe.
   * For pluggable product modules and future domains that contribute capabilities
   * without editing the core registry.
   */
  register(cap: Capability): () => void;
}