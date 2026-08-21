// Worldz Visa (Phase 32) — Operations Queue: durable store over the pure tasks.ts layer.
//
// This module wraps the pure work-management rules with persistence. It is the ONLY
// path that creates/mutates OperationsTask records. Crucially (§20), task actions that
// need to change application state go THROUGH the Phase 27/31 Case Engine
// (persistCaseTransition / transitionCaseToState) — NEVER a direct VisaApplication
// case_state update. The Case Engine validates the transition, persists a CaseEvent,
// and only then does the task store complete/update the task.
//
// §7 idempotent creation · §31 every mutation audited (OperationsAuditEvent) ·
// §36 travelers never access ops tasks (admin-only; enforced via RLS + server check).

import {
  resolveTasksForEvent, taskKey, TITLE_FOR_TYPE as titleForType, TEAM_FOR_TYPE as teamForType, slaForTaskType,
  computeDueAt, deterministicTaskPriority, applyTaskPriorityOverride, canTransitionTask,
  canResolve, resolutionRequired, opsPermissions, canAccessTask, projectCaseContext,
  exportTaskRow, isBulkAllowed, planTaskAction, automationClassFor, TERMINAL_TASK,
  QUEUE_FOR_TYPE, TASK_STATUSES, PRIORITIES, QUEUES, type TaskType, type TaskStatus,
  type Priority,
} from "./tasks.ts";
import { persistCaseTransition, transitionCaseToState, loadCaseEvents } from "../application/caseStore.ts";
import { legacyStatusFromCaseState } from "../application/caseProjections.ts";

function assertAdmin(user: any) {
  if (!user || user.role !== "admin") throw Object.assign(new Error("Operations access required"), { code: "FORBIDDEN" });
}
function roleOf(user: any): "ADMIN" | "SYSTEM" { return user?.role === "admin" ? "ADMIN" : "SYSTEM"; }

async function audit(svc: any, user: any, task: any, action: string, prev: string | null, next: string | null, reason = "", metadata: any = {}) {
  await svc.entities.OperationsAuditEvent.create({
    case_id: task?.case_id || null, application_id: task?.application_id || task?.case_id || null,
    traveler_id: task?.traveler_id || null, task_id: task?.id || null,
    actor_id: user?.id || "system", actor_name: user?.email || "system", actor_role: roleOf(user),
    action, previous_state: prev, new_state: next, reason: reason || null, metadata: metadata || {},
    occurred_at: new Date().toISOString(),
  }).catch(() => {});
}

// §7/§8 idempotent task generation from a CaseEvent. Same event -> exactly ONE task per type.
export async function ensureTasksFromCaseEvent(svc: any, app: any, event: any): Promise<any[]> {
  const rules = resolveTasksForEvent(event, app);
  const created: any[] = [];
  for (const r of rules) {
    const sourceEventId = event?.id || event?.idempotency_key || null;
    const key = taskKey(app.id, sourceEventId, r.task_type);
    const existing: any[] = await svc.entities.OperationsTask.filter({ idempotency_key: key }).catch(() => []);
    if (existing && existing.length) continue; // idempotent: already exists
    const now = new Date();
    const proto: any = {
      case_id: app.id, application_id: app.id, traveler_id: app.traveler_id || null,
      organization_id: app.organization_id || null, task_type: r.task_type,
      title: titleForType[r.task_type] || r.task_type, queue: r.queue, status: "QUEUED",
      priority: "NORMAL", assigned_to: null, assigned_team: TEAM_FOR_TYPE[r.task_type] ?? null,
      source_event_id: sourceEventId, source_rule: r.source_rule, idempotency_key: key,
      destination: app.destination || null, journey_type: app.visa_type_key || null,
      nationality: app.nationality || null, provider_key: app.provider_key || null,
      execution_capability: app.execution_capability || null,
      created_at: now.toISOString(), updated_at: now.toISOString(),
      sla_policy: { hours: slaForTaskType(r.task_type).hours, label: slaForTaskType(r.task_type).label },
      automation_class: automationClassFor(r.task_type, app),
      metadata: { source_event_type: event?.event_type, new_case_state: event?.new_case_state },
    };
    const due = computeDueAt(proto, now.toISOString());
    if (due) proto.due_at = due;
    proto.priority = deterministicTaskPriority(proto, app, { now: now.toISOString() });
    let row: any = null;
    try { row = await svc.entities.OperationsTask.create(proto); } catch { continue; }
    created.push(row);
    await audit(svc, { id: "system", role: "admin", email: "system" }, { ...proto, id: row.id }, "TASK_CREATED", null, "QUEUED", `Generated from ${r.source_rule}`, { source_event_id, task_type: r.task_type });
  }
  return created;
}

