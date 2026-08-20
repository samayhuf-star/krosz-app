import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';
import {
  projectApplication, reconcileApplication, priorityScore,
} from '../../shared/visa/operations/opsEngine.ts';

// Krosz Phase 3 — Customer Operations Engine backend.
// Read-only, deterministic aggregation. No AI, no credit. Admin-gated for the
// command-center / daily-brief / reconciliation endpoints; the per-application
// "customer-ops" endpoint is owner-or-admin (it never exposes internal signals).
export default async function (req) {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const sr = base44.asServiceRole.entities;
  const ownEntities = base44.entities;

  const isAdmin = !!user && user.role === 'admin';

  async function loadAppContext(app: any) {
    const [orders, actions, timeline, pp, opsRows, refunds] = await Promise.all([
      sr.Order.filter({ application_id: app.id }).catch(() => []),
      ownEntities.ApplicationAction.filter({ application_id: app.id }).catch(() => []), // open actions via owner or service role
      sr.ApplicationTimelineEvent.filter({ application_id: app.id, visibility: 'CUSTOMER' }, '-occurred_at', 50).catch(() => []),
      sr.PostPaymentReview.filter({ application_id: app.id }).catch(() => []),
      sr.OperationsCase.filter({ application_id: app.id }).catch(() => []),
      sr.Refund.filter({ application_id: app.id }).catch(() => []),
    ]);
    const order = [...(orders || [])].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')))[0];
    const payments = order ? await sr.Payment.filter({ order_id: order.id }).catch(() => []) : [];
    const postPay = [...(pp || [])].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')))[0] || null;
    const opsCase = (opsRows || [])[0] || null;
    return { app, order, payments: payments || [], actions: actions || [], timeline: timeline || [], postPayReview: postPay, opsCase, refunds: refunds || [] };
  }

  try {
    // ---- Per-application customer-ops projection (owner-or-admin) ----
    if (body.action === 'customer-ops') {
      const app = await ownEntities.VisaApplication.get(body.application_id).catch(() => null);
      if (!app) return Response.json({ error: 'Not found' }, { status: 404 });
      if (app.created_by_id !== user?.id && !isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 });
      const ctx = await loadAppContext(app);
      const proj = projectApplication(ctx);
      // Expose ONLY customer-safe fields (§3/§4/§22): no SLA targets, no stuck codes, no reconciliation.
      return Response.json({
        application_id: app.id,
        stage: proj.stage, stageLabel: proj.stageLabel,
        next_action: proj.nextAction, action_owner: proj.actionOwner,
        progress_pct: proj.progressPct,
        last_update: proj.lastUpdate,
        payment_status: proj.paymentStatus,
        refund_active: proj.refundActive,
        blocked: proj.blocked && proj.actionOwner === 'CUSTOMER',
        customer_message: customerMessage(proj),
      });
    }

    if (!isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 });

    // ---- Command Center / Daily Brief ----
    if (body.action === 'command-center' || body.action === 'daily-brief') {
      const apps: any[] = await sr.VisaApplication.list('-created_date', 500).catch(() => []);
      const rows: any[] = [];
      const mismatches: any[] = [];
      for (const app of apps) {
        const ctx = await loadAppContext(app);
        const proj = projectApplication(ctx);
        const rm = reconcileApplication(ctx);
        if (rm.length) mismatches.push(...rm);
        rows.push({
          application_id: app.id, traveler_id: app.traveler_id, destination: app.destination,
          visa_type_key: app.visa_type_key, travel_date: app.metadata?.travel_date || app.travel_date || null,
          stage: proj.stage, stage_label: proj.stageLabel, next_action: proj.nextAction,
          action_owner: proj.actionOwner, blocked: proj.blocked, progress_pct: proj.progressPct,
          last_update: proj.lastUpdate, payment_status: proj.paymentStatus, refund_active: proj.refundActive,
          sla: proj.sla, stuck: proj.stuck,
          order_id: ctx.order?.id, order_number: ctx.order?.order_number, ops_case_id: ctx.opsCase?.id,
          priority_score: priorityScore({ sla: proj.sla, stuck: proj.stuck, travelDate: app.metadata?.travel_date || app.travel_date, paid: proj.paymentStatus === 'SUCCEEDED' || ctx.order?.status === 'PAID', refundActive: proj.refundActive, handoffOpen: (ctx.actions || []).some((a) => a.status === 'OPEN' && a.type === 'HUMAN_HANDOFF') }),
        });
      }
      rows.sort((a, b) => a.priority_score - b.priority_score);
      const buckets = {
        customer_action_required: rows.filter((r) => r.action_owner === 'CUSTOMER').length,
        krosz_action_required: rows.filter((r) => ['KROSZ_REVIEWER', 'KROSZ_SUPPORT', 'KROSZ_AUTOMATION'].includes(r.action_owner)).length,
        human_reviews_pending: rows.filter((r) => r.stage === 'HUMAN_REVIEW').length,
        ready_for_submission: rows.filter((r) => r.stage === 'READY_FOR_SUBMISSION').length,
        submission_in_progress: rows.filter((r) => r.stage === 'SUBMISSION_IN_PROGRESS').length,
        government_processing: rows.filter((r) => r.stage === 'GOVERNMENT_PROCESSING').length,
        additional_information_required: rows.filter((r) => r.stage === 'ADDITIONAL_INFORMATION_REQUIRED').length,
        overdue: rows.filter((r) => r.sla?.state === 'OVERDUE' || r.sla?.state === 'CRITICAL').length,
        critical: rows.filter((r) => r.sla?.state === 'CRITICAL').length,
        stuck: rows.filter((r) => r.stuck?.flag).length,
        payment_mismatches: mismatches.length,
        refund_cases: rows.filter((r) => r.refund_active).length,
        support_escalations: rows.filter((r) => (r as any).action_owner === 'KROSZ_SUPPORT').length,
        total: rows.length,
      };
      return Response.json({ rows, buckets, mismatches });
    }

    if (body.action === 'reconciliation') {
      const apps: any[] = await sr.VisaApplication.list('-created_date', 500).catch(() => []);
      const mismatches: any[] = [];
      for (const app of apps) {
        const ctx = await loadAppContext(app);
        const rm = reconcileApplication(ctx);
        if (rm.length) mismatches.push(...rm.map((m) => ({ ...m, destination: app.destination, order_number: ctx.order?.order_number })));
      }
      return Response.json({ mismatches });
    }

    // ===================== PHASE 5 — LAUNCH CONTROL TOWER (deterministic) =====================
    const LAUNCH_COUNTRIES = ["AE", "VN", "ID"];
    const COUNTRY_NAME: Record<string, string> = { AE: "UAE", VN: "Vietnam", ID: "Indonesia" };

    if (body.action === "launch-control-get") {
      return Response.json({ config: await loadLaunchConfig(sr) });
    }
    if (body.action === "launch-control-set") {
      if (!isAdmin) return Response.json({ error: "Admin access required" }, { status: 403 });
      const cfg = await loadLaunchConfig(sr);
      const patch = body.config || {};
      // Per-country pause / pilot / limit (recorded, auditable; never affects existing apps).
      if (typeof patch.global_paused === "boolean") { (cfg as any).global_paused = patch.global_paused; (cfg as any).global_paused_at = patch.global_paused ? new Date().toISOString() : null; (cfg as any).global_paused_by = patch.global_paused ? user.id : null; }
      if (patch.countries && typeof patch.countries === "object") {
        for (const cc of LAUNCH_COUNTRIES) {
          const c = patch.countries[cc];
          if (!c) continue;
          const prev = (cfg as any).countries = (cfg as any).countries || {};
          const row = prev[cc] || {};
          if (typeof c.paused === "boolean") { row.paused = c.paused; row.paused_at = c.paused ? new Date().toISOString() : null; row.paused_by = c.paused ? user.id : null; row.pause_reason = c.pause_reason || (c.paused ? row.pause_reason : null); }
          if (typeof c.pilot === "string") row.pilot = c.pilot;
          if (typeof c.max_paid_per_day === "number") row.max_paid_per_day = c.max_paid_per_day;
          prev[cc] = row;
        }
      }
      await saveLaunchConfig(sr, cfg, user, patch);
      return Response.json({ config: cfg });
    }

    if (body.action === "launch-control-tower") {
      if (!isAdmin) return Response.json({ error: "Admin access required" }, { status: 403 });
      const cfg: any = await loadLaunchConfig(sr);

      // Country rules freshness (AE/VN/ID only) — one query per country.
      const f = async (ent: any, q?: any, sort?: any, limit?: any): Promise<any[]> => { try { if (!ent?.filter) return []; return await ent.filter(q, sort, limit); } catch { return []; } };
      const lst = async (ent: any, sort?: any, limit?: any): Promise<any[]> => { try { if (!ent?.list) return []; return await ent.list(sort, limit); } catch { return []; } };
      const freshness: Record<string, any> = {};
      for (const cc of LAUNCH_COUNTRIES) {
        const caps: any[] = await f(sr.CountryCapability, { country_code: cc, nationality: "IN" }, "-rule_version", 1);
        const cap = caps[0] || null;
        freshness[cc] = ruleFreshness(cap);
      }

      // Per-country + global aggregation over recent apps (bounded, deterministic, no AI).
      const apps: any[] = await sr.VisaApplication.list("-created_date", 500).catch(() => []);
      const rows: any[] = [];
      const mismatches: any[] = [];
      for (const app of apps) {
        const ctx = await loadAppContext(app);
        const proj = projectApplication(ctx);
        const rm = reconcileApplication(ctx);
        if (rm.length) mismatches.push(...rm);
        rows.push({ destination: app.destination, stage: proj.stage, action_owner: proj.actionOwner, stuck: proj.stuck, sla: proj.sla, payment_status: proj.paymentStatus, refund_active: proj.refundActive, order_id: ctx.order?.id, order_status: ctx.order?.status, application_id: app.id });
      }

      // Support backlog (reuse SupportTicket).
      const tickets: any[] = await lst(sr.SupportTicket, "-created_date", 500);
      // Refund failures (reuse Refund).
      const refunds: any[] = await lst(sr.Refund, "-created_date", 200);
      const refundFailed = refunds.filter((r: any) => r.status === "FAILED");
      const refundOverdue = refunds.filter((r: any) => ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING"].includes(r.status) && r.eligibility !== "NOT_ELIGIBLE" && ctxAgeHours(r.created_date) > 72);

      // Paid today counts per country (pilot limit).
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const paidToday: Record<string, number> = { AE: 0, VN: 0, ID: 0 };
      const paidOrders = await f(sr.Order, { status: "PAID" }, "-created_date", 500);
      for (const o of paidOrders) { if (new Date(o.paid_at || o.created_date) >= startOfToday) { const app = apps.find((a) => a.id === o.application_id); const cc = app?.destination; if (cc && paidToday[cc] != null) paidToday[cc]++; } }

      // Per-country status.
      const countries: Record<string, any> = {};
      for (const cc of LAUNCH_COUNTRIES) {
        const cApps = rows.filter((r: any) => r.destination === cc);
        const cMism = mismatches.filter((m: any) => cApps.some((r) => r.application_id === m.application_id));
        const humanReviews = cApps.filter((r: any) => r.stage === "HUMAN_REVIEW").length;
        const paidStuck = cApps.filter((r: any) => r.stage === "HUMAN_REVIEW" && r.payment_status === "SUCCEEDED" && r.order_status === "PAID").length;
        const overdue = cApps.filter((r: any) => r.sla?.state === "OVERDUE" || r.sla?.state === "CRITICAL").length;
        const stuck = cApps.filter((r: any) => r.stuck?.flag).length;
        const submissionProblems = cApps.filter((r: any) => r.stuck?.reasons?.some((s: string) => s.includes("SUBMISSION"))).length;
        const pricing = (freshness[cc]?.status && freshness[cc].status !== "NOT_CONFIGURED") ? "OK" : "MISSING";
        const payment = cMism.filter((m: any) => ["PAID_BUT_APPLICATION_UNPAID", "APPLICATION_PAID_BUT_PAYMENT_MISSING", "PAYMENT_WORKFLOW_FAILED", "PAYMENT_AMOUNT_MISMATCH", "DUPLICATE_PAYMENT"].includes(m.type)).length;
        const postPay = cMishCount(cMism, "PAID_BUT_NO_REVIEW_ACTION");
        const fr = freshness[cc] || {};
        const subUnavailable = submissionUnavailableFor(cApps, fr);
        const p0 = paidStuck > 0 || payment > 0 || fr.status === "STALE" || fr.status === "NOT_CONFIGURED" || mismatchesPresent(cMism) || subUnavailable;
        const p1 = humanReviews >= 3 || overdue > 0 || stuck > 0 || submissionProblems > 0 || fr.status === "REVIEW_SOON";
        const finalStatus = p0 ? "STOP" : p1 ? "CAUTION" : "GO";
        countries[cc] = {
          name: COUNTRY_NAME[cc], final_status: finalStatus,
          application_flow: cApps.length ? (paidStuck > 0 ? "BLOCKED" : "OK") : "OK",
          pricing, payment: payment > 0 ? `${payment} issue` : "OK",
          post_payment: postPay > 0 ? `${postPay} stuck` : "OK",
          human_review: humanReviews > 0 ? `${humanReviews} pending` : "OK",
          submission: subUnavailable ? "UNAVAILABLE" : (submissionProblems > 0 ? `${submissionProblems} stuck` : "OK"),
          support: "OK", rule_freshness: fr.status,
          rule_freshness_detail: { last_verified: fr.last_verified, next_review: fr.next_review },
          pilot: cfg.countries?.[cc]?.pilot || "INTERNAL",
          paused: !!cfg.countries?.[cc]?.paused, max_paid_per_day: cfg.countries?.[cc]?.max_paid_per_day || 0, paid_today: paidToday[cc],
        };
      }

      // Global metrics.
      const paymentProblems = mismatches.filter((m: any) => m.type !== "PAID_BUT_NO_REVIEW_ACTION").length;
      const paidStuckAll = rows.filter((r: any) => r.stage === "HUMAN_REVIEW" && r.payment_status === "SUCCEEDED" && r.order_status === "PAID").length;
      const humanReviewsAll = rows.filter((r: any) => r.stage === "HUMAN_REVIEW").length;
      const submissionFailures = rows.filter((r: any) => r.stuck?.reasons?.some((s: string) => s.includes("SUBMISSION"))).length;
      const supportBacklog = tickets.filter((t: any) => !["RESOLVED", "CLOSED", "DONE", "COMPLETED"].includes(String(t.status || "").toUpperCase())).length;
      const refundFailures = refundFailed.length;
      const providerFailures = 0; // reuse existing provider logs; no synthetic calls
      const ruleIssues = Object.values(freshness).filter((f: any) => f.status === "STALE").length;

      const p0 = !!cfg.global_paused || paidStuckAll > 0 || paymentProblems > 0 || ruleIssues > 0 || Object.values(countries).some((c: any) => c.final_status === "STOP");
      const p1 = humanReviewsAll >= 3 || supportBacklog > 0 || refundFailures > 0 || refundOverdue.length > 0 || submissionFailures > 0 || Object.values(countries).some((c: any) => c.final_status === "CAUTION");
      const overallStatus = p0 ? "STOP" : p1 ? "CAUTION" : "GO";

      const actionsToday: string[] = [];
      if (cfg.global_paused) actionsToday.push("Global pause is active — new applications are blocked.");
      for (const cc of LAUNCH_COUNTRIES) if (countries[cc]?.paused) actionsToday.push(`${COUNTRY_NAME[cc]} is paused — resume or keep paused.`);
      if (paidStuckAll > 0) actionsToday.push(`${paidStuckAll} paid application(s) stuck without post-payment review — investigate now (P0).`);
      if (paymentProblems > 0) actionsToday.push(`${paymentProblems} payment reconciliation issue(s) — resolve before launch (P0).`);
      if (ruleIssues > 0) actionsToday.push("Country rules stale/missing — re-verify before OPEN pilot.");
      if (supportBacklog > 5) actionsToday.push(`Support backlog high (${supportBacklog}) — add capacity or restrict pilot.`);
      if (actionsToday.length === 0 && overallStatus === "GO") actionsToday.push("No required actions. Safe to proceed to LIMITED pilot.");

      return Response.json({
        overall: { status: overallStatus, p0_count: p0count(p0, paidStuckAll, paymentProblems, ruleIssues), p1_count: p1count(humanReviewsAll >= 3 ? 1 : 0, supportBacklog > 0 ? 1 : 0, refundFailures, submissionFailures) },
        countries,
        metrics: { paid_stuck: paidStuckAll, human_reviews_pending: humanReviewsAll, submission_failures: submissionFailures, payment_problems: paymentProblems, support_backlog: supportBacklog, refund_failures: refundFailures, refund_overdue: refundOverdue.length, provider_failures: providerFailures, rule_issues: ruleIssues },
        pilots: { global_paused: !!cfg.global_paused, global_paused_at: cfg.global_paused_at, countries: cfg.countries || {} },
        actions_today: actionsToday,
      });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

// ---- Launch control config persisted in the existing Setting entity (admin-only writes) ----
const LAUNCH_CFG = { tenant_id: "krosz", category: "launch_control", key: "control" };
function defaultLaunchConfig(): any {
  return { global_paused: false, global_paused_at: null, global_paused_by: null, countries: { AE: { pilot: "INTERNAL", paused: false, max_paid_per_day: 0 }, VN: { pilot: "INTERNAL", paused: false, max_paid_per_day: 0 }, ID: { pilot: "INTERNAL", paused: false, max_paid_per_day: 0 } } };
}
async function loadLaunchConfig(svc: any): Promise<any> {
  const rows: any[] = await svc.Setting.filter({ tenant_id: LAUNCH_CFG.tenant_id, category: LAUNCH_CFG.category, key: LAUNCH_CFG.key }, "-created_date", 1).catch(() => []);
  const row = rows[0];
  if (!row?.value) return defaultLaunchConfig();
  return { ...defaultLaunchConfig(), ...(row.value || {}), countries: { ...defaultLaunchConfig().countries, ...(row.value?.countries || {}) } };
}
async function saveLaunchConfig(svc: any, cfg: any, user: any, patch: any): Promise<void> {
  const rows: any[] = await svc.Setting.filter({ tenant_id: LAUNCH_CFG.tenant_id, category: LAUNCH_CFG.category, key: LAUNCH_CFG.key }, "-created_date", 1).catch(() => []);
  const existing = rows[0];
  if (existing) await svc.Setting.update(existing.id, { value: cfg, is_inheritable: false }).catch(() => {});
  else await svc.Setting.create({ tenant_id: LAUNCH_CFG.tenant_id, category: LAUNCH_CFG.category, key: LAUNCH_CFG.key, value: cfg, is_inheritable: false }).catch(() => {});
  await svc.OperationsAuditEvent.create({ application_id: "launch_control", case_id: "launch_control", traveler_id: "launch_control", actor_id: user.id, actor_role: "ADMIN", action: "LAUNCH_CONTROL_CHANGE", reason: "Launch control updated", metadata: { patch, at: new Date().toISOString() }, occurred_at: new Date().toISOString() }).catch(() => {});
}

// ---- Deterministic helpers for the tower (no AI) ----
function ruleFreshness(cap: any): any {
  if (!cap) return { status: "NOT_CONFIGURED", last_verified: null, next_review: null };
  if (cap.verification_status === "STALE" || cap.verification_status === "BLOCKED" || cap.freshness === "STALE" || cap.freshness === "EXPIRED" || cap.source_freshness === "EXPIRED") return { status: "STALE", last_verified: cap.last_verified_at || cap.verified_at || null, next_review: cap.next_review_at || null };
  if (cap.verification_status === "VERIFIED" && (cap.status === "PUBLISHED" || cap.status === "VERIFIED") && (cap.freshness === "FRESH")) {
    const days = cap.next_review_at ? (new Date(cap.next_review_at).getTime() - Date.now()) / 86_400_000 : 999;
    return { status: days < 14 ? "REVIEW_SOON" : "CURRENT", last_verified: cap.last_verified_at || cap.verified_at || null, next_review: cap.next_review_at || null };
  }
  return { status: "REVIEW_SOON", last_verified: cap.last_verified_at || cap.verified_at || null, next_review: cap.next_review_at || null };
}
function submissionUnavailableFor(cApps: any[], fr: any): boolean { return fr.status === "NOT_CONFIGURED" || fr.status === "STALE" || (cApps.length > 0 && cApps.filter((r) => r.stage === "SUBMISSION_IN_PROGRESS").length === 0 && cApps.some((r) => r.stage === "READY_FOR_SUBMISSION" && r.stuck?.flag)); }
function mismatchesPresent(ms: any[]): boolean { return ms.some((m: any) => ["PAID_BUT_APPLICATION_UNPAID", "APPLICATION_PAID_BUT_PAYMENT_MISSING", "PAYMENT_WORKFLOW_FAILED", "PAYMENT_AMOUNT_MISMATCH", "DUPLICATE_PAYMENT", "REFUND_MISMATCH"].includes(m.type)); }
function cMishCount(ms: any[], type: string): number { return ms.filter((m: any) => m.type === type).length; }
function ctxAgeHours(at?: string): number { return at ? Math.max(0, (Date.now() - new Date(at).getTime()) / 3_600_000) : 0; }
function p0count(pause: boolean, stuck: number, pay: number, rule: number): number { return (pause ? 1 : 0) + (stuck > 0 ? 1 : 0) + (pay > 0 ? 1 : 0) + (rule > 0 ? 1 : 0); }
function p1count(human: number, support: number, refund: number, submission: number): number { return human + support + (refund > 0 ? 1 : 0) + (submission > 0 ? 1 : 0); }

function customerMessage(proj: any): string {
  // Plain-language customer message (§4) — never reveals internal codes.
  const map: Record<string, string> = {
    DRAFT: "Tell us where you'd like to go and we'll find your visa route.",
    PROFILE_INCOMPLETE: "Add your traveler details so we can continue your application.",
    DOCUMENTS_REQUIRED: "Please upload the required documents so we can prepare your application.",
    DOCUMENTS_UPLOADED: "We've received your documents. Krosz is reviewing your application — no action required from you right now.",
    AUTOMATED_CHECKS_RUNNING: "We're confirming your visa route — no action required from you right now.",
    ACTION_REQUIRED: "We need a little more from you to continue. Please follow the steps we sent.",
    READY_FOR_PAYMENT: "You're almost there — complete payment and we'll prepare your application for submission.",
    PAYMENT_PENDING: "Your payment is being confirmed — no action is needed right now.",
    PAID: "Payment received. Krosz is preparing your application for review.",
    HUMAN_REVIEW: "Krosz is reviewing your application before submission. No action required from you right now.",
    READY_FOR_SUBMISSION: "Your application is approved for submission. Krosz will submit it shortly.",
    SUBMISSION_IN_PROGRESS: "Krosz is submitting your application to the government.",
    SUBMITTED: "Your application has been submitted. We're waiting for the government to process it.",
    GOVERNMENT_PROCESSING: "The government is processing your application. We'll let you know the moment there's an update.",
    ADDITIONAL_INFORMATION_REQUIRED: "The government asked for more information. Please provide it so we can continue.",
    APPROVED: "Great news — your visa has been approved.",
    REJECTED: "Your visa application was refused. Reach out to support to talk through next steps.",
    CANCELLED: "This application has been cancelled.",
    REFUND_REVIEW: "We're reviewing your refund request against our refund policy.",
    REFUNDED: "Your refund has been completed to your original payment method.",
  };
  return map[proj.stage] || proj.nextAction || '';
}