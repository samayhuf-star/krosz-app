// Worldz Visa (Phase 18) — Commercial event ledger.
//
// Pure recording layer for the financial audit trail (§27), commercial timeline
// events (§23), and orchestrator durable bus events (§31). Kept separate from
// the payments engine and the final-review engine so both can import it with no
// circular dependency: ledger → journey/events + bus only.

import { recordTimelineEvent } from "../journey/events.ts";
import { bus } from "../../events/bus.ts";

export type FinancialEventType =
  | "PRICE_CREATED" | "ORDER_CREATED" | "PAYMENT_INITIATED" | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED" | "REFUND_REQUESTED" | "REFUND_SUCCEEDED" | "REFUND_FAILED" | "PRICE_INVALIDATED";

/** Append an immutable financial audit row. Best-effort — never throws to the caller. */
export async function recordFinancialEvent(svc: any, app: any, type: FinancialEventType, detail: any = {}): Promise<any> {
  if (!app) return null;
  try {
    return await svc.entities.FinancialEvent.create({
      application_id: app.id,
      traveler_id: app.traveler_id,
      order_id: detail.order_id || null,
      payment_id: detail.payment_id || null,
      refund_id: detail.refund_id || null,
      event_type: type,
      amount_minor: Math.trunc(detail.amount_minor || 0),
      currency: detail.currency || null,
      metadata: detail.metadata || {},
    });
  } catch { return null; }
}

/** Record a customer-facing commercial timeline milestone (idempotent via event_id dedup). */
export async function commercialTimeline(svc: any, app: any, event_type: string, opts: { source_ref?: string; title?: string; description?: string; actor_type?: any; metadata?: any } = {}): Promise<any> {
  return await recordTimelineEvent(svc, app, { event_type, ...opts }).catch(() => null);
}

/** Best-effort orchestrator durable bus dispatch for commercial transitions (§31). */
export async function dispatchCommercial(type: any, payload: any, businessId?: string): Promise<void> {
  try { await bus.dispatch(type, { payload, businessId, actor: "system" }); } catch {}
}