// Backfill: generate tasks from existing CaseEvents (legacy + already-migrated cases).
export async function backfillTasksFromEvents(svc: any, opts: { limit?: number } = {}): Promise<{ scanned: number; events: number; tasks_created: number; cases_touched: number }> {
  const rows: any[] = await svc.entities.VisaApplication.list("-created_date", opts.limit || 5000).catch(() => []);
  let events = 0, tasks_created = 0, touched = 0;
  for (const app of rows) {
    const evs: any[] = await loadCaseEvents(svc, app.id, 200).catch(() => []);
    if (!evs.length) continue;
    touched++;
    for (const e of evs) {
      events++;
      const created = await ensureTasksFromCaseEvent(svc, app, { ...e, id: e.id, new_case_state: e.new_case_state }).catch(() => []);
      tasks_created += created.length;
    }
  }
  return { scanned: rows.length, events, tasks_created, cases_touched: touched };
}

async function getTaskOrFail(svc: any, taskId: string): Promise<any> {
  const t: any = await svc.entities.OperationsTask.get(taskId).catch(() => null);
  if (!t) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND" });
  return t;
}

// §13 claim
export async function claimTask(svc: any, user: any, taskId: string): Promise<any> {
  assertAdmin(user);
  const t = await getTaskOrFail(svc, taskId);
  if (!canTransitionTask(t.status, "ASSIGNED")) throw Object.assign(new Error(`Cannot claim from ${t.status}`), { code: "BAD_TRANSITION" });
  const prev = t.status;
  const now = new Date().toISOString();
  const patch: any = { assigned_to: user.id, assigned_team: t.assigned_team || "OPERATIONS", status: "ASSIGNED", started_at: t.started_at || now, updated_at: now };
  const updated = await svc.entities.OperationsTask.update(taskId, patch);
  await audit(svc, user, { ...t, id: taskId }, "TASK_CLAIMED", prev, "ASSIGNED", "Claimed", { assigned_to: user.id });
  return updated;
}

// §13 assign / reassign
export async function assignTask(svc: any, user: any, taskId: string, assigneeId: string | null, team?: string): Promise<any> {
  assertAdmin(user);
  const t = await getTaskOrFail(svc, taskId);
  const prev = t.assigned_to || null;
  const now = new Date().toISOString();
  const targetStatus = t.status === "QUEUED" ? "ASSIGNED" : t.status;
  const patch: any = { assigned_to: assigneeId, assigned_team: team || t.assigned_team || null, status: targetStatus, updated_at: now };
  if (assigneeId && targetStatus === "QUEUED") patch.started_at = t.started_at || now;
  const updated = await svc.entities.OperationsTask.update(taskId, patch);
  await audit(svc, user, { ...t, id: taskId }, prev ? "TASK_REASSIGNED" : "TASK_ASSIGNED", t.status, targetStatus, prev ? `Reassigned ${prev} -> ${assigneeId}` : `Assigned ${assigneeId}`, { previous: prev, assignee: assigneeId });
  return updated;
}
export async function releaseTask(svc: any, user: any, taskId: string): Promise<any> {
  assertAdmin(user);
  const t = await getTaskOrFail(svc, taskId);
  const prev = t.status;
  if (!canTransitionTask(prev, "QUEUED")) throw Object.assign(new Error(`Cannot release from ${prev}`), { code: "BAD_TRANSITION" });
  const updated = await svc.entities.OperationsTask.update(taskId, { assigned_to: null, status: "QUEUED", updated_at: new Date().toISOString() });
  await audit(svc, user, { ...t, id: taskId }, "TASK_RELEASED", prev, "QUEUED", "Released", {});
  return updated;
}

