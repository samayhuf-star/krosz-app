// Krosz Phase 2 — Refund admin + payment dispute evidence pack.
// Admin-only backend function. Exposes:
//   list     — all refunds joined with order/application/customer for the admin center
//   review   — REQUESTED -> UNDER_REVIEW (human triage, no financial movement)
//   reject   — REQUESTED/UNDER_REVIEW -> REJECTED (records reviewer + reason, reverts order)
//   evidence — assembles a permitted, read-only evidence pack for a refund/order
//              from existing immutable records. Never fabricates or alters history.
// approve/execute remain on the existing visaApi (approve-refund / execute-refund).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { rejectRefund, startReviewRefund, listAllRefunds } from "../../shared/visa/payments/engine.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.id) return Response.json({ error: "Authentication required" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const svc = base44.asServiceRole;
    const action = body.action;

    if (action === "list") {
      const refunds: any[] = await listAllRefunds(svc, user);
      // Join order/application/customer for the admin table.
      const orderIds = Array.from(new Set(refunds.map((r) => r.order_id).filter(Boolean)));
      const appIds = Array.from(new Set(refunds.map((r) => r.application_id).filter(Boolean)));
      const orders = orderIds.length ? await svc.entities.Order.filter({ id: { $in: orderIds } }).catch(() => []) : [];
      const apps = appIds.length ? await svc.entities.VisaApplication.filter({ id: { $in: appIds } }).catch(() => []) : [];
      const oMap = Object.fromEntries(orders.map((o) => [o.id, o]));
      const aMap = Object.fromEntries(apps.map((a) => [a.id, a]));
      const rows = refunds.map((r) => ({
        id: r.id, status: r.status, eligibility: r.eligibility, eligibility_notes: r.eligibility_notes,
        type: r.type, amount_minor: r.amount_minor, currency: r.currency, reason: r.reason, reason_detail: r.reason_detail,
        reviewer: r.reviewer, reviewed_at: r.reviewed_at, policy_version: r.policy_version,
        application_stage: r.application_stage, submission_status: r.submission_status,
        created_date: r.created_date, completed_at: r.completed_at,
        order_number: oMap[r.order_id]?.order_number || null,
        application_destination: aMap[r.application_id]?.destination || null,
        application_case_state: aMap[r.application_id]?.case_state || aMap[r.application_id]?.status || null,
        total_minor: oMap[r.order_id]?.total_minor || null,
      }));
      return Response.json({ refunds: rows });
    }

    if (action === "review") {
      if (!body.refund_id) return Response.json({ error: "refund_id required" }, { status: 400 });
      try { return Response.json({ refund: await startReviewRefund(svc, user, body.refund_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
    }

    if (action === "reject") {
      if (!body.refund_id) return Response.json({ error: "refund_id required" }, { status: 400 });
      try { return Response.json(await rejectRefund(svc, user, body.refund_id, body.reason || "")); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
    }

    if (action === "evidence") {
      // Assemble a permitted, read-only evidence pack from existing immutable records.
      // No fabricated timestamps; no modification of historical evidence.
      const orderId = body.order_id;
      const refundId = body.refund_id;
      if (!orderId && !refundId) return Response.json({ error: "order_id or refund_id required" }, { status: 400 });
      const refunds: any[] = orderId ? await svc.entities.Refund.filter({ order_id: orderId }).catch(() => []) : await svc.entities.Refund.filter({ id: refundId }).catch(() => []);
      const order: any = orderId ? await svc.entities.Order.get(orderId).catch(() => null) : (await svc.entities.Order.get(refunds[0]?.order_id).catch(() => null));
      const items: any[] = order ? await svc.entities.OrderItem.filter({ order_id: order.id }).catch(() => []) : [];
      const payments: any[] = order ? await svc.entities.Payment.filter({ order_id: order.id }).catch(() => []) : [];
      const invoices: any[] = order ? await svc.entities.Invoice.filter({ order_id: order.id }).catch(() => []) : [];
      const receipts: any[] = order ? await svc.entities.Receipt.filter({ order_id: order.id }).catch(() => []) : [];
      const app: any = order?.application_id ? await svc.entities.VisaApplication.get(order.application_id).catch(() => null) : null;
      const timeline: any[] = app ? await svc.entities.ApplicationTimelineEvent.filter({ application_id: app.id }, "created_date", 200).catch(() => []) : [];
      const tickets: any[] = app ? await svc.entities.SupportTicket.filter({ application_id: app.id }).catch(() => []) : [];
      const policyRows: any[] = await svc.entities.PolicyVersion.filter({ policy_key: "refund-policy", is_current: true }, "-effective_from", 1).catch(() => []);
      const termsRows: any[] = await svc.entities.PolicyVersion.filter({ policy_key: "terms", is_current: true }, "-effective_from", 1).catch(() => []);
      const confirmations: any[] = app ? await svc.entities.ApplicationConfirmation.filter({ application_id: app.id }).catch(() => []) : [];
      const pack = {
        generated_at: new Date().toISOString(),
        order: order ? { order_number: order.order_number, status: order.status, currency: order.currency, total_minor: order.total_minor, price_snapshot: order.price_snapshot, created_date: order.created_date, paid_at: order.paid_at } : null,
        items: items.map((i) => ({ component_code: i.component_code, description: i.description, total_minor: i.total_minor, metadata: i.metadata })),
        payments: payments.map((p) => ({ status: p.status, amount_minor: p.amount_minor, provider_key: p.provider_key, paid_at: p.paid_at, created_date: p.created_date })),
        refunds: refunds.map((r) => ({ status: r.status, amount_minor: r.amount_minor, reason: r.reason, reason_detail: r.reason_detail, eligibility: r.eligibility, eligibility_notes: r.eligibility_notes, reviewer: r.reviewer, reviewed_at: r.reviewed_at, policy_version: r.policy_version, created_date: r.created_date, completed_at: r.completed_at })),
        application: app ? { destination: app.destination, purpose: app.purpose, case_state: app.case_state, status: app.status, created_date: app.created_date } : null,
        timeline: timeline.map((t) => ({ event_type: t.event_type, created_date: t.created_date, actor_type: t.actor_type, metadata: t.metadata })),
        support: tickets.map((t) => ({ ticket_number: t.ticket_number, category: t.category, status: t.status, created_date: t.created_date })),
        terms_version: termsRows[0]?.version || null,
        refund_policy_version: policyRows[0]?.version || null,
        confirmations: confirmations.map((c) => ({ application_version: c.application_version, accepted_at: c.created_date, terms_version: c.terms_version })),
        note: "Read-only evidence assembled from existing immutable records. No content has been created or modified.",
      };
      return Response.json({ pack });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e), code: e?.code }, { status: 500 });
  }
}