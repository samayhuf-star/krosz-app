// Worldz Visa (Phase 37) — Durable Intelligence Version store (publish / rollback /
// active-case impact propagation). Admin-gated. PURE engine lives in versioning.ts.
//
// Hard rules:
//   §10/§21 — existing VisaApplication case snapshots are NEVER mutated by a version
//      change; instead a CaseEvent (INTELLIGENCE_VERSION_CHANGED /
//      INTELLIGENCE_CHANGE_REQUIRES_ACTION) is appended and affected cases revalidated.
//   §22/§30 — non-UNCHANGED revalidation creates an OperationsTask via the EXISTING
//      OperationsTask entity (no second task system).
//   §26 — publishing supersedes the previous PUBLISHED version (never deletes it);
//      rollback re-publishes a SUPERSEDED version and supersedes the current one.
//   §32/§33/§44 — agents + travelers may read but NEVER publish/approve/rollback.
//   §38 — only admin role may publish / rollback.
//   §45 — every publish records publisher + audit (via CaseEvent + the immutable
//      IntelligenceVersion row itself, which is never deleted).

import {
  buildVersion, canPublishVersion, canAutoPublish, revalidationResultFor, versionLockForCase,
  computeImpactScore, severityForDiff, buildProvenance,
  INTELLIGENCE_VERSION_CHANGED_EVENT, INTELLIGENCE_CHANGE_REQUIRES_ACTION_EVENT,
  intelligenceTaskIdempotencyKey, type Severity, type VersionStatus,
} from "./versioning.ts";
import { recordCaseEvent } from "../application/caseStore.ts";

async function listPublished(svc: any, country: string, journey: string, excludeId?: string): Promise<any[]> {
  const rows: any[] = await svc.entities.IntelligenceVersion.filter({ country, journey, status: "PUBLISHED" }, "-published_at", 5).catch(() => []);
  return excludeId ? rows.filter((r: any) => r.id !== excludeId) : rows;
}

export async function currentPublishedVersion(svc: any, country: string, journey: string): Promise<any | null> {
  const rows = await listPublished(svc, country, journey);
  return rows[0] || null;
}

export function intelligenceVersionForCase(svc: any, app: any): Promise<any | null> {
  const country = String(app?.destination || app?.case_snapshot?.country || "").toUpperCase();
  const journey = app?.case_snapshot?.journey || app?.visa_type_key || "EVISA";
  return currentPublishedVersion(svc, country, journey);
}

// ---------- Publish a new version (admin-gated, idempotent, supersedes previous) ----------
export async function publishIntelligenceVersion(svc: any, user: any, input: {
  country: string; journey: string; data_version: string; source_version?: string | null;
  effective_from?: string | null; effective_until?: string | null; source_reference?: string | null;
  confidence?: string; content_hash?: string | null; change_summary?: any;
  approved_by?: string; autoPublishLowRisk?: boolean;
}): Promise<{ ok: boolean; version?: any; previous_superseded?: any | null; reason?: string; auto_published?: boolean }> {
  if (!canPublishVersion(user?.role)) return { ok: false, reason: "ADMIN_REQUIRED" };

  // Idempotent: an identical PUBLISHED version already exists.
  const existing: any[] = await svc.entities.IntelligenceVersion.filter({ country: input.country, journey: input.journey, data_version: input.data_version, status: "PUBLISHED" }).catch(() => []);
  if (existing[0]) return { ok: true, version: existing[0], previous_superseded: null, auto_published: false };

  // Severity + auto-publish gate (§24/§25): HIGH/CRITICAL never auto-publish.
  const materialFields: string[] = input.change_summary?.materialFields || [];
  const sev: Severity = input.change_summary?.severity || (materialFields.length ? severityForDiff(materialFields) : "MEDIUM");
  const affectsExec = !!(input.change_summary?.affectsExecution ?? false);
  const auto = canAutoPublish({ materialFields, severity: sev }, { autoPublishLowRisk: input.autoPublishLowRisk });
  if (auto && sev !== "LOW") return { ok: false, reason: "AUTO_PUBLISH_ONLY_LOW_RISK" };
  // The caller is an admin who has either auto-published LOW risk or explicitly approved.
  const now = new Date().toISOString();
  const built = buildVersion({
    country: input.country, journey: input.journey, data_version: input.data_version,
    source_version: input.source_version, effective_from: input.effective_from, effective_until: input.effective_until,
    published_at: now, published_by: user.id, source_reference: input.source_reference,
    confidence: input.confidence, content_hash: input.content_hash, change_summary: input.change_summary,
    status: "PUBLISHED", severity: sev, affects_execution: affectsExec,
  });
  const version = await svc.entities.IntelligenceVersion.create({ ...built, approved_by: input.approved_by || (auto ? null : user.id), auto_published: auto, impact_score: 0 }).catch(() => null);
  if (!version) return { ok: false, reason: "CREATE_FAILED" };

  // Supersede the previously PUBLISHED version (promote previous_version_id reference).
  const prev = (await listPublished(svc, input.country, input.journey, version.id))[0] || null;
  if (prev) await svc.entities.IntelligenceVersion.update(prev.id, { status: "SUPERSEDED" }).catch(() => {});

  // Compute impact score from active-case count + propagate to affected active cases.
  const impact = await computeCaseImpact(svc, input.country, input.journey, version.data_version, sev, affectsExec);
  await svc.entities.IntelligenceVersion.update(version.id, { impact_score: impact.impact_score, previous_version_id: prev?.id || null }).catch(() => {});
  await propagateImpact(svc, user, version, sev, affectsExec, false).catch(() => {});

  const fresh = await svc.entities.IntelligenceVersion.get(version.id).catch(() => version);
  return { ok: true, version: fresh, previous_superseded: prev, auto_published: auto };
}