// §4 generic status transition (start/waiting/blocked/cancel)
export async function transitionTaskStatus(svc: any, user: any, taskId: string, to: TaskStatus, extra: any = {}): Promise<any> {
  assertAdmin(user);
  const t = await getTaskOrFail(svc, taskId);
  const prev = t.status;
  if (!canTransitionTask(prev, to)) throw Object.assign(new Error(`Invalid task transition ${prev} -> ${to}`), { code: "BAD_TRANSITION" });
  const now = new Date().toISOString();
  const patch: any = { status: to, updated_at: now, ...extra };
  if (to === "IN_PROGRESS" && !t.started_at) patch.started_at = now;
  if (to === "WAITING") { patch.waiting_since = now; patch.waiting_reason = extra.waiting_reason || null; patch.next_check_at = extra.next_check_at || null; }
  if (to === "BLOCKED") { patch.blocked_at = now; patch.block_reason = extra.block_reason || null; patch.blocker_owner = extra.blocker_owner || null; }
  const updated = await svc.entities.OperationsTask.update(taskId, patch);
  const actionMap: Record<string, string> = { IN_PROGRESS: "TASK_STARTED", WAITING: "TASK_WAITING", BLOCKED: "TASK_BLOCKED", CANCELLED: "TASK_CANCELLED", QUEUED: "TASK_RELEASED" };
  await audit(svc, user, { ...t, id: taskId }, actionMap[to] || "TASK_STARTED", prev, to, extra.reason || "", extra);
  return updated;
}

// §21 completion with required-resolution gating
export async function completeTask(svc: any, user: any, taskId: string, decision: string, reason: string | null): Promise<any> {
  assertAdmin(user);
  const t = await getTaskOrFail(svc, taskId);
  if (!canTransitionTask(t.status, "COMPLETED")) throw Object.assign(new Error(`Cannot complete from ${t.status}`), { code: "BAD_TRANSITION" });
  if (!canResolve(t.task_type, decision)) throw Object.assign(new Error(`Decision '${decision}' not allowed for ${t.task_type}`), { code: "BAD_RESOLUTION" });
  const now = new Date().toISOString();
  const updated = await svc.entities.OperationsTask.update(taskId, {
    status: "COMPLETED", completed_at: now, completed_by: user.id, updated_at: now,
    resolution: { decision, reason: reason || null, at: now, by: user.id },
  });
  await audit(svc, user, { ...t, id: taskId }, "TASK_RESOLUTION_RECORDED", t.status, "COMPLETED", `${decision}: ${reason || ""}`, { decision });
  return updated;
}

// §10 priority override (deterministic + audited)
export async function overridePriority(svc: any, user: any, taskId: string, requested: Priority, reason: string | null): Promise<any> {
  assertAdmin(user);
  const t = await getTaskOrFail(svc, taskId);
  const base = deterministicTaskPriority(t, {}, { now: new Date().toISOString() });
  const cur = t.priority || base;
  const { overridden, priority, record } = applyTaskPriorityOverride(cur, requested, reason, user.id);
  if (requested !== cur && !overridden) throw Object.assign(new Error("Priority override requires actor + reason; cannot lower URGENT"), { code: "OVERRIDE_REJECTED" });
  const patch: any = { priority, updated_at: new Date().toISOString() };
  if (overridden && record) patch.priority_override = record;
  const updated = await svc.entities.OperationsTask.update(taskId, patch);
  await audit(svc, user, { ...t, id: taskId }, "TASK_PRIORITY_CHANGED", cur, priority, reason || "Priority set", { overridden, base });
  return { task: updated, priority, overridden, base };
}

