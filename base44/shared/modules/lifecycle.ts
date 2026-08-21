// Shared Module + Version Engine — the lifecycle every versioned engine
// (Website, SEO, CRM, Email, Blog, Marketing, Support, …) reuses.
//
// Why a thin helper layer and not a generic ORM: every versioned module stores
// wildly different payloads (a Website Architecture vs. a CRM Pipeline). A
// generic "create draft" would have to know every shape. Instead this engine
// owns ONLY the parts that are genuinely identical across modules — the
// version *state machine*, supersede-on-finalize, next-version computation,
// history listing, and the platform event — and lets each module keep full
// ownership of its own payload shape. Simplicity over cleverness.

import { bus, type PlatformEventType } from '../events/bus.ts';

export type VersionStatus = 'draft' | 'approved' | 'rejected' | 'published' | 'superseded' | 'archived';

// Allowed forward transitions; everything else is rejected.
const ALLOWED: Record<VersionStatus, VersionStatus[]> = {
  draft: ['approved', 'rejected', 'published', 'archived'],
  approved: ['published', 'superseded', 'archived', 'rejected'],
  rejected: ['draft', 'archived'],
  published: ['archived', 'superseded'],
  superseded: ['published', 'approved', 'archived'], // rollback targets
  archived: ['draft'],
};

export const VERSION_STATUSES: VersionStatus[] = ['draft', 'approved', 'rejected', 'published', 'superseded', 'archived'];

export function transitionStatus(current: VersionStatus, target: VersionStatus): VersionStatus {
  if (!ALLOWED[current]?.includes(target)) {
    throw new Error(`Invalid version transition: ${current} → ${target}`);
  }
  return target;
}

export function computeNextVersion(existing: { version?: number }[]): number {
  return existing.reduce((max, r) => Math.max(max, r.version || 0), 0) + 1;
}

// When a version is finalized (approved/published/rolled-back), every prior
// version that held that same status is bumped to 'superseded' so there is
// exactly one current record of that status.
export async function supersedeSiblings(
  base44: any,
  entity: string,
  { tenantId, businessId, projectIdField, projectId, status, exceptId }: {
    tenantId?: string; businessId?: string; projectIdField: string; projectId: string; status: VersionStatus; exceptId: string;
  },
): Promise<void> {
  const svc = base44.asServiceRole ?? base44;
  const all = await svc.entities[entity].filter({ [projectIdField]: projectId } as any) as any[];
  const targets = all.filter((r: any) => r.status === status && r.id !== exceptId);
  if (!targets.length) return;
  await svc.entities[entity].bulkUpdate(targets.map((r: any) => ({ id: r.id, status: 'superseded' as VersionStatus })));
}

export interface ModuleConfig {
  name: string;                        // 'website' | 'seo' | 'crm' | ...
  versionEntity: string;               // 'Website' | 'SEOVersion' | 'CRMVersion' | ...
  projectIdField: string;              // the FK that groups a module's versions
  statusField?: string;                 // default 'status'
  publishedEventType?: PlatformEventType;
  approvedEventType?: PlatformEventType;
}

export interface ModuleHandle {
  approve(base44: any, versionId: string, actor?: string): Promise<any>;
  publish(base44: any, versionId: string, actor?: string): Promise<any>;
  rollback(base44: any, versionId: string): Promise<any>;
  archive(base44: any, versionId: string): Promise<any>;
  history(base44: any, projectId: string): Promise<any[]>;
}

export function createModuleEngine(config: ModuleConfig): ModuleHandle {
  const statusField = config.statusField || 'status';

  const setStatus = async (base44: any, versionId: string, target: VersionStatus, actor?: string) => {
    const svc = base44.asServiceRole ?? base44;
    const rec: any = await svc.entities[config.versionEntity].get(versionId);
    const current = (rec[statusField] as VersionStatus) || 'draft';
    transitionStatus(current, target); // throws on invalid (denied request surfaces as 4xx via caller)
    await supersedeSiblings(base44, config.versionEntity, {
      tenantId: rec.tenant_id, businessId: rec.business_id,
      projectIdField: config.projectIdField, projectId: rec[config.projectIdField], status: target, exceptId: versionId,
    });
    const patch: any = { [statusField]: target };
    if (target === 'published') { patch.is_published = true; patch.published_at = new Date().toISOString(); if (actor) patch.published_by = actor; }
    if (target === 'approved' && actor) { patch.approved_by = actor; patch.approved_at = new Date().toISOString(); }
    const updated = await svc.entities[config.versionEntity].update(versionId, patch);
    if (target === 'approved' && config.approvedEventType) await bus.dispatch(config.approvedEventType, { tenantId: rec.tenant_id, businessId: rec.business_id, actor, payload: { module: config.name, versionId } });
    if (target === 'published' && config.publishedEventType) await bus.dispatch(config.publishedEventType, { tenantId: rec.tenant_id, businessId: rec.business_id, actor, payload: { module: config.name, versionId } });
    return updated;
  };

  const history = async (base44: any, projectId: string) => {
    const svc = base44.asServiceRole ?? base44;
    const all = await svc.entities[config.versionEntity].filter({ [config.projectIdField]: projectId } as any) as any[];
    return (all as any[]).sort((a, b) => (b.version || 0) - (a.version || 0));
  };

  const archive = (base44: any, versionId: string) => setStatus(base44, versionId, 'archived');
  const rollback = (base44: any, versionId: string) => setStatus(base44, versionId, 'published');

  return { approve: (b, id, a) => setStatus(b, id, 'approved', a), publish: (b, id, a) => setStatus(b, id, 'published', a), rollback, archive, history };
}