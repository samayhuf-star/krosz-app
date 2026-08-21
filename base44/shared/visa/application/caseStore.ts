// Worldz Visa (Phase 31 \u00a77-11/\u00a717-20): durable persistence over the pure Phase 27
// Case Engine. ONE mutation path for case lifecycle transitions (\u00a73/\u00a75):
// validate (engine) \u2192 idempotency check \u2192 append CaseEvent (immutable) \u2192 update
// VisaApplication projection (case_state SOT + derived legacy status/step + data_version).
//
// Non-transition case-level events (document/payment/webhook) record here too (\u00a719/20/23)
// without changing case_state. The pure Case Engine (caseEngine.ts) is unchanged \u2014 this
// module wraps it with durable storage; it never recomputes visa truth.
//
// CRUD on CaseEvent is admin/service-role only; read is owner-or-admin (see entity RLS).

import { canTransitionCase, TERMINAL_CASE, CASE_TRANSITIONS, deriveTimeline } from "./caseEngine.ts";
import {
  legacyStatusFromCaseState, currentStepFromCaseState, caseEventTypeForState,
  decideLegacyMigration, caseStateFromLegacyStatus, type CaseState,
} from "./caseProjections.ts";

export interface PersistTransitionOpts {
  actor_type?: "TRAVELER" | "OPERATOR" | "SYSTEM" | "PROVIDER" | "PORTAL" | "MIGRATION";
  actor_id?: string;
  source?: string;
  idempotency_key?: string;
  correlation_id?: string;
  reason?: string;
  metadata?: any;
}

// Pure: build the event object (no DB) \u2014 unit-tested by contract tests.
export function makeTransitionEvent(app: any, to: CaseState, opts: PersistTransitionOpts = {}): any {
  const from = (app?.case_state as CaseState) || null;
  return {
    case_id: app?.id,
    application_id: app?.id,
    traveler_id: app?.traveler_id || null,
    owner_user_id: app?.created_by_id || null,
    event_type: caseEventTypeForState(to),
    previous_case_state: from,
    new_case_state: to,
    actor_type: opts.actor_type || "SYSTEM",
    actor_id: opts.actor_id || null,
    source: opts.source || "case_engine",
    idempotency_key: opts.idempotency_key || null,
    correlation_id: opts.correlation_id || null,
    reason: opts.reason || null,
    metadata: opts.metadata || {},
    migration: false,
  };
}

// Authoritative transition + persist (\u00a73/\u00a77/\u00a717). Idempotent by idempotency_key.
export async function persistCaseTransition(svc: any, app: any, to: CaseState, opts: PersistTransitionOpts = {}): Promise<{ ok: boolean; code?: string; error?: string; case?: any; event?: any; idempotent?: boolean }> {
  const from = (app?.case_state as CaseState) || "DRAFT";
  // A redundant transition to the CURRENT state is a safe idempotent no-op, not a
  // BAD_TRANSITION. Traveler-facing flows (wizard) decide whether to fire a
  // transition from a cached case state that can be briefly stale; replaying the
  // same target must never 400. (Idempotency-key replays are handled below.)
  if (from === to) {
    const fresh = await svc.entities.VisaApplication.get(app.id).catch(() => app);
    return { ok: true, idempotent: true, case: fresh, event: null };
  }
  if (!from || !canTransitionCase(from, to)) return { ok: false, code: "BAD_TRANSITION", error: `Invalid transition ${from} -> ${to}` };

  // Idempotency: an existing event for this key+case means the operation already landed (\u00a717).
  if (opts.idempotency_key) {
    const existing: any[] = await svc.entities.CaseEvent.filter({ case_id: app.id, idempotency_key: opts.idempotency_key }).catch(() => []);
    if (existing && existing.length) {
      const fresh = await svc.entities.VisaApplication.get(app.id).catch(() => app);
      return { ok: true, idempotent: true, case: fresh, event: existing[0] };
    }
  }

  const evt = makeTransitionEvent(app, to, opts);
  let persisted: any = null;
  try { persisted = await svc.entities.CaseEvent.create(evt); }
  catch (e: any) { return { ok: false, code: "EVENT_PERSIST_FAILED", error: String(e?.message || e) }; }

  const now = new Date().toISOString();
  const update: any = {
    case_state: to,
    normalized_status: to,
    status: legacyStatusFromCaseState(to),     // \u00a75 derived compatibility projection
    current_step: currentStepFromCaseState(to),
    data_version: (Number(app.data_version) || 1) + 1,  // \u00a711 durable
    updated_date: now,
  };
  if (to === "SUBMITTED") update.submitted_at = now;
  if (to === "APPROVED") update.completed_at = now;
  if (TERMINAL_CASE.includes(to)) update.closed_at = now;

  const fresh = await svc.entities.VisaApplication.update(app.id, update).catch(() => ({ ...app, ...update }));
  return { ok: true, case: fresh, event: persisted };
}