// §20 task action -> Case Engine -> persist case_state + CaseEvent -> complete task.
// The Case Engine remains the SOLE authority for application state.
export async function taskAction(svc: any, user: any, taskId: string, actionCode: string, payload: any = {}): Promise<any> {
  assertAdmin(user);
  const t = await getTaskOrFail(svc, taskId);
  const plan = planTaskAction(t.task_type, actionCode);
  if (!plan) throw Object.assign(new Error(`Action ${actionCode} not valid for ${t.task_type}`), { code: "BAD_ACTION" });
  const app: any = await svc.entities.VisaApplication.get(t.case_id).catch(() => null);
  if (!app) throw Object.assign(new Error("Case not found"), { code: "NOT_FOUND" });

  // §20 if the action requires a case transition, drive it THROUGH the case engine.
  let caseResult: any = null;
  if (plan.case_target) {
    const r = await transitionCaseToState(svc, app, plan.case_target, {
      actor_type: "OPERATOR", actor_id: user.id || user.email, source: "ops_task",
      idempotency_key: payload.idempotency_key || `opsact_${taskId}_${actionCode}`,
      reason: payload.reason || `${t.task_type}.${actionCode}`,
    }).catch((e: any) => ({ ok: false, code: "ENGINE_ERROR", error: String(e?.message || e) }));
    if (!r.ok) throw Object.assign(new Error(`Case transition blocked: ${r.error || r.code}`), { code: r.code || "BAD_TRANSITION" });
    caseResult = r;
  }

  // §26 create/raise an exception when the action dictates
  let exceptionId: string | null = null;
  if (plan.create_exception) {
    const ex = await svc.entities.CaseException.create({
      case_id: t.case_id, application_id: t.application_id || t.case_id, traveler_id: t.traveler_id || null, task_id: t.id,
      type: plan.create_exception.type, severity: plan.create_exception.severity, status: "OPEN",
      message: plan.create_exception.message, metadata: { action: actionCode, actor: user.id },
    }).catch(() => null);
    if (ex) { exceptionId = ex.id; await svc.entities.OperationsTask.update(taskId, { exception_id: ex.id }).catch(() => {}); await audit(svc, user, { ...t, id: taskId }, "EXCEPTION_CREATED", null, null, plan.create_exception.message, { exception_id: ex.id, type: plan.create_exception.type }); }
  }

  // Mark IN_PROGRESS then complete
  if (t.status !== "IN_PROGRESS" && canTransitionTask(t.status, "IN_PROGRESS")) await transitionTaskStatus(svc, user, taskId, "IN_PROGRESS", {}).catch(() => {});
  const completed = await completeTask(svc, user, taskId, plan.decision, payload.reason || "").catch(() => null);
  return { task: completed || t, case_result: caseResult, exception_id: exceptionId, decision: plan.decision, case_target: plan.case_target };
}

// §32 bulk actions (no case-state transitions). Audited per task.
export async function bulkAction(svc: any, user: any, taskIds: string[], action: string, payload: any = {}): Promise<{ applied: number; results: any[] }> {
  assertAdmin(user);
  if (!isBulkAllowed(action)) throw Object.assign(new Error(`Bulk action ${action} not allowed`), { code: "BAD_BULK" });
  const results: any[] = [];
  let applied = 0;
  for (const id of taskIds) {
    try {
      let r: any = null;
      if (action === "ASSIGN") r = await assignTask(svc, user, id, payload.assignee || null, payload.team);
      else if (action === "PRIORITY") r = await overridePriority(svc, user, id, payload.priority, payload.reason).catch(() => null);
      else if (action === "MOVE_QUEUE") { const t = await getTaskOrFail(id); r = await svc.entities.OperationsTask.update(id, { queue: payload.queue, updated_at: new Date().toISOString() }); await audit(svc, user, { ...t, id }, "TASK_BULK_ACTION", t.queue, payload.queue, `Move to ${payload.queue}`, { bulk: action }); }
      else if (action === "MARK_WAITING") r = await transitionTaskStatus(svc, user, id, "WAITING", { waiting_reason: payload.waiting_reason || "BULK_WAITING" }).catch(() => null);
      applied++; results.push({ id, ok: true });
    } catch (e: any) { results.push({ id, ok: false, error: String(e?.message || e) }); }
  }
  return { applied, results };
}

