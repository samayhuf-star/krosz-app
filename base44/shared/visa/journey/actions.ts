// Worldz Visa — Phase 12: Application Action derivation + lifecycle (§10/§11/§15/§16).
// Actions are deterministically derived from real state; priority is a fixed
// ordering (§11), never LLM-decided. The same requirement never surfaces twice
// (dedup by action_key). Completing an action runs through domain events (§56)
// — callers record the timeline event and dispatch notifications.

import { ACTION_PRIORITY } from "./types.ts";

function actionKey(source: string, type: string, ref: string): string {
  return [source, type, ref].filter(Boolean).join(":");
}

// Derive the set of OPEN actions the traveler (or operator) must take right now.
// Reads the same JourneyContext the projection builds — no extra fetching.
export function deriveActions(app: any, ctx: any): any[] {
  const actions: any[] = [];
  const appLink = `/applications/${app?.id}`;

  // 1. SECURITY / VERIFICATION — human handoff from execution action requests.
  const handoffs: any[] = ctx?.humanHandoffs || [];
  for (const h of handoffs) {
    actions.push({
      action_key: actionKey("EXECUTION", "HUMAN_HANDOFF", h.id),
      type: "HUMAN_HANDOFF",
      title: h.title || "Action required to continue submission",
      description: h.reason || undefined,
      priority: "SECURITY_VERIFICATION",
      source: "PROVIDER",
      source_ref: h.id,
      cta_link: appLink,
    });
  }

  // 2. PAYMENT — only when the product's payment_gate is unsatisfied.
  if (ctx?.payment?.required && !ctx?.payment?.paid) {
    actions.push({
      action_key: actionKey("PAYMENT", "PAYMENT", ctx.payment.order_id || app.id),
      type: "PAYMENT",
      title: ctx.payment.title || "Complete payment",
      description: ctx.payment.description || `Pay ${ctx.payment.display || ""} to continue`.trim(),
      priority: "PAYMENT",
      source: "PAYMENT",
      source_ref: ctx.payment.order_id,
      cta_link: appLink,
      due_at: ctx.payment.due_at || undefined,
    });
  }

  // 3. MISSING REQUIRED DATA — blocking question/document requirements.
  const blockDocs: any[] = ctx?.readiness?.blocking_items || [];
  for (const b of blockDocs) {
    if (b.kind === "document") {
      actions.push({
        action_key: actionKey("DOCUMENT", "DOCUMENT", b.requirement_id || b.document_type),
        type: "DOCUMENT",
        title: `Upload ${b.label || b.document_type || "required document"}`,
        description: b.reason || undefined,
        priority: "MISSING_REQUIRED_DATA",
        source: "REQUIREMENT",
        source_ref: b.requirement_id || b.document_type,
        cta_link: `${appLink}/application`,
        due_at: b.due_at || undefined,
      });
    } else if (b.kind === "question") {
      actions.push({
        action_key: actionKey("QUESTION", "QUESTION", b.question_code),
        type: "QUESTION",
        title: `Answer: ${b.label || b.question_code}`,
        description: b.reason || undefined,
        priority: "MISSING_REQUIRED_DATA",
        source: "REQUIREMENT",
        source_ref: b.question_code,
        cta_link: `${appLink}/application`,
      });
    }
  }

  // 4. DOCUMENTS — unmet document requirements (only if none already blocking above).
  const reqs: any[] = ctx?.requirementProgress?.unmet || [];
  for (const r of reqs) {
    if (blockDocs.some((b) => (b.requirement_id || b.document_type) === (r.requirement_id || r.document_type))) continue;
    actions.push({
      action_key: actionKey("DOCUMENT", "DOCUMENT", r.requirement_id || r.document_type),
      type: "DOCUMENT",
      title: `Upload ${r.label || r.document_type || "document"}`,
      description: r.reason || undefined,
      priority: "DOCUMENTS",
      source: "REQUIREMENT",
      source_ref: r.requirement_id || r.document_type,
      cta_link: `${appLink}/application`,
    });
  }

  // 5. APPOINTMENT — required + not yet booked.
  if (ctx?.appointmentRequired && !ctx?.appointmentBooked) {
    actions.push({
      action_key: actionKey("APPOINTMENT", "APPOINTMENT", app.id),
      type: "APPOINTMENT",
      title: "Book your appointment",
      description: "Select a location and time for your biometrics/appointment.",
      priority: "APPOINTMENT",
      source: "APPOINTMENT",
      source_ref: app.id,
      cta_link: appLink,
    });
  }

  // 6. APPROVAL — application is at user_approval gate.
  if (app?.status === "user_approval") {
    actions.push({
      action_key: actionKey("APPROVAL", "APPROVAL", app.id),
      type: "APPROVAL",
      title: "Review & approve your application",
      description: "Confirm the application is ready so we can submit it.",
      priority: "APPROVAL",
      source: "ORCHESTRATOR",
      source_ref: app.run_id || app.id,
      cta_link: appLink,
    });
  }

  // Sort by fixed priority order.
  const rank: Record<string, number> = Object.fromEntries(ACTION_PRIORITY.map((p, i) => [p, i]));
  actions.sort((a, b) => (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99));
  return actions;
}

// Upsert derived actions: mark completed ones completed, persist new ones,
// dedup by action_key. Returns the visible OPEN actions for the journey.
export async function syncActions(svc: any, app: any, derived: any[]): Promise<any[]> {
  const traveler_id = app.traveler_id;
  const existing: any[] = await svc.entities.ApplicationAction.filter({ application_id: app.id, status: { $in: ["OPEN", "IN_PROGRESS"] } }).catch(() => []);
  const byKey = new Map(existing.map((a) => [a.action_key, a]));
  const seenKeys = new Set<string>();
  for (const d of derived) {
    seenKeys.add(d.action_key);
    const ex = byKey.get(d.action_key);
    if (ex) {
      // Update mutable display fields only (priority/status stay).
      const patch: any = {};
      if (ex.title !== d.title) patch.title = d.title;
      if (ex.description !== d.description) patch.description = d.description;
      if (ex.priority !== d.priority) patch.priority = d.priority;
      if (ex.cta_link !== d.cta_link) patch.cta_link = d.cta_link;
      if (Object.keys(patch).length) await svc.entities.ApplicationAction.update(ex.id, patch).catch(() => {});
    } else {
      await svc.entities.ApplicationAction.create({ application_id: app.id, traveler_id, status: "OPEN", metadata: {}, ...d }).catch(() => {});
    }
  }
  // Mark no-longer-derived actions completed (the underlying requirement was satisfied).
  for (const ex of existing) {
    if (!seenKeys.has(ex.action_key)) {
      await svc.entities.ApplicationAction.update(ex.id, { status: "COMPLETED", completed_at: new Date().toISOString() }).catch(() => {});
    }
  }
  // Return current OPEN actions sorted.
  const fresh: any[] = await svc.entities.ApplicationAction.filter({ application_id: app.id, status: "OPEN" }).catch(() => []);
  const rank: Record<string, number> = Object.fromEntries(ACTION_PRIORITY.map((p, i) => [p, i]));
  fresh.sort((a, b) => (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99));
  return fresh;
}

// Next action = highest-priority OPEN action (§10). Caller passes the freshly
// synced list so we don't re-fetch.
export function pickNextAction(actions: any[]): any | null {
  return actions.length ? actions[0] : null;
}