// Prompt Registry — centralized, versioned prompt store.
// Business modules reference a `prompt_id` instead of embedding prompt text.
// The active version is the highest `version` whose status is `approved` or `published`.
//
// All access is tenant-scoped (each tenant owns its prompt set). The backend
// function lazily seeds a default prompt per tenant so orchestrate() works out
// of the box.

export interface PromptRecord {
  id?: string;
  tenant_id: string;
  prompt_id: string;
  version: number;
  capability: string;
  module: string;
  status: 'draft' | 'review' | 'approved' | 'published' | 'rejected';
  content: string;
  variables: string[];
  compatible_models: string[];
  default_model: string;
  fallback_models: string[];
  response_schema?: any;
  notes?: string;
  created_by?: string;
}

const ACTIVE_STATUSES = ['approved', 'published'];

/** Latest *active* prompt for a logical id (highest active version). */
export async function latestPrompt(svc: any, prompt_id: string, tenant_id?: string): Promise<PromptRecord | null> {
  const q: any = { prompt_id };
  if (tenant_id) q.tenant_id = tenant_id;
  const rows = await svc.entities.Prompt.filter(q);
  const active = rows
    .filter((r: any) => ACTIVE_STATUSES.includes(r.status))
    .sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
  return active[0] || null;
}

/** Get a specific version (any status) — for audit / rollback. */
export async function getPrompt(svc: any, prompt_id: string, version?: number, tenant_id?: string): Promise<PromptRecord | null> {
  if (version == null) return latestPrompt(svc, prompt_id, tenant_id);
  const q: any = { prompt_id, version };
  if (tenant_id) q.tenant_id = tenant_id;
  const rows = await svc.entities.Prompt.filter(q);
  return rows[0] || null;
}

export async function listPrompts(svc: any, tenant_id?: string): Promise<PromptRecord[]> {
  const q: any = tenant_id ? { tenant_id } : {};
  const rows = await svc.entities.Prompt.filter(q);
  return rows.sort((a: any, b: any) =>
    a.prompt_id === b.prompt_id ? (b.version - a.version) : a.prompt_id.localeCompare(b.prompt_id));
}

/**
 * Register a new version of a prompt. Never overwrites — always creates a new
 * version row, mirroring the Blueprint versioning discipline. Status defaults
 * to `approved` so it is immediately usable (call publishPrompt to flip to `published`).
 */
export async function registerPrompt(svc: any, p: Omit<PromptRecord, 'version'> & { version?: number }): Promise<PromptRecord> {
  const existing = await svc.entities.Prompt.filter({ tenant_id: p.tenant_id, prompt_id: p.prompt_id });
  const version = p.version ?? (existing.reduce((m: number, r: any) => Math.max(m, r.version || 0), 0) + 1);
  const row = await svc.entities.Prompt.create({
    tenant_id: p.tenant_id,
    prompt_id: p.prompt_id,
    version,
    capability: p.capability,
    module: p.module,
    status: p.status || 'approved',
    content: p.content,
    variables: p.variables || [],
    compatible_models: p.compatible_models || [],
    default_model: p.default_model || 'automatic',
    fallback_models: p.fallback_models || [],
    response_schema: p.response_schema ?? null,
    notes: p.notes || '',
    created_by: p.created_by || 'system',
  });
  return row;
}

/** Flip a prompt version's status (draft → review → approved → published). */
export async function setPromptStatus(svc: any, id: string, status: PromptRecord['status']): Promise<void> {
  await svc.entities.Prompt.update(id, { status });
}

/** The default seed prompt used to validate the orchestration pipeline end-to-end. */
export const DEFAULT_TEST_PROMPT = {
  prompt_id: 'orchestration.self_test',
  capability: 'AIExecution',
  module: 'ai_orchestration',
  content:
    'You are validating the AI Orchestration Engine. Given the business context, produce a single concise insight about how this business could improve its customer acquisition.\n\nReturn JSON: { "insight": string, "confidence": number (0..1) }.\n\nBusiness context:\n{{business_context}}',
  variables: ['business_context'],
  default_model: 'automatic',
  fallback_models: ['gpt_5_mini'],
  response_schema: {
    type: 'object',
    properties: {
      insight: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['insight', 'confidence'],
  },
  notes: 'Default seed prompt — verifies context loading, prompt resolution, execution, validation, telemetry and cache.',
};

/** Ensure the default test prompt exists for a tenant (idempotent). */
export async function ensureSeedPrompt(svc: any, tenant_id: string): Promise<void> {
  const existing = await latestPrompt(svc, DEFAULT_TEST_PROMPT.prompt_id, tenant_id);
  if (existing) return;
  await registerPrompt(svc, { ...DEFAULT_TEST_PROMPT, tenant_id, status: 'approved' } as any);
}