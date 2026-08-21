// Krosz MVP locked commercial/review policy.
// Flow: deterministic digital gate (score >= 90, zero blockers) -> transparent price -> payment
// -> Visa Approver Manager review -> approved to submission OR not-doable -> CEO decision
// -> full eligible refund initiated/executed within 24h -> feedback captured for future rule hardening.
// This module orchestrates existing Phase 10/13/19 services; it is NOT a second state machine.

import { runReview } from "../review/engine.ts";
import { ensureCase } from "../operations/engine.ts";
import { requestRefund, approveRefund, executeRefund } from "../payments/engine.ts";
import { recordTimelineEvent } from "../journey/events.ts";

export const KROSZ_MIN_DIGITAL_SCORE = 90;

function assertAdmin(user: any) {
  if (!user || user.role !== "admin") throw Object.assign(new Error("Operations access required"), { code: "FORBIDDEN" });
}

async function staffProfile(svc: any, user: any) {
  assertAdmin(user);
  const rows: any[] = await svc.entities.KroszStaffProfile.filter({ user_id: user.id, active: true }).catch(() => []);
  return rows[0] || null;
}

async function assertApprover(svc: any, user: any) {
  const p = await staffProfile(svc, user);
  if (!p || !["VISA_APPROVER_MANAGER", "CEO"].includes(p.staff_role)) throw Object.assign(new Error("Visa Approver Manager access required"), { code: "VISA_APPROVER_ROLE_REQUIRED" });
  return p;
}

async function assertCeo(svc: any, user: any) {
  const p = await staffProfile(svc, user);
  if (!p || p.staff_role !== "CEO") throw Object.assign(new Error("CEO approval required"), { code: "CEO_ROLE_REQUIRED" });
  return p;
}

export async function setStaffRole(svc: any, user: any, targetUserId: string, email: string, role: "VISA_APPROVER_MANAGER" | "VISA_OPS" | "CEO") {
  assertAdmin(user);
  if (user.platform_role !== "platform_owner") throw Object.assign(new Error("Platform owner access required to assign Krosz staff roles"), { code: "PLATFORM_OWNER_REQUIRED" });
  const existing: any[] = await svc.entities.KroszStaffProfile.filter({ user_id: targetUserId }).catch(() => []);
  const patch = { user_id: targetUserId, email: email || "", staff_role: role, active: true, assigned_by: user.id, assigned_at: new Date().toISOString(), metadata: {} };
  return existing[0] ? await svc.entities.KroszStaffProfile.update(existing[0].id, patch) : await svc.entities.KroszStaffProfile.create(patch);
}

export async function getDigitalPaymentGate(base44: any, svc: any, user: any, app: any) {
  // Deterministic-only review before payment: no paid human review and no AI needed for the commercial gate.
  const { review, findings } = await runReview(base44, svc, user, app, { trigger: "MANUAL_REVIEW", ai: false });
  const openBlocking = findings.filter((f: any) => f.status === "OPEN" && (f.severity === "BLOCKING" || f.severity === "CRITICAL"));
  const score = Number(review?.quality_score ?? review?.metadata?.quality_score ?? 0);
  const allowed = review?.status !== "FAILED" && openBlocking.length === 0 && score >= KROSZ_MIN_DIGITAL_SCORE;
  return {
    allowed,
    score,
    minimum_score: KROSZ_MIN_DIGITAL_SCORE,
    zero_blockers: openBlocking.length === 0,
    blocker_count: openBlocking.length,
    review_id: review?.id || null,
    review_status: review?.status || "UNKNOWN",
    reasons: [
      ...(score < KROSZ_MIN_DIGITAL_SCORE ? [{ code: "DIGITAL_SCORE_BELOW_90", message: `Application quality must reach ${KROSZ_MIN_DIGITAL_SCORE} before payment.` }] : []),
      ...openBlocking.map((f: any) => ({ code: f.code || "BLOCKING_FINDING", message: f.description || f.title || "Blocking issue requires correction." })),
    ],
  };
}

