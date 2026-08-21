// Worldz Visa (Phase 19) — tracking engine: raw→normalized status mapping,
// idempotent event creation (dedup), decision handling. Tracking is SEPARATE
// from the application status and from provider connectivity (§24):
// TRACKING_UNAVAILABLE never becomes APPLICATION_FAILED.

import { getTrackingAdapter, hasTrackingAdapter } from "./registry.ts";
import { fallbackNormalize } from "../operations/catalog.ts";
import { recordTimelineEvent } from "../journey/events.ts";

export function normalizeStatus(adapterKey: string | null | undefined, raw: string): string {
  if (adapterKey && hasTrackingAdapter(adapterKey)) {
    try { return getTrackingAdapter(adapterKey).normalizeStatus(raw); } catch {}
  }
  return fallbackNormalize(raw);
}

function dedupKey(application_id: string, normalized: string, raw: string, occurred_at: string): string {
  return `${application_id}|${normalized}|${raw || ""}|${occurred_at}`;
}

// Enter a tracking update for a submission/application. Idempotent by dedup_key
// (§23): an identical retried update collapses to the existing event and returns
// { duplicate: true }. Never throws on duplicate. Returns the event + a flag.
export async function enterTrackingUpdate(
  svc: any, ctx: { application_id: string; traveler_id: string; submission_id?: string },
  update: { raw_status: string; source: string; description?: string; provider_key?: string; occurred_at?: string },
): Promise<{ event: any | null; duplicate: boolean; normalized_status: string }> {
  const adapterKey = update.provider_key || null;
  const normalized = normalizeStatus(adapterKey, update.raw_status);
  const occurred_at = update.occurred_at || new Date().toISOString();
  const key = dedupKey(ctx.application_id, normalized, update.raw_status, occurred_at);
  const existing: any[] = await svc.entities.TrackingEvent.filter({ dedup_key: key }).catch(() => []);
  if (existing.length > 0) return { event: existing[0], duplicate: true, normalized_status: normalized };
  const event = await svc.entities.TrackingEvent.create({
    application_id: ctx.application_id, traveler_id: ctx.traveler_id, submission_id: ctx.submission_id,
    normalized_status: normalized, raw_status: update.raw_status, raw_provider: adapterKey || "",
    source: update.source, description: update.description || "", occurred_at, dedup_key: key, metadata: {},
  });
  return { event, duplicate: false, normalized_status: normalized };
}

export async function listTrackingEvents(svc: any, user: any, application_id: string): Promise<any[]> {
  const rows: any[] = await svc.entities.TrackingEvent.filter({ application_id }, "-occurred_at", 200).catch(() => []);
  return rows;
}

// Map a normalized tracking status to a case-state transition.
export function statusToCaseState(normalized: string): string | null {
  switch (normalized) {
    case "SUBMITTED": case "RECEIVED": case "PROCESSING":
    case "ADDITIONAL_INFORMATION_REQUIRED": case "APPOINTMENT_REQUIRED":
    case "BIOMETRICS_REQUIRED": case "PASSPORT_REQUESTED": case "DECISION_PENDING":
    case "TRACKING_UNAVAILABLE":
      return "PROCESSING";
    case "APPROVED": case "REFUSED": case "WITHDRAWN": case "CANCELLED":
      return "DECISION_RECEIVED";
    case "COMPLETED":
      return "COMPLETED";
    default: return "PROCESSING";
  }
}

export function isDecisionStatus(normalized: string): boolean {
  return ["APPROVED", "REFUSED", "WITHDRAWN", "CANCELLED"].includes(normalized);
}

// Record the tracking update as an INTERNAL timeline entry plus a customer-facing
// milestone only when meaningful (§25). Returns what happened for the caller to
// persist on OperationsCase.
export async function recordTrackingTimeline(svc: any, app: any, normalized: string, raw: string, occurred_at: string): Promise<void> {
  const meaningful = ["RECEIVED", "PROCESSING", "ADDITIONAL_INFORMATION_REQUIRED", "APPOINTMENT_REQUIRED", "BIOMETRICS_REQUIRED", "PASSPORT_REQUESTED", "APPROVED", "REFUSED"];
  const eventType = normalized === "APPROVED" ? "VISA_APPROVED"
    : normalized === "REFUSED" ? "VISA_REFUSED"
    : normalized === "ADDITIONAL_INFORMATION_REQUIRED" ? "ADDITIONAL_INFORMATION_REQUIRED"
    : normalized === "APPOINTMENT_REQUIRED" ? "APPOINTMENT_REQUIRED"
    : normalized === "PASSPORT_REQUESTED" ? "PASSPORT_SUBMITTED"
    : normalized === "PROCESSING" ? "APPLICATION_PROCESSING"
    : normalized === "RECEIVED" ? "APPLICATION_PROCESSING"
    : null;
  if (!eventType || !meaningful.includes(normalized)) return; // don't notify for every poll
  await recordTimelineEvent(svc, app, {
    event_type: eventType, source_ref: "tracking", actor_type: "PROVIDER",
    visibility: "CUSTOMER", metadata: { normalized_status: normalized, raw_status: raw, occurred_at },
  }).catch(() => {});
}