// Record a non-transition case-level event (document/payment/webhook) \u2014 no state change (\u00a719/20/23).
export async function recordCaseEvent(svc: any, app: any, partial: { event_type: string; actor_type?: string; actor_id?: string; source?: string; idempotency_key?: string; correlation_id?: string; reason?: string; metadata?: any }): Promise<any> {
  if (partial.idempotency_key) {
    const existing: any[] = await svc.entities.CaseEvent.filter({ case_id: app.id, idempotency_key: partial.idempotency_key }).catch(() : any[] => []);
    if (existing && existing.length) return { event: existing[0], idempotent: true };
  }
  const cs = (app?.case_state as CaseState) || null;
  const row = {
    case_id: app.id, application_id: app.id, traveler_id: app?.traveler_id || null, owner_user_id: app?.created_by_id || null,
    event_type: partial.event_type, previous_case_state: cs, new_case_state: cs,
    actor_type: partial.actor_type || "SYSTEM", actor_id: partial.actor_id || null,
    source: partial.source || "case_engine", idempotency_key: partial.idempotency_key || null,
    correlation_id: partial.correlation_id || null, reason: partial.reason || null,
    metadata: partial.metadata || {}, migration: false,
  };
  return { event: await svc.entities.CaseEvent.create(row).catch(() => null) };
}

// Load recent case events (newest first) \u2014 timeline derives from this (\u00a716).
export async function loadCaseEvents(svc: any, caseId: string, limit = 100): Promise<any[]> {
  const rows: any[] = await svc.entities.CaseEvent.filter({ case_id: caseId }, "-created_date", limit).catch(() : any[] => []);
  return rows;
}

// Legacy \u2192 case_state migration for one application (\u00a74/\u00a76). Idempotent.
export async function migrateLegacyApplication(svc: any, app: any): Promise<{ migrated: boolean; review_required: boolean; case?: any; event?: any }> {
  const decision = decideLegacyMigration(app);
  const hasState = !!(app?.case_state && String(app.case_state).length);
  // Already migrated and consistent \u2192 idempotent no-op (don't re-emit events).
  if (hasState && !decision.review_required) {
    // Ensure the derived legacy projection is in sync (idempotent).
    const projected = legacyStatusFromCaseState(app.case_state);
    if (app.status !== projected) {
      await svc.entities.VisaApplication.update(app.id, { status: projected, current_step: currentStepFromCaseState(app.case_state), updated_date: new Date().toISOString() }).catch(() => {});
    }
    const evCheck: any[] = await svc.entities.CaseEvent.filter({ case_id: app.id, migration: true }).catch(() : any[] => []);
    return { migrated: false, review_required: false, case: await svc.entities.VisaApplication.get(app.id).catch(() => app), event: evCheck[0] || null };
  }

  const now = new Date().toISOString();
  const target = decision.target_state;
  const evt = {
    case_id: app.id, application_id: app.id, traveler_id: app?.traveler_id || null, owner_user_id: app?.created_by_id || null,
    event_type: "MIGRATED", previous_case_state: null, new_case_state: target,
    actor_type: "MIGRATION" as const, actor_id: "system", source: "migration",
    idempotency_key: `migrate_${app.id}`, reason: decision.review_required ? "Unknown legacy status; marked for review" : `Migrated legacy status '${decision.source_status}' -> ${target}`,
    metadata: { legacy_status: decision.source_status, review_required: decision.review_required }, migration: true,
  };
  const event = await svc.entities.CaseEvent.create(evt).catch(() => null);
  const update: any = {
    case_state: target, normalized_status: target, status: legacyStatusFromCaseState(target),
    current_step: currentStepFromCaseState(target), data_version: Number(app.data_version) || 1,
    updated_date: now, metadata: { ...(app.metadata || {}), migration_review_required: decision.review_required, migrated_at: now, legacy_status_preserved: decision.source_status },
  };
  const fresh = await svc.entities.VisaApplication.update(app.id, update).catch(() => ({ ...app, ...update }));
  return { migrated: true, review_required: decision.review_required, case: fresh, event };
}

// Bulk migration (\u00a735 safe / idempotent). Never destroys data; flags unknowns for review.
export async function migrateAllLegacy(svc: any, opts: { limit?: number } = {}): Promise<{ scanned: number; migrated: number; review_required: number; already_ok: number }> {
  const rows: any[] = await svc.entities.VisaApplication.list("-created_date", opts.limit || 5000).catch(() : any[] => []);
  let migrated = 0, review_required = 0, already_ok = 0;
  for (const app of rows) {
    const decision = decideLegacyMigration(app);
    const hasState = !!(app.case_state && String(app.case_state).length);
    if (hasState && !decision.review_required) { already_ok++; continue; }
    const r = await migrateLegacyApplication(svc, app).catch(() => null);
    if (r?.migrated) { migrated++; if (r.review_required) review_required++; }
  }
  return { scanned: rows.length, migrated, review_required, already_ok };
}