// §26 create + §27 workflow for a CaseException
export async function createException(svc: any, user: any, p: { case_id: string; type: string; severity: string; message: string; task_id?: string }): Promise<any> {
  assertAdmin(user);
  const app = await svc.entities.VisaApplication.get(p.case_id).catch(() => null);
  const ex = await svc.entities.CaseException.create({
    case_id: p.case_id, application_id: p.case_id, traveler_id: app?.traveler_id || null, task_id: p.task_id || null,
    type: p.type, severity: p.severity as any, status: "OPEN", message: p.message,
  });
  await audit(svc, user, { case_id: p.case_id, application_id: p.case_id, traveler_id: app?.traveler_id || null, task_id: p.task_id || null, id: p.task_id || null }, "EXCEPTION_CREATED", null, null, p.message, { exception_id: ex.id, type: p.type });
  // §8/§27 exceptions generate a linked EXCEPTION_HANDLING task (idempotent).
  const key = taskKey(p.case_id, `exc_${ex.id}`, "EXCEPTION_HANDLING");
  const existing: any[] = await svc.entities.OperationsTask.filter({ idempotency_key: key }).catch(() => []);
  if (!existing.length) {
    const now = new Date().toISOString();
    const due = computeDueAt({ task_type: "EXCEPTION_HANDLING" }, now);
    const proto: any = { case_id: p.case_id, application_id: p.case_id, traveler_id: app?.traveler_id || null, task_type: "EXCEPTION_HANDLING", title: titleForType.EXCEPTION_HANDLING, queue: "EXCEPTIONS", status: "QUEUED", priority: p.severity === "CRITICAL" ? "URGENT" : p.severity === "HIGH" ? "HIGH" : "NORMAL", assigned_to: null, assigned_team: "OPERATIONS", source_event_id: `exc_${ex.id}`, source_rule: `exception:${p.type}`, idempotency_key: key, destination: app?.destination || null, journey_type: app?.visa_type_key || null, nationality: app?.nationality || null, provider_key: app?.provider_key || null, execution_capability: app?.execution_capability || null, created_at: now, updated_at: now, sla_policy: { hours: slaForTaskType("EXCEPTION_HANDLING").hours, label: slaForTaskType("EXCEPTION_HANDLING").label }, automation_class: "MANUAL", exception_id: ex.id, metadata: { exception_type: p.type } };
    if (due) proto.due_at = due;
    await svc.entities.OperationsTask.create(proto).catch(() => null);
  }
  return ex;
}
export async function resolveException(svc: any, user: any, exceptionId: string, resolution: string, status = "RESOLVED"): Promise<any> {
  assertAdmin(user);
  const ex: any = await svc.entities.CaseException.get(exceptionId).catch(() => null);
  if (!ex) throw Object.assign(new Error("Exception not found"), { code: "NOT_FOUND" });
  const updated = await svc.entities.CaseException.update(exceptionId, { status, resolution, resolved_at: new Date().toISOString() }).catch(() => null);
  await audit(svc, user, { case_id: ex.case_id, application_id: ex.case_id, traveler_id: ex.traveler_id, task_id: ex.task_id, id: ex.task_id }, status === "RESOLVED" ? "EXCEPTION_RESOLVED" : status === "DISMISSED" ? "EXCEPTION_DISMISSED" : "EXCEPTION_ESCALATED", ex.status, status, resolution, { exception_id: exceptionId, type: ex.type });
  return updated;
}

// §15/§16 list + server-side filter/pagination/sort. No N+1.
export async function listTasks(svc: any, user: any, filters: any = {}, sort = "-created_at", limit = 50, offset = 0): Promise<{ tasks: any[]; total: number; summary: any }> {
  assertAdmin(user);
  const q: any = {};
  if (filters.queue) q.queue = filters.queue;
  if (filters.status) q.status = filters.status;
  if (filters.priority) q.priority = filters.priority;
  if (filters.task_type) q.task_type = filters.task_type;
  if (filters.assignee) q.assigned_to = filters.assignee;
  if (filters.unassigned) q.assigned_to = null;
  if (filters.destination) q.destination = filters.destination;
  if (filters.journey) q.journey_type = filters.journey;
  if (filters.provider) q.provider_key = filters.provider;
  if (filters.execution_capability) q.execution_capability = filters.execution_capability;
  if (filters.case_id) q.case_id = filters.case_id;
  if (filters.created_from || filters.created_to) { q.created_at = {}; if (filters.created_from) q.created_at.$gte = filters.created_from; if (filters.created_to) q.created_at.$lte = filters.created_to; }
  const fetchLimit = (offset + limit) + 5;
  let rows: any[] = await svc.entities.OperationsTask.filter(Object.keys(q).length ? q : {}, sort, fetchLimit).catch(() => []);
  // derived filters
  if (filters.overdue) rows = rows.filter((t) => new Date(t.due_at) < new Date() && !TERMINAL_TASK.includes(t.status));
  if (filters.due_today) { const d = new Date(); const s = new Date(d.toDateString()); const e = new Date(s.getTime() + 86400000); rows = rows.filter((t) => t.due_at && new Date(t.due_at) >= s && new Date(t.due_at) < e && !TERMINAL_TASK.includes(t.status)); }
  if (filters.queue_scope === "MY_TASKS") rows = rows.filter((t) => t.assigned_to === user.id);
  if (filters.search) {
    const s = String(filters.search).trim().toLowerCase();
    rows = rows.filter((t) => ((t.id || "").toLowerCase().includes(s)) || ((t.case_id || "").toLowerCase().includes(s)) || ((t.task_type || "").toLowerCase().includes(s)) || ((t.assigned_to || "").toLowerCase().includes(s)));
    const byCaseQ: any[] = await svc.entities.OperationsTask.filter({ provider_key: filters.search }).catch(() => []);
    if (byCaseQ.length) rows = rows.concat(byCaseQ);
  }
  const total = rows.length;
  const page = rows.slice(offset, offset + limit);
  const summary = opsDashboardSummary(rows);
  return { tasks: page.map((t) => ({ ...t, overdue: !!(t.due_at && new Date(t.due_at) < new Date() && !TERMINAL_TASK.includes(t.status)) })), total, summary };
}

