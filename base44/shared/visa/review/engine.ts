// Worldz Visa (Phase 13) — Review Engine: orchestrate deterministic rules + bounded AI,
// persist ApplicationReview / ReviewFinding, dedupe findings, auto-resolve remediated
// ones, cache by input_hash, and expose the server-side submission gate.
import { evaluateRules, RawFinding, ReviewInput, RULE_VERSION, REVIEW_ENGINE_VERSION, FindingSeverity } from "./rules.ts";
import { gatherReviewInput } from "./gather.ts";
import { runAiReview } from "./ai.ts";
import { getApplication } from "../application.ts";
import { recordTimelineEvent } from "../journey/events.ts";

const REVIEW_VERSION = "13.1";
const AI_TRIGGERS = new Set(["FORM_GENERATED", "REQUIREMENTS_CHANGED", "PAYMENT_COMPLETED", "APPOINTMENT_BOOKED", "SUBMISSION_PACKAGE_CREATED", "BEFORE_SUBMISSION", "MANUAL_REVIEW"]);

function sevRank(s: FindingSeverity): number { return { INFO: 1, WARNING: 2, BLOCKING: 3, CRITICAL: 4 }[s] || 1; }

function dedupeKey(f: RawFinding): string {
  const fp = f.field_path || "";
  // Collapse all identity-name checks to one customer finding regardless of pair.
  if (f.code === "IDENTITY_NAME_MISMATCH") return `Identity|IDENTITY_NAME_MISMATCH|name`;
  return `${f.category}|${f.code}|${fp}`;
}

function overallStatus(blocking: number, critical: number, warnings: number, humanReview: number): string {
  if (blocking > 0) return "BLOCKED";
  if (critical > 0) return "REQUIRES_HUMAN_REVIEW";
  if (humanReview > 0) return "REQUIRES_HUMAN_REVIEW";
  if (warnings > 0) return "WARNINGS";
  return "PASSED";
}