// ---------- Rollback to a previous version (admin-gated, history preserved) ----------
export async function rollbackIntelligenceVersion(svc: any, user: any, versionId: string, reason?: string): Promise<{ ok: boolean; rolledTo?: any; currentSuperseded?: any | null; reason?: string }> {
  if (!canPublishVersion(user?.role)) return { ok: false, reason: "ADMIN_REQUIRED" };
  const target = await svc.entities.IntelligenceVersion.get(versionId).catch(() => null);
  if (!target) return { ok: false, reason: "VERSION_NOT_FOUND" };
  if (target.status === "PUBLISHED") return { ok: false, reason: "ALREADY_PUBLISHED" };

  const currentArr = await listPublished(svc, target.country, target.journey);
  const current = currentArr[0] || null;
  if (current) await svc.entities.IntelligenceVersion.update(current.id, { status: "SUPERSEDED" }).catch(() => {});
  const now = new Date().toISOString();
  await svc.entities.IntelligenceVersion.update(versionId, { status: "PUBLISHED", published_at: now, published_by: user.id, rollback_count: (target.rollback_count || 0) + 1, rollback_of_version_id: current?.id || null }).catch(() => {});
  const fresh = await svc.entities.IntelligenceVersion.get(versionId).catch(() => ({ ...target, status: "PUBLISHED", published_at: now }));
  // Rollback is itself a publish → revalidate active cases against the restored version.
  await propagateImpact(svc, user, fresh, "HIGH", true, true, reason).catch(() => {});
  return { ok: true, rolledTo: fresh, currentSuperseded: current };
}

// ---------- Active-case impact (§9/§20/§22) ----------
export async function computeCaseImpact(svc: any, country: string, journey: string, newVersionId: string, sev: Severity, affectsExec: boolean): Promise<{ affected: any[]; impact_score: number }> {
  const apps: any[] = await svc.entities.VisaApplication.filter({ destination: country, visa_type_key: journey }, "-created_date", 500).catch(() => []);
  const affected = apps.map((app) => {
    const lock = versionLockForCase(app);
    const result = revalidationResultFor({ lock, currentVersionId: newVersionId, severityOfChange: sev, affectsExecution: affectsExec, caseState: app.case_state });
    return { case_id: app.id, traveler_id: app.traveler_id, case_state: app.case_state, version_lock: lock.intelligence_version, drift: lock.intelligence_version !== newVersionId, result };
  }).filter((r) => r.drift);
  const score = computeImpactScore({ severity: sev, activeCases: affected.length, affectsExecution: affectsExec, futureTravelCases: affected.filter((a) => a.case_state === "DRAFT" || a.case_state === "INTAKE").length });
  return { affected, impact_score: score };
}