// §33 dashboard metrics derived from OperationsTask data
export function opsDashboardSummary(rows: any[]): any {
  const now = new Date();
  const dayStart = new Date(now.toDateString()); const dayEnd = new Date(dayStart.getTime() + 86400000);
  let open = 0, unassigned = 0, dueToday = 0, overdue = 0, high = 0, waiting = 0, blocked = 0, exceptions = 0, completedToday = 0;
  const byQueue: Record<string, number> = {}, byAssignee: Record<string, number> = {}, byType: Record<string, number> = {}, byDestination: Record<string, number> = {};
  for (const t of rows) {
    if (t.status === "COMPLETED" || t.status === "CANCELLED") { if (t.completed_at && new Date(t.completed_at) >= dayStart && new Date(t.completed_at) < dayEnd) completedToday++; continue; }
    open++;
    if (!t.assigned_to) unassigned++;
    if (t.due_at) { const d = new Date(t.due_at); if (d < now) overdue++; else if (d >= dayStart && d < dayEnd) dueToday++; }
    if (t.priority === "HIGH" || t.priority === "URGENT") high++;
    if (t.status === "WAITING") waiting++;
    if (t.status === "BLOCKED") blocked++;
    if (t.exception_id) exceptions++;
    byQueue[t.queue] = (byQueue[t.queue] || 0) + 1;
    if (t.assigned_to) byAssignee[t.assigned_to] = (byAssignee[t.assigned_to] || 0) + 1;
    byType[t.task_type] = (byType[t.task_type] || 0) + 1;
    if (t.destination) byDestination[t.destination] = (byDestination[t.destination] || 0) + 1;
  }
  return { open, unassigned, due_today: dueToday, overdue, high_priority: high, waiting, blocked, exceptions, completed_today: completedToday, by_queue: byQueue, by_assignee: byAssignee, by_type: byType, by_destination: byDestination, total: rows.length };
}

// §17 task detail
export async function getTaskDetail(svc: any, user: any, taskId: string): Promise<any> {
  assertAdmin(user);
  const t = await getTaskOrFail(svc, taskId);
  const app = await svc.entities.VisaApplication.get(t.case_id).catch(() => null);
  const caseCtx = projectCaseContext(t, app);
  const auditRows: any[] = await svc.entities.OperationsAuditEvent.filter({ task_id: taskId }, "-occurred_at", 200).catch(() => []);
  const exceptions: any[] = await svc.entities.CaseException.filter({ case_id: t.case_id }, "-created_date", 50).catch(() => []);
  const notes: any[] = await svc.entities.InternalNote.filter({ task_id: taskId }, "-created_date", 100).catch(() => []);
  const permissions = opsPermissions(user.role);
  return { task: { ...t, overdue: !!(t.due_at && new Date(t.due_at) < new Date() && !TERMINAL_TASK.includes(t.status)) }, case_context: caseCtx, case: app, audit: auditRows, exceptions, notes: notes.map((n) => ({ id: n.id, author_name: n.author_name, body: n.body, pinned: n.pinned, created_at: n.created_date })), permissions };
}

// §37 export (admin-only, filtered, redacted)
export async function exportTasks(svc: any, user: any, filters: any, format: "csv" | "json"): Promise<any> {
  assertAdmin(user);
  const { tasks } = await listTasks(svc, user, filters, "-created_at", 5000, 0);
  const out = tasks.map(exportTaskRow);
  await audit(svc, user, { case_id: "export", application_id: "export", traveler_id: "export", task_id: null, id: null }, "TASK_EXPORTED", null, null, `Export ${format} (${out.length} rows)`, { format, count: out.length, filters });
  if (format === "json") return { format: "json", rows: out, count: out.length };
  const header = Object.keys(out[0] || { id: "" }).join(",");
  const csv = [header, ...out.map((r: any) => Object.values(r).map((v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  return { format: "csv", csv, count: out.length };
}

export { QUEUE_FOR_TYPE, TASK_STATUSES, PRIORITIES, QUEUES, opsPermissions, canAccessTask, projectCaseContext };