export async function initializePostPaymentReview(svc: any, user: any, app: any, payment: any, order: any) {
  if (!app || !payment || !order || payment.status !== "SUCCEEDED") return null;
  const existing: any[] = await svc.entities.PostPaymentReview.filter({ application_id: app.id, order_id: order.id }).catch(() => []);
  if (existing[0]) return existing[0];
  const reviews: any[] = await svc.entities.ApplicationReview.filter({ application_id: app.id }).catch(() => []);
  reviews.sort((a: any, b: any) => String(b.completed_at || b.created_date || "").localeCompare(String(a.completed_at || a.created_date || "")));
  const digital = reviews.find((r: any) => !r.ai_review && !r.stale) || reviews[0] || null;
  const opCase = await ensureCase(svc, app);
  const row = await svc.entities.PostPaymentReview.create({
    application_id: app.id,
    traveler_id: app.traveler_id,
    operations_case_id: opCase?.id || null,
    order_id: order.id,
    payment_id: payment.id,
    digital_review_id: digital?.id || null,
    digital_quality_score: Number(digital?.quality_score ?? digital?.metadata?.quality_score ?? 0),
    digital_blocking_count: Number(digital?.blocking_count || 0),
    status: "PENDING_VERIFIER",
    ceo_status: "NOT_REQUIRED",
    learning_status: "PENDING",
    metadata: { policy: "KROSZ_MVP_V1", paid_at: payment.paid_at || new Date().toISOString() },
  });
  await recordTimelineEvent(svc, app, {
    event_type: "FINAL_REVIEW_COMPLETED",
    source_ref: row.id,
    actor_type: "SYSTEM",
    visibility: "CUSTOMER",
    metadata: { stage: "VISA_APPROVER_MANAGER_QUEUED", message: "Payment received. Your application is queued for final Visa Approver Manager review." },
  }).catch(() => {});
  return row;
}

export async function startVerifierReview(svc: any, user: any, reviewId: string) {
  await assertApprover(svc, user);
  const r: any = await svc.entities.PostPaymentReview.get(reviewId).catch(() => null);
  if (!r) throw Object.assign(new Error("Post-payment review not found"), { code: "NOT_FOUND" });
  if (!["PENDING_VERIFIER", "IN_VERIFIER_REVIEW"].includes(r.status)) throw Object.assign(new Error(`Review not startable (${r.status})`), { code: "BAD_STATE" });
  return await svc.entities.PostPaymentReview.update(r.id, {
    status: "IN_VERIFIER_REVIEW", verifier_id: user.id, verifier_name: user.full_name || user.email || user.id,
    verifier_started_at: r.verifier_started_at || new Date().toISOString(),
  });
}

export async function verifierDecision(svc: any, user: any, reviewId: string, decision: "APPROVE" | "NOT_DOABLE", reasonCode = "", reason = "") {
  await assertApprover(svc, user);
  const r: any = await svc.entities.PostPaymentReview.get(reviewId).catch(() => null);
  if (!r) throw Object.assign(new Error("Post-payment review not found"), { code: "NOT_FOUND" });
  if (!["PENDING_VERIFIER", "IN_VERIFIER_REVIEW"].includes(r.status)) throw Object.assign(new Error(`Review not decidable (${r.status})`), { code: "BAD_STATE" });
  const now = new Date().toISOString();
  if (decision === "APPROVE") {
    return await svc.entities.PostPaymentReview.update(r.id, {
      status: "APPROVED_FOR_SUBMISSION", verifier_id: user.id, verifier_name: user.full_name || user.email || user.id,
      verifier_decided_at: now, verifier_reason_code: reasonCode || "APPROVED", verifier_reason: reason || "Approved for managed submission",
      ceo_status: "NOT_REQUIRED",
    });
  }
  if (!reasonCode || !reason) throw Object.assign(new Error("reason_code and reason are required for NOT_DOABLE"), { code: "REASON_REQUIRED" });
  const app: any = await svc.entities.VisaApplication.get(r.application_id).catch(() => null);
  const updated = await svc.entities.PostPaymentReview.update(r.id, {
    status: "NOT_DOABLE_PENDING_CEO", verifier_id: user.id, verifier_name: user.full_name || user.email || user.id,
    verifier_decided_at: now, verifier_reason_code: reasonCode, verifier_reason: reason,
    ceo_status: "PENDING", learning_status: "CAPTURED",
    learning_payload: { reason_code: reasonCode, reason, digital_quality_score: r.digital_quality_score, digital_review_id: r.digital_review_id, captured_at: now },
  });
  await svc.entities.DigitalRuleFeedback.create({
    application_id: r.application_id, post_payment_review_id: r.id, destination: app?.destination || null,
    visa_type_key: app?.visa_type_key || null, purpose: app?.purpose || null, reason_code: reasonCode, reason,
    digital_quality_score: Number(r.digital_quality_score || 0), missed_signal: { digital_review_id: r.digital_review_id, blocker_count: r.digital_blocking_count || 0 },
    status: "NEW", created_by: user.id, metadata: { source: "POST_PAYMENT_NOT_DOABLE", policy: "KROSZ_MVP_V1" },
  }).catch(() => {});
  return updated;
}

