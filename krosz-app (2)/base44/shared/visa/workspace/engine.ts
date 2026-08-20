// Worldz Visa (Phase 16) — Application Workspace engine.
//
// Single read path that bundles everything the workspace UI needs (application,
// pinned rule snapshot, resolved sections, answers, section-level progress,
// dynamic checklist, 3-state readiness, validation, fee quote, timeline) so the
// frontend loads the workspace in one call and persists/resumes deterministically.
//
// This module is a thin orchestrator over the EXISTING Phase 4-13 engines:
//   - resolveQuestionSet / prepopulateAnswers / validateQuestion / validateCrossField
//     / checkApplicationReadiness (questions.ts) — schema-driven questions,
//     conditional visibility, source-aware answers, server-side validation, readiness.
//   - computeRequirementProgress / expiryStatus (documents.ts) — reused Document
//     Vault; no second document storage (§10).
//   - getQuote (payments/engine.ts) — fee display only; no payment in this phase (§21).
//   - recordTimelineEvent (journey/events.ts) — append-only timeline (§15).
//
// No external visa submission is implemented here (by design — Phase 16 stops at
// READY_FOR_SUBMISSION). Answers and documents persist server-side; closing the
// browser never destroys backend state (§14/§23).

import { resolveQuestionSet, prepopulateAnswers, validateQuestion, validateCrossField, checkApplicationReadiness, type ResolvedSection, type ResolvedQuestion } from "../questions.ts";
import { computeRequirementProgress, expiryStatus, documentTypeByKey } from "../documents.ts";
import { getQuote } from "../payments/engine.ts";
import { getApplication } from "../application.ts";
import { recordTimelineEvent } from "../journey/events.ts";

// ---------- PURE HELPERS (exported for contract tests) ----------

/** Map blocking + needs-review counts to the canonical 3-state readiness (§19). */
export function classifyReadiness(blockingCount: number, needsReviewCount: number): "READY" | "NOT_READY" | "NEEDS_REVIEW" {
  if (blockingCount > 0) return "NOT_READY";
  if (needsReviewCount > 0) return "NEEDS_REVIEW";
  return "READY";
}

/** Map a Document Vault requirement state + expiry to the checklist vocabulary (§20). */
export function checklistStateFor(docState: string, exp: string): "AVAILABLE" | "MISSING" | "EXPIRED" | "INVALID" | "NEEDS_REVIEW" {
  if (docState === "missing") return "MISSING";
  if (docState === "needs_review" || docState === "processing" || docState === "uploaded") return "NEEDS_REVIEW";
  if (docState === "verified") {
    if (exp === "expired") return "EXPIRED";
    if (exp === "expiring_soon") return "NEEDS_REVIEW";
    return "AVAILABLE";
  }
  return "NEEDS_REVIEW";
}

/** Compute per-section + overall completion from resolved sections + active answers (§12). */
export function sectionProgress(sections: { key: string; label: string; questions: ResolvedQuestion[] }[], answersByCode: Record<string, any>): {
  overall_pct: number; required_total: number; required_done: number;
  sections: { key: string; label: string; total: number; done: number; complete: boolean }[];
} {
  let required_total = 0, required_done = 0;
  const out = sections.map((s) => {
    const req = s.questions.filter((q) => q.required);
    const total = req.length;
    const done = req.filter((q) => { const a = answersByCode[q.code]; return a && a.normalized_value && a.verified; }).length;
    required_total += total;
    required_done += done;
    return { key: s.key, label: s.label, total, done, complete: total > 0 && done === total };
  });
  const overall_pct = required_total ? Math.round((required_done / required_total) * 100) : 0;
  return { overall_pct, required_total, required_done, sections: out };
}

function answersByCodeFrom(answers: any[]): Record<string, any> {
  const m: Record<string, any> = {};
  for (const a of answers || []) if (a.active !== false) m[a.question_code] = a;
  return m;
}

// ---------- WORKSPACE BUNDLE ----------

export interface WorkspaceBundle {
  application: any;
  snapshot: any;
  sections: ResolvedSection[];
  answers: any[];
  progress: any;
  checklist: any;
  readiness: any;
  validation: any;
  quote: any;
  timeline: any[];
  conflict_findings: any[];
}

