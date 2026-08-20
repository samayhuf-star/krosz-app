// Platform Feature Flags — resolve with precedence:
//   workspace override → module override → platform override → built-in default.
// No UI yet; DB-backed so future plans toggle features without code changes.

export type FlagScope = 'platform' | 'workspace' | 'module';

export interface FlagContext {
  workspaceId?: string;
  moduleId?: string;
}

export const FLAG_DEFAULTS: Record<string, boolean> = {
  // platform kernel
  'platform.multi_business': true,
  'platform.module_registry': true,
  'platform.version_engine': true,
  'platform.event_bus': true,
  'platform.ai_telemetry': true,
  // built modules
  'module.domain.enabled': true,
  'module.blueprint.enabled': true,
  'module.website.enabled': true,
  'module.seo.enabled': true,
  'module.crm.enabled': true,
  // foundation — the single source of truth every module reads from
  'module.business_knowledge_graph.enabled': true,
  'module.ai_orchestration.enabled': true,
  // future modules (off by default)
  'module.marketing.enabled': false,
  'module.email.enabled': false,
  'module.phone.enabled': false,
  'module.support.enabled': false,
  'module.chatbot.enabled': false,
  'module.analytics.enabled': false,
};

/**
 * Resolve a feature flag value. `svc` is a base44 client (service role or user).
 * Falls back to built-in defaults when no override record exists.
 */
export async function resolveFlag(svc: any, key: string, ctx: FlagContext = {}): Promise<boolean> {
  const find = async (scope: FlagScope) => {
    try {
      const rows = await svc.entities.FeatureFlag.filter({ key, scope });
      if (!rows || !rows.length) return undefined;
      if (scope === 'workspace') return rows.find((f: any) => f.workspace_id === ctx.workspaceId);
      if (scope === 'module') return rows.find((f: any) => f.module_id === ctx.moduleId);
      return rows[0]; // platform scope
    } catch {
      return undefined;
    }
  };
  const w = await find('workspace'); if (w) return Boolean(w.value);
  const m = await find('module'); if (m) return Boolean(m.value);
  const p = await find('platform'); if (p) return Boolean(p.value);
  return FLAG_DEFAULTS[key] ?? false;
}

/** Convenience: is the module with `id` enabled for the given workspace? */
export async function isModuleEnabled(svc: any, moduleId: string, workspaceId?: string): Promise<boolean> {
  const ctx: FlagContext = { workspaceId, moduleId };
  const moduleFlag = await resolveFlag(svc, `module.${moduleId}.enabled`, ctx);
  const platformFlag = await resolveFlag(svc, 'platform.module_registry', { workspaceId });
  return platformFlag && moduleFlag;
}

/** Create or update an override flag record. */
export async function setFlag(
  svc: any,
  key: string,
  scope: FlagScope,
  value: boolean,
  opts: { tenantId: string; workspaceId?: string; moduleId?: string; userId?: string; notes?: string }
) {
  return await svc.entities.FeatureFlag.create({
    tenant_id: opts.tenantId,
    key,
    scope,
    value,
    workspace_id: opts.workspaceId,
    module_id: opts.moduleId,
    updated_by: opts.userId,
    notes: opts.notes,
  });
}