async function propagateImpact(svc: any, user: any, version: any, sev: Severity, affectsExec: boolean, isRollback: boolean, reason?: string): Promise<void> {
  const apps: any[] = await svc.entities.VisaApplication.filter({ destination: version.country, visa_type_key: version.journey }, "-created_date", 500).catch(() => []);
  for (const app of apps) {
    const lock = versionLockForCase(app);
    if (!lock.intelligence_version) continue; // unpinned case — nothing to revalidate
    const drift = lock.intelligence_version !== version.data_version;
    if (!drift && !isRollback) continue;
    const result = revalidationResultFor({ lock, currentVersionId: version.data_version, severityOfChange: sev, affectsExecution: affectsExec, caseState: app.case_state });
    if (result === "UNCHANGED" && !isRollback) continue;
    const eventType = result === "EXECUTION_BLOCKED" || result === "ACTION_REQUIRED" ? INTELLIGENCE_CHANGE_REQUIRES_ACTION_EVENT : INTELLIGENCE_VERSION_CHANGED_EVENT;
    const idem = `${intelligenceTaskIdempotencyKey(app.id, "intel")}|${version.data_version}${isRollback ? "|rb" : ""}`;
    await recordCaseEvent(svc, app, { event_type: eventType, source: "intelligence", actor_id: user?.id || "system", idempotency_key: idem, reason: reason || `Intelligence version ${isRollback ? "rollback" : "published"}: ${version.data_version}`, metadata: { severity: sev, affects_execution: affectsExec, result, version_id: version.id, rollback: isRollback, version_status: version.status } }).catch(() => {});
    if (result !== "UNCHANGED" || isRollback) {
      const taskType = result === "EXECUTION_BLOCKED" ? "PROVIDER_ROUTE_REVIEW" : result === "ACTION_REQUIRED" ? "APPLICATION_REVALIDATION" : "INTELLIGENCE_REVIEW";
      const taskKey = `${intelligenceTaskIdempotencyKey(app.id, taskType)}|${version.data_version}${isRollback ? "|rb" : ""}`;
      const existingTask: any[] = await svc.entities.OperationsTask.filter({ idempotency_key: taskKey }).catch(() => []);
      if (!existingTask.length) {
        await svc.entities.OperationsTask.create({ case_id: app.id, application_id: app.id, traveler_id: app.traveler_id, task_type: taskType, queue: "EXCEPTIONS", priority: sev === "CRITICAL" ? "URGENT" : sev === "HIGH" ? "HIGH" : "NORMAL", status: "QUEUED", idempotency_key: taskKey, source_rule: "intelligence.change", title: `Intelligence ${isRollback ? "rollback" : "change"} (${sev}): ${version.country}/${version.journey} → ${version.data_version}`, created_at: new Date().toISOString(), metadata: { severity: sev, version_id: version.id, result, rollback: isRollback } }).catch(() => {});
      }
    }
  }
}

// ---------- Read helpers (MCP-facing, public) ----------
export function versionProvenance(version: any, source: { name?: string; url?: string; type?: string } | null = null): any {
  return buildProvenance(version, source);
}

// Pre-submission revalidation against the currently-published version for a case (§36).
export async function preSubmissionRevalidationFor(svc: any, app: any, route: { submission_available: boolean; route_type: string }): Promise<{ ok: boolean; block?: string; code?: string; current?: any }> {
  const current = await currentPublishedVersion(svc, String(app.destination || app.case_snapshot?.country || "").toUpperCase(), app.case_snapshot?.journey || app.visa_type_key || "EVISA");
  const lock = versionLockForCase(app);
  const compat = {
    intelligenceCompatible: !lock.intelligence_version || !current?.data_version || lock.intelligence_version === current.data_version,
    providerCompatible: !lock.provider_version || !current?.source_version || lock.provider_version === current.source_version,
    formCompatible: !lock.form_version || !current?.source_version || lock.form_version === current.source_version,
    mappingCompatible: true,
  };
  if (!compat.intelligenceCompatible) return { ok: false, block: "BLOCKED_BY_INTELLIGENCE_CHANGE", code: "INTELLIGENCE_VERSION_DRIFT", current };
  if (!route.submission_available) return { ok: false, block: "BLOCKED_BY_INTELLIGENCE_CHANGE", code: "ROUTE_NOT_COMPATIBLE", current };
  if (!compat.providerCompatible) return { ok: false, block: "BLOCKED_BY_PROVIDER_SCHEMA_CHANGE", code: "PROVIDER_VERSION_INCOMPATIBLE", current };
  if (!compat.formCompatible) return { ok: false, block: "BLOCKED_BY_PORTAL_SCHEMA_CHANGE", code: "FORM_VERSION_INCOMPATIBLE", current };
  return { ok: true, current };
}