export async function getWorkspace(svc: any, user: any, app: any): Promise<WorkspaceBundle> {
  // 1. Resolve the pinned question set + existing answers, then prepopulate from
  //    trusted sources (passport / traveler profile / previous verified app /
  //    attached documents). Idempotent — never overwrites an active user answer.
  let answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);
  const qs = await resolveQuestionSet(svc, app, answers);
  await prepopulateAnswers(svc, app, qs).catch(() => {});
  answers = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);

  const answersByCode = answersByCodeFrom(answers);
  const questionProgress = sectionProgress(qs.sections, answersByCode);
  const docProgress = await computeRequirementProgress(svc, app);

  const progress = {
    overall_pct: questionProgress.overall_pct,
    required_total: questionProgress.required_total,
    required_done: questionProgress.required_done,
    sections: questionProgress.sections,
    documents: { total: docProgress.total, verified: docProgress.complete, pending: docProgress.pending, pct: docProgress.progress },
  };

  const checklist = await buildChecklist(svc, app, qs, answersByCode, docProgress);
  const readiness = await buildReadiness(svc, user, app);
  const validation = await buildValidation(svc, app, qs, answers);
  const quote = await getQuote(svc, app).catch(() => null);
  const timeline: any[] = await svc.entities.ApplicationTimelineEvent.filter({ application_id: app.id }).catch(() => []);
  timeline.sort((a, b) => String(b.occurred_at || b.created_date || "").localeCompare(String(a.occurred_at || a.created_date || "")));
  const conflict_findings: any[] = await svc.entities.DocumentFinding.filter({ application_id: app.id, type: "APPLICATION_DATA_CONFLICT" }).catch(() => []);

  return {
    application: app,
    snapshot: app.rule_snapshot || null,
    sections: qs.sections,
    answers,
    progress,
    checklist,
    readiness,
    validation,
    quote,
    timeline: timeline.slice(0, 20),
    conflict_findings,
  };
}

/** Start (or resume) the workspace: ensure prefill + emit an initial milestone. */
export async function startWorkspace(svc: any, user: any, app: any): Promise<WorkspaceBundle> {
  const ws = await getWorkspace(svc, user, app);
  // Emit the questions-required milestone once (idempotent via event_id dedup).
  if (ws.progress.required_total > 0 && ws.progress.required_done < ws.progress.required_total) {
    await recordTimelineEvent(svc, app, { event_type: "QUESTIONS_REQUIRED", actor_type: "SYSTEM", source_ref: app.id }).catch(() => {});
  }
  return ws;
}

// ---------- CHECKLIST (§20) ----------

async function buildChecklist(svc: any, app: any, qs: any, answersByCode: Record<string, any>, docProgress: any): Promise<any> {
  const items: any[] = [];
  // Document requirements → states from the reused Document Vault matcher.
  for (const it of docProgress.items || []) {
    let exp = "valid";
    const ad = it.application_document;
    if (ad?.document_id) {
      const doc: any = await svc.entities.Document.get(ad.document_id).catch(() => null);
      if (doc) exp = expiryStatus(doc);
    }
    items.push({
      key: it.document_type,
      label: it.name || documentTypeByKey(it.document_type)?.label || it.document_type,
      type: "document",
      required: it.mandatory_level === "mandatory",
      state: checklistStateFor(it.state, exp),
      requirement_id: it.requirement_id,
      document_types: it.document_types,
    });
  }
  // Required questions → derived from the pinned, resolved question set.
  for (const q of qs.questions || []) {
    if (!q.visible || !q.required) continue;
    const a = answersByCode[q.code];
    const answered = !!(a && a.normalized_value && a.verified);
    items.push({ key: q.code, label: q.label, type: "question", required: true, state: answered ? "AVAILABLE" : "MISSING", section: q.section });
  }
  return { items, total: items.length, complete: items.filter((i) => i.state === "AVAILABLE").length };
}

// ---------- READINESS (§19, 3-state) ----------

async function buildReadiness(svc: any, user: any, app: any): Promise<any> {
  const base: any = await checkApplicationReadiness(svc, app); // { ready, blocking_items, progress }
  const blocking = base.blocking_items || [];
  // Needs-review = open non-blocking review findings (warnings) the traveler should look at.
  const openFindings: any[] = await svc.entities.ReviewFinding.filter({ application_id: app.id, status: "OPEN" }).catch(() => []);
  const blockingCodes = new Set(blocking.map((b: any) => b.code));
  const needsReview = openFindings.filter((f: any) => !blockingCodes.has(f.code) && (f.severity === "WARNING" || f.severity === "INFO"));
  const state = classifyReadiness(blocking.length, needsReview.length);
  const reasons = blocking.map((b: any) => ({ code: b.code, message: b.message || b.code, category: b.type }));
  return {
    state,
    ready: base.ready,
    blocking_count: blocking.length,
    needs_review_count: needsReview.length,
    reasons,
    needs_review: needsReview.map((f: any) => ({ code: f.code, title: f.title, description: f.description })),
    progress: base.progress,
  };
}

export async function getReadiness(svc: any, user: any, app: any): Promise<any> {
  return await buildReadiness(svc, user, app);
}