// Shortest valid path (BFS over CASE_TRANSITIONS) between two states (\u00a73).
function shortestPath(from: CaseState, to: CaseState): CaseState[] | null {
  if (from === to) return [];
  const seen = new Set<CaseState>([from]);
  const queue: { state: CaseState; path: CaseState[] }[] = [{ state: from, path: [] }];
  while (queue.length) {
    const { state, path } = queue.shift()!;
    for (const next of (CASE_TRANSITIONS[state] || [])) {
      if (seen.has(next)) continue;
      const np = [...path, next];
      if (next === to) return np;
      seen.add(next);
      queue.push({ state: next, path: np });
    }
  }
  return null;
}

// Transition a case to a target state, walking required intermediate states,
// persisting a durable CaseEvent at each step (\u00a73/\u00a77/\u00a717). Idempotent.
export async function transitionCaseToState(svc: any, app: any, target: CaseState, opts: PersistTransitionOpts = {}): Promise<{ ok: boolean; code?: string; error?: string; case?: any; events?: any[]; idempotent?: boolean }> {
  const from = (app?.case_state as CaseState) || "DRAFT";
  if (from === target) {
    const proj = legacyStatusFromCaseState(from);
    if (app.status !== proj) await svc.entities.VisaApplication.update(app.id, { status: proj, current_step: currentStepFromCaseState(from), updated_date: new Date().toISOString() }).catch(() => {});
    return { ok: true, idempotent: true, case: await svc.entities.VisaApplication.get(app.id).catch(() => app), events: [] };
  }
  const path = shortestPath(from, target);
  if (!path) return { ok: false, code: "NO_PATH", error: `No valid path ${from} -> ${target}` };
  let current = app;
  const events: any[] = [];
  for (const step of path) {
    const r = await persistCaseTransition(svc, current, step, opts);
    if (!r.ok) return { ok: false, code: r.code, error: r.error, case: current, events };
    if (r.idempotent) return { ok: true, idempotent: true, case: r.case, events: [...events, r.event] };
    current = r.case;
    if (r.event) events.push(r.event);
  }
  return { ok: true, case: current, events };
}

// Compatibility entrypoint for legacy domain engines that previously wrote the
// 18-state `status` directly (\u00a74/\u00a75). Maps legacy status -> case_state and drives
// the case engine durably. NEVER writes `status` independently; on failure it
// re-projects `status` from the current case_state so the two never diverge.
export async function setApplicationLifecycle(svc: any, app: any, legacyStatus: string, opts: PersistTransitionOpts = {}): Promise<{ ok: boolean; case?: any; events?: any[]; reprojected?: boolean }> {
  const target = caseStateFromLegacyStatus(legacyStatus);
  const from = (app?.case_state as CaseState) || null;
  if (!target || !from) {
    const cur = (from || "DRAFT") as CaseState;
    if (app.status !== legacyStatusFromCaseState(cur)) {
      await svc.entities.VisaApplication.update(app.id, { status: legacyStatusFromCaseState(cur), current_step: currentStepFromCaseState(cur), updated_date: new Date().toISOString() }).catch(() => {});
    }
    return { ok: false, reprojected: true, case: await svc.entities.VisaApplication.get(app.id).catch(() => app) };
  }
  const r = await transitionCaseToState(svc, app, target, opts);
  if (!r.ok) {
    await recordCaseEvent(svc, app, { event_type: "STATUS_CHANGED", source: opts.source || "domain", reason: `Lifecycle set to ${legacyStatus} blocked (${r.code})`, metadata: { attempted_legacy_status: legacyStatus, target } }).catch(() => {});
    if (app.status !== legacyStatusFromCaseState(from as CaseState)) {
      await svc.entities.VisaApplication.update(app.id, { status: legacyStatusFromCaseState(from as CaseState), current_step: currentStepFromCaseState(from as CaseState), updated_date: new Date().toISOString() }).catch(() => {});
    }
    return { ok: false, reprojected: true, case: await svc.entities.VisaApplication.get(app.id).catch(() => app) };
  }
  return { ok: true, case: r.case, events: r.events };
}

// Timeline from durable CaseEvent rows (\u00a716). Falls back to in-memory case-engine
// events when no CaseEvent rows exist yet (legacy cases pre-migration).
export function timelineFromCaseEvents(caseEventRows: any[], fallbackEvents: any[] = []): { at: string; type: string; title: string; source?: string; actor?: string }[] {
  if (caseEventRows && caseEventRows.length) {
    // Newest first; build each entry from its own row so source/actor stay aligned.
    const rows = [...caseEventRows].sort((a, b) => String(b.created_date).localeCompare(String(a.created_date)));
    return rows.map((r: any) => {
      const t = deriveTimeline([{ occurred_at: r.created_date, event_type: r.event_type } as any] as any)[0];
      return { at: r.created_date, type: r.event_type, title: t?.title || r.event_type, source: r.source, actor: r.actor_id };
    });
  }
  return deriveTimeline(fallbackEvents as any);
}