export async function ceoDecisionAndRefund(svc: any, user: any, reviewId: string, approveRefundDecision: boolean, reason = "") {
  // Hard CEO gate: generic admin access is insufficient. Staff roles are assigned only by the platform owner.
  await assertCeo(svc, user);
  const r: any = await svc.entities.PostPaymentReview.get(reviewId).catch(() => null);
  if (!r) throw Object.assign(new Error("Post-payment review not found"), { code: "NOT_FOUND" });
  if (r.status !== "NOT_DOABLE_PENDING_CEO" || r.ceo_status !== "PENDING") throw Object.assign(new Error("Case is not awaiting CEO decision"), { code: "BAD_STATE" });
  const now = new Date();
  if (!approveRefundDecision) {
    throw Object.assign(new Error("Locked Krosz MVP policy requires a full pre-submission refund after CEO confirms a verifier NOT_DOABLE exception"), { code: "KROSZ_MVP_REFUND_REQUIRED" });
  }

  const due = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  await svc.entities.PostPaymentReview.update(r.id, {
    status: "CEO_REFUND_APPROVED", ceo_status: "APPROVED_REFUND", ceo_id: user.id,
    ceo_name: user.full_name || user.email || user.id, ceo_decided_at: now.toISOString(), ceo_reason: reason || "CEO approved refund",
    refund_due_at: due,
  });

  // Full refund is appropriate here because the exception is discovered before managed government submission.
  // Existing refund policy/provider rules remain authoritative; failures stay visible for ops instead of being hidden.
  const req: any = await requestRefund(svc, user, r.order_id, {
    type: "FULL", reason: "OPERATOR_ADJUSTMENT", reason_detail: `Krosz post-payment not-doable refund: ${r.verifier_reason_code || "NOT_DOABLE"} — ${r.verifier_reason || ""}`,
  });
  const refund = req?.refund;
  if (!refund?.id) throw Object.assign(new Error("Refund request could not be created"), { code: "REFUND_CREATE_FAILED" });
  await svc.entities.PostPaymentReview.update(r.id, { status: "REFUND_PROCESSING", refund_id: refund.id });
  await approveRefund(svc, user, refund.id);
  try {
    const out: any = await executeRefund(svc, user, refund.id);
    const finalRefund = out?.refund;
    if (finalRefund?.status === "COMPLETED") {
      const finished = await svc.entities.PostPaymentReview.update(r.id, { status: "REFUNDED", refund_id: refund.id, refund_completed_at: finalRefund.completed_at || new Date().toISOString() });
      return { review: finished, refund: finalRefund, refund_due_at: due };
    }
    return { review: await svc.entities.PostPaymentReview.get(r.id), refund: finalRefund, refund_due_at: due };
  } catch (e: any) {
    // Refund remains visible as FAILED/PROCESSING and due_at remains the SLA timer; ops can retry without double-refunding.
    return { review: await svc.entities.PostPaymentReview.get(r.id), refund: await svc.entities.Refund.get(refund.id).catch(() => null), refund_due_at: due, refund_error: e?.message || String(e), refund_error_code: e?.code || "REFUND_FAILED" };
  }
}

export async function listPostPaymentReviews(svc: any, user: any, filters: any = {}) {
  assertAdmin(user);
  const q: any = {};
  if (filters.status) q.status = filters.status;
  if (filters.application_id) q.application_id = filters.application_id;
  return await svc.entities.PostPaymentReview.filter(q, "-created_date", 200).catch(() => []);
}

export async function getPostPaymentReview(svc: any, user: any, reviewId: string) {
  assertAdmin(user);
  const review: any = await svc.entities.PostPaymentReview.get(reviewId).catch(() => null);
  if (!review) throw Object.assign(new Error("Post-payment review not found"), { code: "NOT_FOUND" });
  const feedback = await svc.entities.DigitalRuleFeedback.filter({ post_payment_review_id: reviewId }).catch(() => []);
  return { review, feedback };
}