export async function getChecklist(svc: any, app: any): Promise<any> {
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);
  const qs = await resolveQuestionSet(svc, app, answers);
  const docProgress = await computeRequirementProgress(svc, app);
  return await buildChecklist(svc, app, qs, answersByCodeFrom(answers), docProgress);
}

export async function getProgress(svc: any, app: any): Promise<any> {
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);
  const qs = await resolveQuestionSet(svc, app, answers);
  const qp = sectionProgress(qs.sections, answersByCodeFrom(answers));
  const docProgress = await computeRequirementProgress(svc, app);
  return {
    overall_pct: qp.overall_pct, required_total: qp.required_total, required_done: qp.required_done,
    sections: qp.sections,
    documents: { total: docProgress.total, verified: docProgress.complete, pending: docProgress.pending, pct: docProgress.progress },
  };
}

// ---------- VALIDATION (§13, field/section/cross-field) ----------

async function buildValidation(svc: any, app: any, qs: any, answers: any[]): Promise<any> {
  const facts: Record<string, any> = {};
  for (const a of answers) if (a.active !== false) facts[a.question_code] = a.normalized_value || a.value || "";
  facts["travel.departure_date"] = facts["travel.departure_date"] || app.travel_start || "";
  facts["travel.return_date"] = facts["travel.return_date"] || app.travel_end || "";
  facts["travel.purpose"] = facts["travel.purpose"] || app.purpose || "";

  const field_errors: any[] = [];
  const section_errors: any[] = [];
  for (const s of qs.sections || []) {
    let sectionMissing = 0;
    for (const q of s.questions) {
      if (!q.visible) continue;
      const a = answers.find((x) => x.question_code === q.code && x.active !== false);
      if (q.required && (!a || !a.normalized_value)) sectionMissing++;
      if (!a || !a.normalized_value) continue;
      const v = validateQuestion(q as any, { value: a.value, normalized_value: a.normalized_value }, facts);
      if (!v.valid && v.error) field_errors.push({ code: q.code, message: v.error, section: s.key });
    }
    if (sectionMissing) section_errors.push({ section: s.key, label: s.label, missing: sectionMissing });
  }
  const cross = validateCrossField(facts, app);
  const blockingCross = cross.filter((e) => e.blocking);
  return {
    valid: field_errors.length === 0 && blockingCross.length === 0,
    field_errors,
    cross_field_errors: cross,
    section_errors,
  };
}

export async function getValidation(svc: any, user: any, app: any): Promise<any> {
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);
  const qs = await resolveQuestionSet(svc, app, answers);
  return await buildValidation(svc, app, qs, answers);
}

// ---------- APPLICATION UPDATE / CANCEL BOUNDARY ----------

const UPDATABLE_FIELDS = new Set(["travel_start", "travel_end", "current_step", "metadata"]);

export async function updateApplication(svc: any, user: any, app: any, patch: any): Promise<any> {
  const upd: any = {};
  for (const k of Object.keys(patch || {})) if (UPDATABLE_FIELDS.has(k)) upd[k] = patch[k];
  if (Object.keys(upd).length === 0) return app;
  if (upd.metadata && app.metadata) upd.metadata = { ...app.metadata, ...upd.metadata };
  const updated = await svc.entities.VisaApplication.update(app.id, upd).catch(() => app);
  return updated;
}

export async function cancelApplication(svc: any, user: any, app: any): Promise<any> {
  if (["submitted", "government_processing", "approved", "completed"].includes(app.status)) {
    throw Object.assign(new Error("Cannot cancel an application in this state"), { code: "BAD_STATE" });
  }
  await svc.entities.VisaApplication.update(app.id, { status: "cancelled", current_step: "cancelled" }).catch(() => {});
  await recordTimelineEvent(svc, app, { event_type: "APPLICATION_CANCELLED", actor_type: "TRAVELER", source_ref: app.id }).catch(() => {});
  return await svc.entities.VisaApplication.get(app.id).catch(() => ({ ...app, status: "cancelled" }));
}

// ---------- ORCHESTRATOR EVENT BOUNDARY (§22) ----------
// The orchestrator already receives ApplicationReadinessChanged via the in-process
// bus (questions.ts) and timeline milestones via recordTimelineEvent. These thin
// helpers let the API layer emit the spec's named domain events without coupling
// visaApi to the event internals.

export async function emitDocumentLinked(svc: any, app: any): Promise<void> {
  await recordTimelineEvent(svc, app, { event_type: "DOCUMENTS_STARTED", actor_type: "TRAVELER", source_ref: app.id }).catch(() => {});
}
export async function emitApplicationValidated(svc: any, app: any): Promise<void> {
  await recordTimelineEvent(svc, app, { event_type: "FORM_GENERATED", actor_type: "SYSTEM", source_ref: app.id }).catch(() => {});
}