export async function runReview(base44: any, svc: any, user: any, app: any, opts: { trigger?: string; ai?: boolean } = {}): Promise<{ review: any; findings: any[]; cached: boolean }> {
  const trigger = opts.trigger || "MANUAL_REVIEW";
  const { input, inputHash } = await gatherReviewInput(svc, user, app);

  // Cache: reuse latest non-failed review with identical inputs (and same AI intent).
  const wantAi = opts.ai === undefined ? AI_TRIGGERS.has(trigger) : !!opts.ai;
  const prev: any[] = await svc.entities.ApplicationReview.filter({ application_id: app.id }).catch(() => []);
  const latest = prev.filter((r: any) => r.status !== "FAILED" && r.status !== "PENDING" && r.status !== "RUNNING").sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")))[0];
  if (latest && latest.input_hash === inputHash && !latest.stale && !!latest.ai_review === wantAi) {
    const findings = await listFindingsForReview(svc, latest.id);
    return { review: latest, findings, cached: true };
  }
  // Mark prior differing reviews stale (§57).
  for (const r of (prev || [])) if (r.id !== latest?.id && !r.stale) await svc.entities.ApplicationReview.update(r.id, { stale: true }).catch(() => {});

  const review = await svc.entities.ApplicationReview.create({
    application_id: app.id, traveler_id: app.traveler_id, review_version: REVIEW_VERSION,
    requirements_version: input.requirementsVersion || null, rule_version: RULE_VERSION,
    review_engine_version: REVIEW_ENGINE_VERSION, trigger, input_hash: inputHash,
    status: "RUNNING", started_at: new Date().toISOString(), ai_review: wantAi,
    finding_count: 0, blocking_count: 0, warning_count: 0, critical_count: 0,
    stale: false, audit: [{ event: "review.started", actor: user?.id || "system", trigger, at: new Date().toISOString() }], metadata: {},
  });

  const t0 = Date.now();
  let deterministic: RawFinding[] = [];
  let aiFindings: RawFinding[] = [];
  let aiError: string | null = null;
  try { deterministic = evaluateRules(input); }
  catch (e: any) {
    await finishReview(svc, review.id, "FAILED", [], 0, 0, 0, 0, Date.now() - t0, 0, { error: e?.message, ai_error: aiError });
    return { review: await svc.entities.ApplicationReview.get(review.id), findings: [], cached: false };
  }
  let aiMs = 0;
  if (wantAi) {
    const t1 = Date.now();
    try { aiFindings = await runAiReview(base44, input); }
    catch (e: any) { aiError = e?.message || String(e); }
    aiMs = Date.now() - t1;
  }
  // Merge + dedupe; AI never upgrades to blocking; deterministic wins on conflict.
  const byKey: Record<string, RawFinding> = {};
  for (const f of deterministic) { const k = dedupeKey(f); if (!byKey[k] || sevRank(f.severity) > sevRank(byKey[k].severity)) byKey[k] = f; }
  for (const f of aiFindings) { const k = dedupeKey(f); if (!byKey[k]) byKey[k] = f; else { /* deterministic already owns it; AI evidence appended */ byKey[k].evidence = { ...(byKey[k].evidence || {}), ai_evidence: f.evidence }; } }
  const merged = Object.values(byKey);

  // Auto-resolve previous OPEN findings not reproduced, create/update the rest.
  const prevOpen: any[] = await svc.entities.ReviewFinding.filter({ application_id: app.id, status: "OPEN" }).catch(() => []);
  const newKeys = new Set(merged.map((f) => dedupeKey(f)));
  for (const pf of prevOpen) if (!newKeys.has(pf.dedupe_key)) await svc.entities.ReviewFinding.update(pf.id, { status: "RESOLVED", resolved_at: new Date().toISOString(), resolved_by: "review_engine" }).catch(() => {});

  const persisted: any[] = [];
  for (const f of merged) {
    const k = dedupeKey(f);
    const exist = prevOpen.find((p) => p.dedupe_key === k);
    const row: any = {
      review_id: review.id, application_id: app.id, traveler_id: app.traveler_id, dedupe_key: k,
      category: f.category, severity: f.severity, code: f.code, title: f.title, description: f.description, description_operator: f.description_operator,
      source: f.source, status: "OPEN", field_path: f.field_path || null, entity_type: f.entity_type || null, entity_id: f.entity_id || null,
      evidence: f.evidence || {}, ai_generated: f.source?.startsWith("ai:") || false, requires_human_review: !!f.requires_human_review,
    };
    if (exist) { await svc.entities.ReviewFinding.update(exist.id, row).catch(() => {}); persisted.push({ ...row, id: exist.id }); }
    else { const created = await svc.entities.ReviewFinding.create(row).catch(() => null); if (created) persisted.push(created); }
  }

  const blocking = merged.filter((f) => f.severity === "BLOCKING").length;
  const critical = merged.filter((f) => f.severity === "CRITICAL").length;
  const warnings = merged.filter((f) => f.severity === "WARNING").length;
  const humanReview = merged.filter((f) => f.requires_human_review).length;
  const status = overallStatus(blocking, critical, warnings, humanReview);
  const qualityScore = Math.max(0, 100 - blocking * 25 - critical * 20 - warnings * 8 - merged.filter((f) => f.severity === "INFO").length * 2);

  await finishReview(svc, review.id, status, merged, blocking, warnings, critical, Date.now() - t0, aiMs, { ai_error: aiError, quality_score: qualityScore });

  const finalReview = await svc.entities.ApplicationReview.get(review.id);
  // Record a customer-facing timeline event for blockers (best-effort).
  if (blocking > 0) await recordTimelineEvent(svc, app, { event_type: "ADDITIONAL_INFORMATION_REQUIRED", actor_type: "SYSTEM", source_ref: finalReview.id, metadata: { blocking_count: blocking, codes: merged.filter((f) => f.severity === "BLOCKING").map((f) => f.code) } }).catch(() => {});
  return { review: finalReview, findings: persisted, cached: false };
}

async function finishReview(svc: any, id: string, status: string, merged: RawFinding[], blocking: number, warnings: number, critical: number, durMs: number, aiMs: number, extra: any) {
  const audit = { event: status === "FAILED" ? "review.failed" : "review.completed", at: new Date().toISOString(), status, blocking_count: blocking, warning_count: warnings, critical_count: critical, duration_ms: durMs, ai_duration_ms: aiMs };
  await svc.entities.ApplicationReview.update(id, {
    status, completed_at: new Date().toISOString(), finding_count: merged.length, blocking_count: blocking, warning_count: warnings, critical_count: critical,
    quality_score: Number(extra?.quality_score ?? 0), duration_ms: durMs, ai_duration_ms: aiMs, audit: [...(extra?.existingAudit || []), audit].slice(-50), metadata: { ...(extra || {}), existingAudit: undefined },
  }).catch(() => {});
}

async function listFindingsForReview(svc: any, reviewId: string): Promise<any[]> {
  return await svc.entities.ReviewFinding.filter({ review_id: reviewId }).catch(() => []);
}

export async function listReviews(svc: any, user: any, applicationId: string): Promise<any[]> {
  const app = await getApplication(svc, user, applicationId);
  const rows = await svc.entities.ApplicationReview.filter({ application_id: app.id }).catch(() => []);
  return rows.sort((a: any, b: any) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
}

export async function getReview(svc: any, user: any, reviewId: string): Promise<any> {
  const r: any = await svc.entities.ApplicationReview.get(reviewId).catch(() => null);
  if (!r) throw Object.assign(new Error("Review not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, r.application_id);
  const findings = await listFindingsForReview(svc, reviewId);
  return { review: { ...r, application: { id: app.id, destination: app.destination, purpose: app.purpose, status: app.status } }, findings };
}

export async function listFindings(svc: any, user: any, reviewId: string): Promise<any[]> {
  const r: any = await svc.entities.ApplicationReview.get(reviewId).catch(() => null);
  if (!r) throw Object.assign(new Error("Review not found"), { code: "NOT_FOUND" });
  await getApplication(svc, user, r.application_id); // ownership
  return await listFindingsForReview(svc, reviewId);
}

export async function listAllReviews(svc: any, user: any, filter: { status?: string } = {}): Promise<any[]> {
  if (user?.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const q: any = filter.status ? { status: filter.status } : {};
  const rows = await svc.entities.ApplicationReview.filter(q).catch(() => []);
  return rows.sort((a: any, b: any) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
}

// Operator-only waiver / dismiss with audit (§65/§66).
export async function waiveFinding(svc: any, user: any, findingId: string, reason: string): Promise<any> {
  if (user?.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const f: any = await svc.entities.ReviewFinding.get(findingId).catch(() => null);
  if (!f) throw Object.assign(new Error("Finding not found"), { code: "NOT_FOUND" });
  await svc.entities.ReviewFinding.update(findingId, { status: "WAIVED", waived_by: user.id, waived_at: new Date().toISOString(), waiver_reason: reason || "" });
  await appendAudit(svc, f.review_id, { event: "finding.waived", finding_id: findingId, actor: user.id, reason, at: new Date().toISOString() });
  return { id: findingId, status: "WAIVED" };
}

export async function dismissFinding(svc: any, user: any, findingId: string, reason: string): Promise<any> {
  if (user?.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  const f: any = await svc.entities.ReviewFinding.get(findingId).catch(() => null);
  if (!f) throw Object.assign(new Error("Finding not found"), { code: "NOT_FOUND" });
  await svc.entities.ReviewFinding.update(findingId, { status: "DISMISSED", dismissed_by: user.id, dismissed_at: new Date().toISOString() });
  await appendAudit(svc, f.review_id, { event: "finding.dismissed", finding_id: findingId, actor: user.id, reason, at: new Date().toISOString() });
  return { id: findingId, status: "DISMISSED" };
}

async function appendAudit(svc: any, reviewId: string, event: any): Promise<void> {
  const r: any = await svc.entities.ApplicationReview.get(reviewId).catch(() => null);
  if (!r) return;
  const audit = Array.isArray(r.audit) ? r.audit : [];
  audit.push(event);
  await svc.entities.ApplicationReview.update(reviewId, { audit: audit.slice(-100) }).catch(() => {});
}

// Server-side submission gate (§55) + final gate (§56).
export async function canSubmitApplication(base44: any, svc: any, user: any, appId: string): Promise<{ allowed: boolean; reasons: any[]; review: any; findings: any[] }> {
  const app = await getApplication(svc, user, appId);
  const { review, findings } = await runReview(base44, svc, user, app, { trigger: "BEFORE_SUBMISSION", ai: true });
  const blocking = findings.filter((f: any) => f.status === "OPEN" && (f.severity === "BLOCKING" || f.severity === "CRITICAL"));
  const allowed = blocking.length === 0 && review.status !== "FAILED";
  const reasons = blocking.map((f: any) => ({ code: f.code, description: f.description }));
  await appendAudit(svc, review.id, { event: allowed ? "final_submission_gate_passed" : "final_submission_gate_blocked", actor: user.id, blocking_codes: reasons.map((r: any) => r.code), at: new Date().toISOString() });
  return { allowed, reasons, review, findings };
}