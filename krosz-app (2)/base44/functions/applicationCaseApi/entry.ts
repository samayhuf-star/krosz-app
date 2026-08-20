// Worldz Visa (Phase 27) \u2014 Application Case API.
// Focused backend for the application-case layer. All mutations go through the
// pure case engine (base44/shared/visa/application/caseEngine.ts). The frontend
// never mutates case state directly (\u00a716). Government visa truth is never
// modified here; cases consume the resolved Travel Entry result and pin a
// snapshot at creation. Provider credentials are never stored in entities (\u00a724).

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { resolveTravelEntry } from "../../shared/visa/entry/engine.ts";
import {
  createCase, createSnapshot, transitionCase, canAccessCase, normalizeProviderStatus,
  ingestProviderWebhook, deriveTimeline, submissionAllowed, assignOwner,
  requestReview, resolveReview, CASE_TRANSITIONS, canTransitionCase,
} from "../../shared/visa/application/caseEngine.ts";
import {
  CASE_STATE_LABEL, nextActionFor, wizardStepsForCase, activeStepForState, feeForCase,
  eligibilityForCase, requiredDocsForCase, requiresSubmissionStep,
} from "../../shared/visa/application/presentation.ts";
import {
  allowedTransitionsFor, adminPermissionsFor, deterministicPriorityFor,
  applyPriorityOverride, slaFor, exceptionsFor, snapshotDiffers, qualitySignals,
  auditFromEvents, redactPassport, redactEmail, redactPhone, reviewGatesFor,
  adminListRow, dashboardSummary,
} from "../../shared/visa/application/adminPresentation.ts";
import {
  persistCaseTransition, recordCaseEvent, loadCaseEvents, migrateAllLegacy,
  migrateLegacyApplication, transitionCaseToState, setApplicationLifecycle,
  timelineFromCaseEvents, makeTransitionEvent,
} from "../../shared/visa/application/caseStore.ts";
import { legacyStatusFromCaseState, currentStepFromCaseState, caseStateFromLegacyStatus } from "../../shared/visa/application/caseProjections.ts";
import { runRetention, recordConsent, latestConsent, RETENTION_DEFAULTS, redactForLog } from "../../shared/visa/security/pii.ts";
import {
  ensureTasksFromCaseEvent, backfillTasksFromEvents, claimTask, assignTask, releaseTask,
  transitionTaskStatus, completeTask, overridePriority, taskAction, bulkAction,
  createException, resolveException, listTasks, getTaskDetail, exportTasks,
} from "../../shared/visa/operations/taskStore.ts";
import { opsPermissions, TASK_STATUSES as _TS, QUEUES as _Q, PRIORITIES as _P, ACTIONS_FOR_TYPE, REQUIRED_RESOLUTIONS } from "../../shared/visa/operations/tasks.ts";
import { resolveRouteForCase, runExecution, providerHealthCheck, listExecutionAttempts, ingestProviderWebhook as ingestExecWebhook } from "../../shared/visa/execution/executionStore.ts";
import { createMockProviderAdapter } from "../../shared/visa/execution/adapterContract.ts";
import { ensureTravelerForUser } from "../../shared/visa/traveler.ts";
import { computeRequirementProgress } from "../../shared/visa/documents.ts";
import { isKroszMvpCountry } from "../../shared/visa/mvpPricing.ts";

function buildContext(caseView: any): any {
  const sa = submissionAllowed(caseView as any);
  const snap = caseView?.snapshot || {};
  return {
    state_label: CASE_STATE_LABEL[caseView.state as keyof typeof CASE_STATE_LABEL] || caseView.state,
    next_action: nextActionFor(caseView),
    steps: wizardStepsForCase(caseView),
    active_step: activeStepForState(caseView.state),
    fee: feeForCase(caseView),
    eligibility: eligibilityForCase(caseView),
    required_docs: requiredDocsForCase(caseView),
    submission_allowed: sa.ok,
    submission_reason: sa.reason,
    requires_submission_step: requiresSubmissionStep(caseView),
    // Versioned country-policy inputs consumed by the shared MVP engines. These
    // are projections only; no rule is invented when the capability lacks data.
    engine_policies: {
      passport: snap.passport_policy || null,
      photo: snap.photo_policy || null,
      arrival: snap.arrival_policy || null,
      travel: snap.travel_policy || null,
      supporting_visa: snap.supporting_visa_policy || null,
    },
  };
}

function sanitize(row: any): any {
  if (!row) return null;
  return { ...row, metadata: undefined };
}

// Minimal primary-provider resolution mirroring the Phase 26 router's submission
// gate (verified lifecycle + verified capability + our access + commercial auth),
// without importing the router module (bundling constraint for new functions).
function resolveProviderSnapshot(bindings: any[], providersByKey: Record<string, any>, entry: any): any {
  const sub = (bindings || []).find((b) => b.role === "submission" && (b.capability?.submission === "YES") && b.our_api_access === "YES" && b.our_commercial_authorized === "YES" && b.verification_status === "VERIFIED" && (b.status === "ACTIVE" || b.status === "VERIFIED"));
  if (sub) {
    const p = providersByKey[sub.provider_key];
    if (p && (p.provider_lifecycle === "PRODUCTION" || p.provider_lifecycle === "VERIFIED") && p.capability_verification?.submission === "VERIFIED") {
      return { provider_key: sub.provider_key, provider_verified: true, commercial_authorized: true, route_status: "AVAILABLE" };
    }
  }
  const ec = entry?.execution_capability || "GUIDANCE_ONLY";
  return { provider_key: null, provider_verified: false, commercial_authorized: false, route_status: ec === "END_TO_END" ? "PROVIDER_UNVERIFIED" : (ec === "GUIDANCE_ONLY" ? "GUIDANCE_ONLY" : "NO_PROVIDER") };
}

async function loadRoutingContext(svc: any, country_code: string, journey_type: string, nationality = "IN") {
  const caps = await svc.entities.CountryCapability.filter({ country_code, nationality, journey_type }, "-rule_version", 10).catch(() => []);
  const cap = caps[0] || null;
  const bindings = cap ? await svc.entities.CountryProviderBinding.filter({ country_code, journey_type: cap.journey_type }, "-fallback_order", 50).catch(() => []) : [];
  const keys: string[] = Array.from(new Set((bindings.map((b) => b.provider_key)).filter(Boolean) as string[]));
  const providersByKey: Record<string, any> = {};
  for (const k of keys) { const r = await svc.entities.Provider.filter({ key: k }).catch(() => []); if (r[0]) providersByKey[k] = { ...r[0], adapter_config: undefined }; }
  return { bindings, providersByKey };
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const svc = base44.asServiceRole;

    if (action === "application-case-create") {
      if (!body.destination) return Response.json({ error: "destination required" }, { status: 400 });
      if (!isKroszMvpCountry(body.destination)) return Response.json({ error: "This destination is coming soon on Krosz.", code: "COMING_SOON" }, { status: 409 });
      // Phase 5 launch gate (deterministic): global pause / per-country pause / daily
      // paid-application limit. NEVER affects existing applications — only new starts.
      const lc: any = await loadLaunchGate(svc);
      if (lc?.global_paused) return Response.json({ error: "New applications are temporarily paused by Krosz. Please try again shortly.", code: "LAUNCH_PAUSED" }, { status: 409 });
      const cCfg = lc?.countries?.[body.destination];
      if (cCfg?.paused) return Response.json({ error: `New ${body.destination} visa applications are temporarily paused by Krosz.`, code: "COUNTRY_PAUSED" }, { status: 409 });
      const maxPaidToday = Number(cCfg?.max_paid_per_day || 0);
      if (maxPaidToday > 0) {
        const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
        const paidOrders: any[] = await svc.entities.Order.filter({ status: "PAID" }, "-created_date", 500).catch(() : any[] => []);
        let today = 0;
        for (const o of paidOrders) {
          if (new Date(o.paid_at || o.created_date) < startToday) continue;
          const a: any = await svc.entities.VisaApplication.get(o.application_id).catch(() => null);
          if (a?.destination === body.destination) { today++; if (today >= maxPaidToday) break; }
        }
        if (today >= maxPaidToday) return Response.json({ error: `Daily limit for ${body.destination} applications has been reached. Please try again tomorrow.`, code: "LAUNCH_LIMIT" }, { status: 429 });
      }
      if (body.idempotency_key) {
        const recent: any[] = await svc.entities.VisaApplication.filter({ created_by_id: user.id }, "-created_date", 50).catch(() => []);
        const existing = recent.find((r: any) => (r.metadata || {}).idempotency_key === body.idempotency_key);
        if (existing) return Response.json({ case: sanitize(existing), resumed: true });
      }
      const traveler = body.traveler_id ? await svc.entities.Traveler.get(body.traveler_id).catch(() => null) : await ensureTravelerForUser(svc, user, { nationality: body.nationality || "IN" });
      if (!traveler) return Response.json({ error: "Traveler profile required" }, { status: 400 });
      const entry: any = await resolveTravelEntry(svc, { destination: body.destination, nationality: body.nationality, purpose: body.purpose, departure_country: body.departure_country, travel_dates: body.travel_dates, traveler_attributes: body.traveler_attributes });
      const { bindings, providersByKey } = await loadRoutingContext(svc, entry.input.destination, entry.journey_type, entry.input.nationality);
      const provider_snapshot = resolveProviderSnapshot(bindings, providersByKey, entry);
      const c = createCase({ entryResult: entry, traveler_id: traveler.id, user_id: user.id, provider_snapshot });
      // Create the customer-owned application through the authenticated client,
      // not the service-role client. Service-role creation stamps created_by_id
      // as the service principal, which makes the freshly-created case fail the
      // owner check on /wizard/:id and look like a 404/403 immediately after
      // "Start application".
      const row = await base44.entities.VisaApplication.create({
        traveler_id: c.traveler_id, destination: c.country, visa_type_key: c.journey, purpose: entry.input.purpose || "tourism",
        nationality: c.nationality, status: "draft", current_step: "eligibility",
        case_state: c.state, normalized_status: c.normalized_status, execution_capability: c.execution_capability,
        route_status: provider_snapshot.route_status, provider_key: provider_snapshot.provider_key, case_snapshot: c.snapshot,
        data_version: 1, eligibility_outcome: entry.ready_for_public ? "eligible" : "unknown",
        metadata: { events: c.events, provider_snapshot, idempotency_key: body.idempotency_key || null },
      }).catch(() => null);
      if (row) {
        await svc.entities.ApplicationTimelineEvent.create({ application_id: row.id, traveler_id: c.traveler_id, event_id: `${row.id}|APPLICATION_CREATED`, event_type: "APPLICATION_CREATED", visibility: "CUSTOMER", actor_type: "TRAVELER", title: "Application created", occurred_at: new Date().toISOString(), created_by: user.id }).catch(() => {});
        // Phase 31 \u00a77: durable CASE_CREATED event (owner = creator for traveler RLS).
        await recordCaseEvent(svc, { id: row.id, traveler_id: row.traveler_id, created_by_id: row.created_by_id, case_state: "DRAFT" }, { event_type: "CASE_CREATED", actor_type: "TRAVELER", actor_id: user.id, source: "traveler_wizard", idempotency_key: `create_${row.id}`, reason: "Case created" }).catch(() => {});
      }
      return Response.json({ case: sanitize(row), execution_capability: c.execution_capability, route_status: provider_snapshot.route_status });
    }

    if (action === "application-case-get") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const caseView: any = { id: row.id, user_id: row.created_by_id, traveler_id: row.traveler_id, country: row.destination, journey: row.visa_type_key, state: row.case_state, normalized_status: row.normalized_status || row.case_state, execution_capability: row.execution_capability, route_status: row.route_status, provider_key: row.provider_key, eligibility_outcome: row.eligibility_outcome, snapshot: row.case_snapshot, created_at: row.created_date, updated_at: row.updated_date, closed_at: row.closed_at };
      if (!canAccessCase(caseView, user)) return Response.json({ error: "Forbidden" }, { status: 403 });
      return Response.json({ case: sanitize(row), case_view: caseView });
    }

    if (action === "application-case-list") {
      const rows = await svc.entities.VisaApplication.filter({ created_by_id: user.id }, "-created_date", 100).catch(() => []);
      return Response.json({ cases: rows.map((r: any) => ({ id: r.id, destination: r.destination, journey: r.visa_type_key, state: r.case_state, normalized_status: r.normalized_status || r.case_state, execution_capability: r.execution_capability, route_status: r.route_status, created_at: r.created_date, closed_at: r.closed_at })) });
    }

    if (action === "application-case-transition") {
      if (!body.id || !body.to) return Response.json({ error: "id and to required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const caseView: any = { id: row.id, user_id: row.created_by_id, state: row.case_state, execution_capability: row.execution_capability, provider_snapshot: (row.metadata || {}).provider_snapshot, review_approved: (row.metadata || {}).review_approved, ownership: { traveler_owner: row.traveler_id } };
      if (!canAccessCase(caseView, user)) return Response.json({ error: "Forbidden" }, { status: 403 });
      if (body.to === "READY_FOR_SUBMISSION") {
        const progress = await computeRequirementProgress(svc, row).catch(() => ({ total: 0, pending: 1, items: [] }));
        const required = requiredDocsForCase({ snapshot: row.case_snapshot });
        const missing = (progress.items || []).filter((item: any) => item.mandatory_level === "mandatory" && item.state !== "verified");
        if ((required.length > 0 && progress.total === 0) || progress.pending > 0 || missing.length > 0) {
          return Response.json({ error: "Required documents must be uploaded, processed, and verified before submission readiness.", code: "DOCUMENTS_NOT_VERIFIED", progress }, { status: 409 });
        }
        const version = Number(row.application_version) || 1;
        const confirmations: any[] = await svc.entities.ApplicationConfirmation.filter({ application_id: row.id, application_version: version }).catch(() => []);
        if (!row.final_review?.confirmed_at || confirmations.length === 0) {
          return Response.json({ error: "Review and confirm the application before marking it ready for submission.", code: "CONFIRMATION_REQUIRED" }, { status: 409 });
        }
      }
      // Phase 31 \u00a77/\u00a717: durable transition \u2014 the ONE mutation path. Validates via
      // the case engine, persists CaseEvent, derives status from case_state (\u00a75).
      const r = await persistCaseTransition(svc, row, body.to, { actor_type: "TRAVELER", actor_id: user.id || user.email, source: body.source || "api", idempotency_key: body.idempotency_key, reason: body.reason });
      if (!r.ok) return Response.json({ error: r.error, code: r.code }, { status: 400 });
      const evt = r.event || makeTransitionEvent(row, body.to, { actor_id: user.id, source: "api" });
      await svc.entities.ApplicationTimelineEvent.create({ application_id: body.id, traveler_id: row.traveler_id, event_id: `${body.id}|${evt.event_type}|${evt.idempotency_key || Date.now()}`, event_type: evt.event_type, visibility: "CUSTOMER", actor_type: "TRAVELER", title: evt.event_type, description: body.reason || undefined, occurred_at: new Date().toISOString(), created_by: user.id }).catch(() => {});
      // Phase 32 §8: event-driven task generation (idempotent). The Case Engine produced
      // the event; the work-management layer reacts to it — it never owns case state.
      const evtForTask = { id: r.event?.id || null, idempotency_key: body.idempotency_key || null, event_type: evt.event_type, new_case_state: body.to, metadata: { source: "traveler" } };
      const tasksCreated = await ensureTasksFromCaseEvent(svc, r.case, evtForTask).catch(() => []);
      return Response.json({ case: sanitize(r.case), event: evt, idempotent: !!r.idempotent, tasks_created: tasksCreated.length });
    }

    if (action === "application-case-timeline") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      if (!canAccessCase({ id: row.id, user_id: row.created_by_id } as any, user)) return Response.json({ error: "Forbidden" }, { status: 403 });
      const events = await loadCaseEvents(svc, body.id, 100).catch(() => []);
      return Response.json({ timeline: timelineFromCaseEvents(events, (row.metadata?.events) || []), source: events.length ? "case_event" : "legacy_metadata" });
    }

    if (action === "application-case-webhook") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.id || !body.raw_status) return Response.json({ error: "id and raw_status required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      // Phase 31 \u00a718/\u00a723: durable, idempotent webhook event. Dedup by idempotency_key
      // on CaseEvent; provider status normalized; case transitions via the engine when the
      // normalized status maps to a terminal-ish state. Webhooks never directly mutate state.
      const idemKey = body.idempotency_key || `wh_${body.provider_request_id || body.raw_status}_${body.id}`;
      const existing: any[] = await svc.entities.CaseEvent.filter({ case_id: body.id, idempotency_key: idemKey }).catch(() : any[] => []);
      if (existing && existing.length) return Response.json({ dedup: true, normalized: normalizeProviderStatus(body.raw_status).normalized });
      const { normalized } = normalizeProviderStatus(body.raw_status);
      const webhookEvt = await recordCaseEvent(svc, row, { event_type: "PROVIDER_WEBHOOK", actor_type: "PROVIDER", actor_id: body.provider_key || "provider", source: "provider_webhook", idempotency_key: idemKey, correlation_id: body.provider_request_id || null, reason: `Provider status: ${body.raw_status}`, metadata: { raw: body.raw_status, normalized } });
      // If the provider says a decision, drive the case engine durably (\u00a718).
      let updated = row;
      if (["APPROVED", "REJECTED", "CANCELLED", "COMPLETED", "PROCESSING", "ADDITIONAL_INFORMATION_REQUIRED"].includes(normalized)) {
        const target = ((): any => {
          if (normalized === "APPROVED") return "APPROVED";
          if (normalized === "REJECTED") return "REJECTED";
          if (normalized === "CANCELLED") return "CANCELLED";
          if (normalized === "COMPLETED") return "COMPLETED";
          if (normalized === "PROCESSING") return "PROCESSING";
          return "ADDITIONAL_INFORMATION_REQUIRED";
        })();
        const t = await transitionCaseToState(svc, row, target, { actor_type: "PROVIDER", actor_id: body.provider_key || "provider", source: "provider_webhook", idempotency_key: `whtrans_${idemKey}`, reason: `Provider webhook: ${body.raw_status}` }).catch(() => null);
        if (t?.ok && t.case) { updated = t.case; await svc.entities.ApplicationTimelineEvent.create({ application_id: body.id, traveler_id: row.traveler_id, event_id: `${body.id}|${target}|${idemKey}`, event_type: target, visibility: "CUSTOMER", actor_type: "PROVIDER", title: target, description: `Provider: ${body.raw_status}`, occurred_at: new Date().toISOString(), created_by: "system" }).catch(() => {}); }
        else { updated = await svc.entities.VisaApplication.update(body.id, { normalized_status: normalized, updated_date: new Date().toISOString() }).catch(() => row); }
      } else {
        updated = await svc.entities.VisaApplication.update(body.id, { normalized_status: normalized, updated_date: new Date().toISOString() }).catch(() => row);
      }
      return Response.json({ case: sanitize(updated), normalized, dedup: false, event: webhookEvt?.event });
    }

    if (action === "application-case-save-progress") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      if (!canAccessCase({ id: row.id, user_id: row.created_by_id } as any, user)) return Response.json({ error: "Forbidden" }, { status: 403 });
      if (["REJECTED", "CANCELLED", "EXPIRED", "COMPLETED"].includes(row.case_state)) return Response.json({ error: "Case is terminal" }, { status: 400 });
      const prevWizard = (row.metadata || {}).wizard || {};
      const patch: any = {
        metadata: {
          ...(row.metadata || {}),
          idempotency_key: (row.metadata || {}).idempotency_key || body.idempotency_key || null,
          wizard: {
            step_index: typeof body.step_index === "number" ? body.step_index : (prevWizard.step_index || 0),
            form: body.form ?? (prevWizard.form || {}),
            saved_at: new Date().toISOString(),
          },
        },
        data_version: (row.data_version || 1) + 1,
      };
      const travel = body.form?.travel || {};
      if (travel.departure) {
        const refreshed: any = await resolveTravelEntry(svc, {
          destination: row.destination, nationality: row.nationality, purpose: row.purpose,
          travel_dates: { departure: travel.departure, return: travel.return || null },
        }).catch(() => null);
        if (refreshed) {
          // Rebuild the presentation snapshot in the Case Engine's canonical
          // shape. The previous object-spread mixed TravelEntryResult fields
          // (journey_type/documents/fees) into a CaseSnapshot
          // (journey/document_requirements/fee), leaving stale eligibility,
          // documents and fees visible after an autopilot refresh.
          patch.case_snapshot = { ...createSnapshot(refreshed), autopilot_refreshed_at: new Date().toISOString() };
          patch.eligibility_outcome = refreshed.ready_for_public ? "eligible" : (refreshed.outcome || "requires_review");
          patch.travel_start = travel.departure;
          patch.travel_end = travel.return || null;
        }
      }
      const updated = await svc.entities.VisaApplication.update(body.id, patch).catch(() => null);
      return Response.json({ saved: true, case: sanitize(updated), eligibility_refreshed: !!travel.departure });
    }

    if (action === "application-case-context") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      let row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });

      // Self-heal pre-submission cases created by older builds. Those builds
      // mixed the discovery/dev-seed payload into the case snapshot and could
      // leave stale eligibility, zero documents and whole-unit fees behind.
      // Re-resolve through the ONE Travel Entry Engine, preserve the original
      // creation snapshot for audit, and refresh only while no submission has
      // occurred. Submitted/terminal cases remain historically immutable.
      const refreshableStates = new Set(["DRAFT", "INTAKE", "ELIGIBILITY_REVIEW", "DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW"]);
      if (refreshableStates.has(row.case_state)) {
        const refreshed: any = await resolveTravelEntry(svc, {
          destination: row.destination,
          nationality: row.nationality,
          purpose: row.purpose,
          travel_dates: { departure: row.travel_start || undefined, return: row.travel_end || undefined },
        }).catch(() => null);
        if (refreshed) {
          const freshSnapshot: any = { ...createSnapshot(refreshed), revalidated_at: new Date().toISOString() };
          const oldMaterial = JSON.stringify({ eligibility: row.case_snapshot?.eligibility, documents: row.case_snapshot?.document_requirements, fee: row.case_snapshot?.fee, source: row.case_snapshot?.official_source, journey: row.case_snapshot?.journey });
          const newMaterial = JSON.stringify({ eligibility: freshSnapshot.eligibility, documents: freshSnapshot.document_requirements, fee: freshSnapshot.fee, source: freshSnapshot.official_source, journey: freshSnapshot.journey });
          if (oldMaterial !== newMaterial) {
            row = await svc.entities.VisaApplication.update(row.id, {
              case_snapshot: freshSnapshot,
              eligibility_outcome: refreshed.ready_for_public ? "eligible" : (refreshed.outcome || "requires_review"),
              data_version: (row.data_version || 1) + 1,
              metadata: {
                ...(row.metadata || {}),
                original_case_snapshot: (row.metadata || {}).original_case_snapshot || row.case_snapshot || null,
                operational_snapshot_revalidated_at: new Date().toISOString(),
              },
            }).catch(() => row);
          }
        }
      }
      const caseView: any = {
        id: row.id, user_id: row.created_by_id, traveler_id: row.traveler_id,
        country: row.destination, journey: row.visa_type_key, nationality: row.nationality,
        state: row.case_state, normalized_status: row.normalized_status || row.case_state,
        execution_capability: row.execution_capability, route_status: row.route_status,
        provider_key: row.provider_key, snapshot: row.case_snapshot,
        provider_snapshot: (row.metadata || {}).provider_snapshot,
        review_approved: (row.metadata || {}).review_approved,
        ownership: { traveler_owner: row.traveler_id },
        events: (row.metadata || {}).events || [],
        wizard: (row.metadata || {}).wizard || {},
      };
      if (!canAccessCase(caseView, user)) return Response.json({ error: "Forbidden" }, { status: 403 });
      return Response.json({ case: sanitize(row), case_view: caseView, ...buildContext(caseView) });
    }

    // ===================== PHASE 29 ADMIN CASE MANAGEMENT =====================
    // All mutations go through the Phase 27 case engine (transitionCase /
    // requestReview / resolveReview / assignOwner). The admin UI never mutates
    // case_state/execution_capability directly (§16/§26).
    if (action === "admin-case-list" || action === "admin-case-detail" || action === "admin-case-allowed-transitions"
      || action === "admin-case-transition" || action === "admin-case-assign" || action === "admin-review-decision"
      || action === "admin-document-decision" || action === "admin-internal-note-create" || action === "admin-internal-note-list"
      || action === "admin-exception-update" || action === "admin-exception-list" || action === "admin-case-priority-set"
      || action === "admin-timeline" || action === "admin-audit-log" || action === "admin-export") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
    }

    if (action === "admin-case-list") {
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
      const offset = Math.max(Number(body.offset) || 0, 0);
      const q: any = {};
      const f = body.filters || {};
      if (f.case_state) q.case_state = f.case_state;
      if (f.normalized_status) q.normalized_status = f.normalized_status;
      if (f.destination) q.destination = f.destination;
      if (f.journey) q.visa_type_key = f.journey;
      if (f.nationality) q.nationality = f.nationality;
      if (f.execution_capability) q.execution_capability = f.execution_capability;
      if (f.provider) q.provider_key = f.provider;
      if (f.owner) q.ops_owner_id = f.owner;
      if (f.unassigned) q.ops_owner_id = null;
      if (f.ops_priority) q.ops_priority = f.ops_priority;
      if (f.created_from || f.created_to) {
        q.created_date = {};
        if (f.created_from) (q.created_date as any).$gte = f.created_from;
        if (f.created_to) (q.created_date as any).$lte = f.created_to;
      }
      if (f.updated_from || f.updated_to) {
        q.updated_date = {};
        if (f.updated_from) (q.updated_date as any).$gte = f.updated_from;
        if (f.updated_to) (q.updated_date as any).$lte = f.updated_to;
      }
      let travelerIds: string[] | null = null;
      if (f.search) {
        const s = String(f.search).trim().toLowerCase();
        const byId = await svc.entities.VisaApplication.get(f.search).catch(() => null);
        if (byId) return Response.json({ cases: [adminListRow(byId)], total: 1, summary: dashboardSummary([byId]) });
        const travelers: any[] = await svc.entities.Traveler.filter({}, "-created_date", 200).catch(() => []);
        travelerIds = travelers.filter((t: any) => ((t.email || "").toLowerCase()).includes(s) || ((t.first_name + " " + (t.last_name || "")).toLowerCase()).includes(s)).map((t: any) => t.id);
        if (travelerIds.length === 0) return Response.json({ cases: [], total: 0, summary: dashboardSummary([]) });
        q.traveler_id = { $in: travelerIds };
      }
      const fetchLimit = offset + limit;
      const rows: any[] = await svc.entities.VisaApplication.filter(Object.keys(q).length ? q : {}, "-updated_date", fetchLimit).catch(() => []);
      let page = rows;
      // Derived filters (review/payment/document status, action_required, blocked, overdue) applied on the bounded page.
      const now = new Date().toISOString();
      if (f.review_status || f.payment_status || f.document_status || f.action_required || f.blocked || f.overdue) {
        page = rows.filter((r: any) => {
          const cv: any = { state: r.case_state, execution_capability: r.execution_capability, snapshot: r.case_snapshot, created_at: r.created_date, paid_at: r.paid_at };
          const gates = reviewGatesFor(cv);
          const hasOpenGate = gates.some((g: any) => g.status === "OPEN");
          if (f.review_status === "open" && !hasOpenGate) return false;
          if (f.review_status === "approved" && !(r.case_state === "READY_FOR_SUBMISSION")) return false;
          if (f.review_status === "none" && hasOpenGate) return false;
          if (f.payment_status === "paid" && !r.paid_at) return false;
          if (f.payment_status === "pending" && r.paid_at) return false;
          if (f.payment_status === "none" && r.paid_at) return false;
          if (f.action_required && !(r.case_state === "REVIEW_REQUIRED" || r.case_state === "ADDITIONAL_INFORMATION_REQUIRED")) return false;
          if (f.blocked && r.case_state !== "REVIEW_REQUIRED") return false;
          if (f.overdue) {
            const sla = slaFor(cv, { now });
            if (!sla.overdue) return false;
          }
          return true;
        });
      }
      const paged = page.slice(offset, offset + limit);
      const summaryRows = rows.slice(0, 1000);
      return Response.json({ cases: paged.map(adminListRow), total: page.length, summary: dashboardSummary(summaryRows) });
    }

    if (action === "admin-case-detail") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const snap = row.case_snapshot || {};
      const caseEventsDetail: any[] = await loadCaseEvents(svc, body.id, 200).catch(() : any[] => []);
      const mappedEvents = caseEventsDetail.length
        ? caseEventsDetail.map((e: any) => ({ id: e.id, actor: e.actor_id, event_type: e.event_type, occurred_at: e.created_date, from_state: e.previous_case_state, to_state: e.new_case_state, reason: e.reason, source: e.source, idempotency_key: e.idempotency_key }))
        : ((row.metadata || {}).events || []);
      const cv: any = { id: row.id, user_id: row.created_by_id, traveler_id: row.traveler_id, country: row.destination, journey: row.visa_type_key, nationality: row.nationality, state: row.case_state, normalized_status: row.normalized_status || row.case_state, execution_capability: row.execution_capability, route_status: row.route_status, provider_key: row.provider_key, snapshot: snap, provider_snapshot: (row.metadata || {}).provider_snapshot, review_approved: (row.metadata || {}).review_approved, review: (row.metadata || {}).review, ownership: { traveler_owner: row.traveler_id, operations_owner: row.ops_owner_id }, events: mappedEvents, created_at: row.created_date, updated_at: row.updated_date, closed_at: row.closed_at, ops_owner_id: row.ops_owner_id, ops_priority: row.ops_priority, ops_expected_duration_days: row.ops_expected_duration_days };
      const traveler: any = await svc.entities.Traveler.get(row.traveler_id).catch(() => null) || await svc.entities.Traveler.filter({ id: row.traveler_id }).catch(() => []).then((r: any) => r[0]) || null;
      const docs: any[] = await svc.entities.ApplicationDocument.filter({ application_id: body.id }, "-created_date", 100).catch(() => []);
      const orders: any[] = await svc.entities.Order.filter({ application_id: body.id } as any, "-created_date", 20).catch(() => []);
      // Current catalog for snapshot-drift (§9)
      let currentCatalog: any = null;
      try {
        const caps = await svc.entities.CountryCapability.filter({ country_code: row.destination, nationality: row.nationality, journey_type: row.visa_type_key }, "-rule_version", 1);
        if (caps[0]) currentCatalog = { journey: caps[0].journey_type, verification_status: caps[0].verification_status, execution_capability: caps[0].execution_capability, fee: caps[0].fee_government_minor != null ? { government_minor: caps[0].fee_government_minor } : null };
      } catch {}
      const provider = row.provider_key ? await svc.entities.Provider.filter({ key: row.provider_key }).catch(() => []).then((r: any) => r[0] || null) : null;
      const notes: any[] = await svc.entities.InternalNote.filter({ application_id: body.id }, "-created_date", 100).catch(() => []);
      const exceptions: any[] = await svc.entities.CaseException.filter({ case_id: body.id }, "-created_date", 100).catch(() => []);
      const auditRows: any[] = await svc.entities.OperationsAuditEvent.filter({ application_id: body.id }, "-occurred_at", 200).catch(() => []);
      const drift = snapshotDiffers(cv, currentCatalog);
      const signals = exceptionsFor(cv, { docs_attached: docs.length, current_catalog: currentCatalog });
      const quality = qualitySignals(cv, { docs_attached: docs.length, current_catalog: currentCatalog, overdue: slaFor(cv, { now: new Date().toISOString() }).overdue });
      const na = nextActionFor(cv);
      const allowed = allowedTransitionsFor(cv);
      const gates = reviewGatesFor(cv);
      const sla = slaFor(cv, { now: new Date().toISOString() });
      const permissions = adminPermissionsFor(user.role);
      const redactedTraveler = traveler ? { id: traveler.id, first_name: traveler.first_name, last_name: traveler.last_name, email: redactEmail(traveler.email), phone: redactPhone(traveler.phone), nationality: traveler.nationality, residence_country: traveler.residence_country, date_of_birth: traveler.date_of_birth, relationship: traveler.relationship, is_primary: traveler.is_primary, passport_number: redactPassport((traveler.metadata || {}).passport_number || (row.metadata || {}).passport_number), address_country: traveler.address_country } : null;
      const payment = orders[0] ? { order_id: orders[0].id, status: orders[0].status, total_minor: orders[0].total_minor, currency: orders[0].currency, paid_at: row.paid_at || orders[0].paid_at } : { paid_at: row.paid_at || null, status: row.paid_at ? "paid" : "none" };
      return Response.json({
        case: sanitize(row),
        case_view: cv,
        traveler: redactedTraveler,
        documents: docs.map((d: any) => ({ id: d.id, document_type: d.document_type, status: d.status, requirement_id: d.requirement_id, is_required: d.is_required, submitted_at: d.submitted_at, verified_at: d.verified_at })),
        payment,
        provider: provider ? { key: provider.key, name: provider.name, provider_lifecycle: provider.provider_lifecycle, capability_verification: provider.capability_verification, our_api_access: provider.our_api_access, our_commercial_authorized: provider.our_commercial_authorized, commercial_model: provider.commercial_model, documentation_url: provider.documentation_url } : null,
        provider_binding: (row.metadata || {}).provider_snapshot || null,
        current_catalog: currentCatalog,
        snapshot_drift: drift,
        exceptions: signals,
        persisted_exceptions: exceptions,
        quality_signals: quality,
        review_gates: gates,
        allowed_transitions: allowed,
        next_action: na,
        sla,
        notes: notes.map((n: any) => ({ id: n.id, author_name: n.author_name, body: n.body, pinned: n.pinned, created_at: n.created_date, category: (n.metadata || {}).category || "GENERAL" })),
        audit: auditFromEvents(cv.events).concat(auditRows.map((a: any) => ({ actor: a.actor_id, action: a.action, occurred_at: a.occurred_at, previous_state: a.previous_state, new_state: a.new_state, reason: a.reason, source: "ops_audit", idempotency_key: null }))),
        permissions,
      });
    }

    if (action === "admin-case-allowed-transitions") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const cv: any = { state: row.case_state, execution_capability: row.execution_capability, snapshot: row.case_snapshot, provider_snapshot: (row.metadata || {}).provider_snapshot, review_approved: (row.metadata || {}).review_approved };
      return Response.json({ allowed: allowedTransitionsFor(cv), current: row.case_state });
    }

    if (action === "admin-case-transition") {
      if (!body.id || !body.to) return Response.json({ error: "id and to required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const cv: any = { id: row.id, state: row.case_state, execution_capability: row.execution_capability, provider_snapshot: (row.metadata || {}).provider_snapshot, review_approved: (row.metadata || {}).review_approved, ownership: { traveler_owner: row.traveler_id } };
      if (!canTransitionCase(cv.state, body.to)) {
        await writeAudit(svc, { application_id: body.id, case_id: body.id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "FLAG_ISSUE", previous_state: row.case_state, new_state: body.to, reason: body.reason || "Invalid transition attempted", metadata: { blocked: true } });
        return Response.json({ error: `Invalid transition ${cv.state} -> ${body.to}`, code: "BAD_TRANSITION" }, { status: 400 });
      }
      // Phase 31 \u00a77: durable admin transition via the same single mutation path.
      const r = await persistCaseTransition(svc, row, body.to, { actor_type: "OPERATOR", actor_id: user.id || user.email, source: "admin", idempotency_key: body.idempotency_key, reason: body.reason });
      if (!r.ok) {
        await writeAudit(svc, { application_id: body.id, case_id: body.id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "FLAG_ISSUE", previous_state: row.case_state, new_state: body.to, reason: body.reason || "Invalid transition attempted", metadata: { blocked: true } });
        return Response.json({ error: r.error, code: r.code }, { status: 400 });
      }
      const evt = r.event || makeTransitionEvent(row, body.to, { actor_id: user.id, source: "admin" });
      await writeAudit(svc, { application_id: body.id, case_id: body.id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: aForTransition(body.to), previous_state: row.case_state, new_state: body.to, reason: body.reason, metadata: { idempotency_key: body.idempotency_key || null } });
      await svc.entities.ApplicationTimelineEvent.create({ application_id: body.id, traveler_id: row.traveler_id, event_id: `${body.id}|${evt.event_type}|${evt.idempotency_key || Date.now()}`, event_type: evt.event_type as any, visibility: "OPERATOR", actor_type: "OPERATOR", title: evt.event_type, description: body.reason || undefined, occurred_at: new Date().toISOString(), created_by: user.id }).catch(() => {});
      // Phase 32 §8: event-driven task generation for admin transitions too (idempotent).
      const evtForTask = { id: r.event?.id || null, idempotency_key: body.idempotency_key || null, event_type: evt.event_type, new_case_state: body.to, metadata: { source: "admin" } };
      const tasksCreated = await ensureTasksFromCaseEvent(svc, r.case, evtForTask).catch(() => []);
      return Response.json({ case: sanitize(r.case), event: evt, idempotent: !!r.idempotent, tasks_created: tasksCreated.length });
    }

    if (action === "admin-case-assign") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const role = body.role === "reviewer" ? "reviewer" : "operations_owner";
      const assignee = body.assignee || (body.assign_to_me ? user.id : null);
      if (!assignee) return Response.json({ error: "assignee required" }, { status: 400 });
      const prev = row.ops_owner_id || null;
      const patch: any = role === "operations_owner" ? { ops_owner_id: assignee } : {};
      // Record assignment in metadata.events via assignOwner for the audit trail.
      const evtCv: any = { id: row.id, state: row.case_state, events: (row.metadata || {}).events || [], ownership: { traveler_owner: row.traveler_id, operations_owner: row.ops_owner_id } };
      const next = assignOwner(evtCv as any, role as any, assignee, user.id);
      patch.metadata = { ...(row.metadata || {}), events: next.events, ownership: next.ownership };
      const updated = await svc.entities.VisaApplication.update(body.id, patch).catch(() => null);
      await writeAudit(svc, { application_id: body.id, case_id: body.id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "ASSIGNED", previous_state: prev, new_state: assignee, reason: body.reason || `Assigned ${role}`, metadata: { role, assignee, previous_owner: prev } });
      return Response.json({ case: sanitize(updated), assigned: assignee, previous_owner: prev });
    }

    if (action === "admin-review-decision") {
      if (!body.id || !body.decision) return Response.json({ error: "id and decision required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const cv: any = { id: row.id, state: row.case_state, execution_capability: row.execution_capability, review: (row.metadata || {}).review, review_approved: (row.metadata || {}).review_approved, ownership: { traveler_owner: row.traveler_id }, events: (row.metadata || {}).events || [] };
      let next: any = cv;
      if (body.gate_type && (!cv.review || cv.review.gate_type !== body.gate_type)) {
        next = requestReview(cv as any, body.gate_type, user.id, body.assigned_to);
      }
      const decision = body.decision === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : body.decision === "REJECTED" ? "REJECTED" : "APPROVED";
      next = resolveReview(next as any, decision as any, user.id, body.notes);
      const patch: any = { metadata: { ...(row.metadata || {}), events: next.events, review: next.review, review_approved: !!next.review_approved } };
      if (next.state && next.state !== row.case_state && canTransitionCase(row.case_state, next.state)) { patch.case_state = next.state; patch.normalized_status = next.state; patch.data_version = (row.data_version || 1) + 1; }
      const updated = await svc.entities.VisaApplication.update(body.id, patch).catch(() => null);
      await writeAudit(svc, { application_id: body.id, case_id: body.id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: decision === "APPROVED" ? "APPROVE_FOR_SUBMISSION" : "FLAG_ISSUE", previous_state: row.case_state, new_state: next.state || row.case_state, reason: body.notes || `Review ${decision}`, metadata: { gate_type: body.gate_type, decision } });
      await svc.entities.ApplicationTimelineEvent.create({ application_id: body.id, traveler_id: row.traveler_id, event_id: `${body.id}|REVIEW_${decision}|${Date.now()}`, event_type: decision === "APPROVED" ? "REVIEW_APPROVED" : "REVIEW_REJECTED", visibility: "OPERATOR", actor_type: "OPERATOR", title: `Review ${decision.toLowerCase()}`, description: body.notes || undefined, occurred_at: new Date().toISOString(), created_by: user.id }).catch(() => {});
      return Response.json({ case: sanitize(updated), review: next.review, review_approved: !!next.review_approved });
    }

    if (action === "admin-document-decision") {
      if (!body.document_id || !body.decision) return Response.json({ error: "document_id and decision required" }, { status: 400 });
      const doc: any = await svc.entities.ApplicationDocument.get(body.document_id).catch(() => null);
      if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });
      const statusMap: any = { approved: "verified", rejected: "rejected", replacement_requested: "rejected", request_additional: "attached" };
      const status = statusMap[body.decision] || doc.status;
      const patch: any = { status, verified_at: body.decision === "approved" ? new Date().toISOString() : doc.verified_at, metadata: { ...(doc.metadata || {}), admin_decision: body.decision, admin_id: user.id, reason: body.reason, at: new Date().toISOString() } };
      const updated = await svc.entities.ApplicationDocument.update(body.document_id, patch).catch(() => null);
      const row: any = await svc.entities.VisaApplication.get(doc.application_id).catch(() => null);
      if (row) {
        await writeAudit(svc, { application_id: doc.application_id, case_id: doc.application_id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "REVIEW_STARTED", previous_state: doc.status, new_state: status, reason: body.reason || `Document ${body.decision}`, metadata: { document_id: body.document_id, document_type: doc.document_type, decision: body.decision } });
        await svc.entities.ApplicationTimelineEvent.create({ application_id: doc.application_id, traveler_id: row.traveler_id, event_id: `${doc.application_id}|DOC_${body.decision}|${body.document_id}`, event_type: body.decision === "approved" ? "DOCUMENTS_COMPLETED" : "DOCUMENTS_STARTED", visibility: "OPERATOR", actor_type: "OPERATOR", title: `Document ${body.decision}`, description: body.reason || doc.document_type, occurred_at: new Date().toISOString(), created_by: user.id }).catch(() => {});
      }
      return Response.json({ document: updated });
    }

    if (action === "admin-internal-note-create") {
      if (!body.application_id || !body.body) return Response.json({ error: "application_id and body required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.application_id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const note = await svc.entities.InternalNote.create({ application_id: body.application_id, author_id: user.id, author_name: user.full_name || user.email, body: body.body, pinned: !!body.pinned, metadata: { category: body.category || "GENERAL" } }).catch(() => null);
      await writeAudit(svc, { application_id: body.application_id, case_id: body.application_id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "FLAG_ISSUE", previous_state: null, new_state: null, reason: `Internal note (${body.category || "GENERAL"})`, metadata: { note_id: note?.id } });
      return Response.json({ note });
    }
    if (action === "admin-internal-note-list") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const notes: any[] = await svc.entities.InternalNote.filter({ application_id: body.id }, "-created_date", 100).catch(() => []);
      return Response.json({ notes: notes.map((n: any) => ({ id: n.id, author_name: n.author_name, body: n.body, pinned: n.pinned, created_at: n.created_date, category: (n.metadata || {}).category || "GENERAL" })) });
    }

    if (action === "admin-exception-update") {
      if (!body.exception_id) return Response.json({ error: "exception_id required" }, { status: 400 });
      const ex: any = await svc.entities.CaseException.get(body.exception_id).catch(() => null);
      if (!ex) return Response.json({ error: "Exception not found" }, { status: 404 });
      const patch: any = {};
      if (body.status) patch.status = body.status;
      if (body.owner_id) patch.owner_id = body.owner_id;
      if (body.resolution) patch.resolution = body.resolution;
      if (body.status === "RESOLVED" || body.status === "DISMISSED") patch.resolved_at = new Date().toISOString();
      const updated = await svc.entities.CaseException.update(body.exception_id, patch).catch(() => null);
      const row: any = await svc.entities.VisaApplication.get(ex.case_id).catch(() => null);
      if (row) await writeAudit(svc, { application_id: ex.case_id, case_id: ex.case_id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "FLAG_ISSUE", previous_state: ex.status, new_state: body.status || ex.status, reason: body.resolution || "Exception updated", metadata: { exception_id: body.exception_id, type: ex.type } });
      return Response.json({ exception: updated });
    }
    if (action === "admin-exception-list") {
      const q: any = {};
      if (body.status) q.status = body.status;
      if (body.case_id) q.case_id = body.case_id;
      const rows: any[] = await svc.entities.CaseException.filter(q, "-created_date", 200).catch(() => []);
      return Response.json({ exceptions: rows });
    }

    if (action === "admin-case-priority-set") {
      if (!body.id || !body.priority) return Response.json({ error: "id and priority required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const cv: any = { state: row.case_state, execution_capability: row.execution_capability, snapshot: row.case_snapshot, created_at: row.created_date };
      const base = deterministicPriorityFor(cv);
      const { priority, overridden } = applyPriorityOverride(base, body.priority, body.reason, user.id);
      if (body.priority !== base && !overridden) return Response.json({ error: "Priority override requires a reason and actor (§26)", code: "OVERRIDE_REJECTED" }, { status: 400 });
      const patch: any = { ops_priority: priority, ops_priority_reason: body.reason || null, ops_priority_overridden: overridden };
      const updated = await svc.entities.VisaApplication.update(body.id, patch).catch(() => null);
      await writeAudit(svc, { application_id: body.id, case_id: body.id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "FLAG_ISSUE", previous_state: base, new_state: priority, reason: body.reason || "Priority set", metadata: { overridden, base } });
      return Response.json({ case: sanitize(updated), priority, overridden, base });
    }

    if (action === "admin-timeline") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      // Phase 31 \u00a716: timeline from durable CaseEvent (+ legacy fallback + ops audit).
      const caseEvents: any[] = await loadCaseEvents(svc, body.id, 200).catch(() : any[] => []);
      let tl = timelineFromCaseEvents(caseEvents, (row.metadata?.events) || []);
      const opEvents: any[] = await svc.entities.OperationsAuditEvent.filter({ application_id: body.id }, "-occurred_at", 200).catch(() : any[] => []);
      tl = tl.concat(opEvents.map((a: any) => ({ at: a.occurred_at, type: a.action, title: a.action, actor: a.actor_id, source: "ops_audit" })));
      const filter = body.filter;
      if (filter === "traveler") tl = tl.filter((e: any) => !["SYSTEM", "ops_audit"].includes(e.source || "") && e.type !== "STATUS_CHANGED");
      if (filter === "system") tl = tl.filter((e: any) => e.source === "case_engine" || e.actor === "system");
      if (filter === "provider") tl = tl.filter((e: any) => e.source === "provider_webhook");
      if (filter === "admin") tl = tl.filter((e: any) => e.source === "ops_audit");
      if (filter === "review") tl = tl.filter((e: any) => /REVIEW/.test(e.type || ""));
      tl.sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
      return Response.json({ timeline: tl });
    }

    if (action === "admin-audit-log") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const opEvents: any[] = await svc.entities.OperationsAuditEvent.filter({ application_id: body.id }, "-occurred_at", 200).catch(() : any[] => []);
      const caseEvents: any[] = await loadCaseEvents(svc, body.id, 200).catch(() : any[] => []);
      const fromCase = caseEvents.length ? auditFromEvents(caseEvents.map((e: any) => ({ actor: e.actor_id, event_type: e.event_type, occurred_at: e.created_date, from_state: e.previous_case_state, to_state: e.new_case_state, reason: e.reason, source: e.source, idempotency_key: e.idempotency_key }))) : auditFromEvents((row.metadata || {}).events || []);
      return Response.json({ audit: fromCase.concat(opEvents.map((a: any) => ({ actor: a.actor_id, action: a.action, occurred_at: a.occurred_at, previous_state: a.previous_state, new_state: a.new_state, reason: a.reason, source: "ops_audit", idempotency_key: null }))) });
    }

    if (action === "admin-export") {
      const f = body.filters || {};
      const q: any = {};
      if (f.case_state) q.case_state = f.case_state;
      if (f.destination) q.destination = f.destination;
      if (f.execution_capability) q.execution_capability = f.execution_capability;
      if (f.provider) q.provider_key = f.provider;
      if (f.owner) q.ops_owner_id = f.owner;
      const rows: any[] = await svc.entities.VisaApplication.filter(q, "-updated_date", 1000).catch(() => []);
      const format = body.format === "json" ? "json" : "csv";
      // Sensitive fields are never exported (§28). Only operational metadata.
      const out = rows.map((r: any) => ({ id: r.id, traveler_id: r.traveler_id, destination: r.destination, journey: r.visa_type_key, nationality: r.nationality, case_state: r.case_state, normalized_status: r.normalized_status, execution_capability: r.execution_capability, provider: r.provider_key, ops_owner_id: r.ops_owner_id, ops_priority: r.ops_priority, paid_at: !!r.paid_at, created_at: r.created_date, updated_at: r.updated_date, closed_at: r.closed_at }));
      await writeAudit(svc, { application_id: "export", case_id: "export", traveler_id: "export", actor_id: user.id, actor_role: "ADMIN", action: "QC_RUN", previous_state: null, new_state: null, reason: `Export ${format} (${out.length} rows)`, metadata: { format, count: out.length, filters: f } });
      if (format === "json") return Response.json({ format: "json", rows: out, count: out.length });
      const header = Object.keys(out[0] || { id: "" }).join(",");
      const csv = [header, ...out.map((r: any) => Object.values(r).map((v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
      return Response.json({ format: "csv", csv, count: out.length });
    }

    // ===================== PHASE 31 CONSOLIDATION / HARDENING =====================

    // \u00a73/\u00a74/\u00a76: migrate legacy VisaApplication rows to case_state SOT.
    if (action === "admin-case-migrate") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const result = await migrateAllLegacy(svc, { limit: body.limit || 5000 });
      await writeAudit(svc, { application_id: "migration", case_id: "migration", traveler_id: "migration", actor_id: user.id, actor_role: "ADMIN", action: "QC_RUN", previous_state: null, new_state: null, reason: `Legacy migration: ${result.migrated} migrated, ${result.review_required} flagged`, metadata: result });
      return Response.json({ migration: result });
    }

    // \u00a724/\u00a725: retention run (dry-run supported). Never deletes CaseEvent.
    if (action === "admin-retention-run") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const result = await runRetention(svc, { dryRun: !!body.dry_run });
      await writeAudit(svc, { application_id: "retention", case_id: "retention", traveler_id: "retention", actor_id: user.id, actor_role: "ADMIN", action: "QC_RUN", previous_state: null, new_state: null, reason: `Retention run (dry=${!!body.dry_run})`, metadata: { result, defaults: RETENTION_DEFAULTS } });
      return Response.json({ result, defaults: RETENTION_DEFAULTS });
    }

    // \u00a724: seed default retention policies (idempotent upsert by category).
    if (action === "admin-retention-seed") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      let created = 0;
      for (const [cat, def] of Object.entries(RETENTION_DEFAULTS)) {
        const existing: any[] = await svc.entities.DataRetentionPolicy.filter({ category: cat, status: "active" }).catch(() : any[] => []);
        if (existing.length) continue;
        await svc.entities.DataRetentionPolicy.create({ category: cat, retention_days: def.retention_days, behavior: def.behavior, reason: def.reason, owner: "system", legal_hold: false, status: "active" }).catch(() => null);
        created++;
      }
      await writeAudit(svc, { application_id: "retention", case_id: "retention", traveler_id: "retention", actor_id: user.id, actor_role: "ADMIN", action: "QC_RUN", reason: `Retention policy seed: ${created} new`, metadata: { created } });
      return Response.json({ created, defaults: RETENTION_DEFAULTS });
    }

    // \u00a726: consent recording + lookup (owner or admin).
    if (action === "application-consent-record") {
      if (!body.consent_type || !body.consent_version) return Response.json({ error: "consent_type and consent_version required" }, { status: 400 });
      const rec = await recordConsent(svc, user, { consent_type: body.consent_type, consent_version: body.consent_version, purpose: body.purpose, case_id: body.case_id });
      return Response.json({ consent: rec });
    }
    if (action === "application-consent-latest") {
      if (!body.consent_type) return Response.json({ error: "consent_type required" }, { status: 400 });
      return Response.json({ consent: await latestConsent(svc, user, body.consent_type) });
    }

    // \u00a73/\u00a75: verify case_state is the SOT and status is the derived projection
    // for a single case. Returns drift flags \u2014 useful for \u00a736 live validation.
    if (action === "admin-case-validate-state") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const expectedStatus = legacyStatusFromCaseState(row.case_state || "DRAFT");
      const events = await loadCaseEvents(svc, body.id, 1).catch(() => []);
      return Response.json({ case_state: row.case_state, legacy_status: row.status, expected_status: expectedStatus, status_drift: row.status !== expectedStatus, has_case_events: events.length > 0, case_events_count: events.length, migration_review_required: !!(row.metadata || {}).migration_review_required });
    }

    // \u00a736: live migration validation for a single case.
    if (action === "admin-case-migrate-one") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const row: any = await svc.entities.VisaApplication.get(body.id).catch(() => null);
      if (!row) return Response.json({ error: "Not found" }, { status: 404 });
      const r = await migrateLegacyApplication(svc, row);
      await writeAudit(svc, { application_id: body.id, case_id: body.id, traveler_id: row.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "QC_RUN", reason: `Migrate one: ${r.migrated ? "migrated" : "already ok"}`, metadata: { review_required: r.review_required } });
      return Response.json({ result: r });
    }

    // ===================== PHASE 32 OPERATIONS QUEUE / WORK MANAGEMENT =====================
    // Work-management layer. It does NOT own application case state (§20): task actions
    // that need state changes drive the Case Engine (persistCaseTransition /
    // transitionCaseToState) and only then complete the task. Travelers never access ops
    // tasks; every mutation is audited via OperationsAuditEvent.
    const OPS_ACTIONS = new Set(["ops-task-list", "ops-task-detail", "ops-task-claim", "ops-task-assign", "ops-task-release", "ops-task-transition", "ops-task-action", "ops-task-priority", "ops-task-bulk", "ops-task-backfill", "ops-exception-create", "ops-exception-resolve", "ops-task-export", "ops-task-note-create", "ops-task-dashboard", "ops-task-meta"]);
    if (OPS_ACTIONS.has(action) && user.role !== "admin") return Response.json({ error: "Operations access required" }, { status: 403 });

    if (action === "ops-task-meta") {
      return Response.json({ queues: _Q, statuses: _TS, priorities: _P, permissions: opsPermissions(user.role) });
    }

    if (action === "ops-task-list") {
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
      const offset = Math.max(Number(body.offset) || 0, 0);
      const sort = body.sort || "-created_at";
      return Response.json(await listTasks(svc, user, body.filters || {}, sort, limit, offset));
    }

    if (action === "ops-task-dashboard") {
      // Aggregate over all tasks (bounded) for top metrics.
      const { summary } = await listTasks(svc, user, {}, "-created_at", 2000, 0);
      return Response.json({ metrics: { open: summary.open, unassigned: summary.unassigned, due_today: summary.due_today, overdue: summary.overdue, high_priority: summary.high_priority, waiting: summary.waiting, blocked: summary.blocked, exceptions: summary.exceptions, completed_today: summary.completed_today }, breakdown: { by_queue: summary.by_queue, by_assignee: summary.by_assignee, by_type: summary.by_type, by_destination: summary.by_destination }, permissions: opsPermissions(user.role) });
    }

    if (action === "ops-task-detail") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const detail = await getTaskDetail(svc, user, body.id);
      return Response.json({ ...detail, actions: ACTIONS_FOR_TYPE[detail.task.task_type] || [], required_resolution: REQUIRED_RESOLUTIONS[detail.task.task_type] ?? null });
    }

    if (action === "ops-task-claim") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      return Response.json({ task: await claimTask(svc, user, body.id) });
    }
    if (action === "ops-task-assign") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      return Response.json({ task: await assignTask(svc, user, body.id, body.assignee ?? null, body.team) });
    }
    if (action === "ops-task-release") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      return Response.json({ task: await releaseTask(svc, user, body.id) });
    }
    if (action === "ops-task-transition") {
      if (!body.id || !body.to) return Response.json({ error: "id and to required" }, { status: 400 });
      return Response.json({ task: await transitionTaskStatus(svc, user, body.id, body.to, { waiting_reason: body.waiting_reason, next_check_at: body.next_check_at, block_reason: body.block_reason, blocker_owner: body.blocker_owner, reason: body.reason }) });
    }
    if (action === "ops-task-priority") {
      if (!body.id || !body.priority) return Response.json({ error: "id and priority required" }, { status: 400 });
      return Response.json(await overridePriority(svc, user, body.id, body.priority, body.reason || null));
    }
    if (action === "ops-task-action") {
      if (!body.id || !body.action_code) return Response.json({ error: "id and action_code required" }, { status: 400 });
      try { return Response.json(await taskAction(svc, user, body.id, body.action_code, { reason: body.reason, idempotency_key: body.idempotency_key })); }
      catch (e: any) { const code = e?.code || "TASK_ACTION_FAILED"; return Response.json({ error: e?.message || String(e), code }, { status: ["BAD_TRANSITION", "BAD_RESOLUTION", "BAD_ACTION", "NOT_FOUND"].includes(code) ? 400 : 500 }); }
    }
    if (action === "ops-task-bulk") {
      if (!body.task_ids || !body.bulk_action) return Response.json({ error: "task_ids and bulk_action required" }, { status: 400 });
      return Response.json(await bulkAction(svc, user, body.task_ids, body.bulk_action, body.payload || {}));
    }
    if (action === "ops-exception-create") {
      if (!body.case_id || !body.type || !body.severity) return Response.json({ error: "case_id, type, severity required" }, { status: 400 });
      return Response.json({ exception: await createException(svc, user, { case_id: body.case_id, type: body.type, severity: body.severity, message: body.message || "", task_id: body.task_id }) });
    }
    if (action === "ops-exception-resolve") {
      if (!body.exception_id) return Response.json({ error: "exception_id required" }, { status: 400 });
      return Response.json({ exception: await resolveException(svc, user, body.exception_id, body.resolution || "", body.status || "RESOLVED") });
    }
    if (action === "ops-task-export") {
      return Response.json(await exportTasks(svc, user, body.filters || {}, body.format === "json" ? "json" : "csv"));
    }
    if (action === "ops-task-note-create") {
      if (!body.task_id || !body.body) return Response.json({ error: "task_id and body required" }, { status: 400 });
      const t: any = await svc.entities.OperationsTask.get(body.task_id).catch(() => null);
      if (!t) return Response.json({ error: "Task not found" }, { status: 404 });
      const note = await svc.entities.InternalNote.create({ application_id: t.case_id, task_id: body.task_id, author_id: user.id, author_name: user.full_name || user.email, body: body.body, pinned: !!body.pinned, metadata: { category: "OPS_TASK" } }).catch(() => null);
      await writeAudit(svc, { application_id: t.case_id, case_id: t.case_id, traveler_id: t.traveler_id, actor_id: user.id, actor_role: "ADMIN", action: "FLAG_ISSUE", reason: "Internal note on task", metadata: { task_id: body.task_id, note_id: note?.id } });
      return Response.json({ note });
    }
    if (action === "ops-task-backfill") {
      return Response.json(await backfillTasksFromEvents(svc, { limit: body.limit || 5000 }));
    }

    // ---- Phase 33: Provider Execution & Integration Layer ----
    const EXEC_ACTIONS = new Set(["ops-execution-route", "ops-execution-run", "ops-execution-attempts", "ops-provider-health", "ops-provider-webhook"]);
    if (EXEC_ACTIONS.has(action) && user.role !== "admin") return Response.json({ error: "Operations access required" }, { status: 403 });

    if (action === "ops-execution-route") {
      if (!body.case_id) return Response.json({ error: "case_id required" }, { status: 400 });
      const app: any = await svc.entities.VisaApplication.get(body.case_id).catch(() => null);
      if (!app) return Response.json({ error: "Case not found" }, { status: 404 });
      const route = await resolveRouteForCase(svc, app, { environmentOverride: body.environment || undefined });
      return Response.json({ route });
    }

    if (action === "ops-execution-run") {
      if (!body.case_id) return Response.json({ error: "case_id required" }, { status: 400 });
      const app: any = await svc.entities.VisaApplication.get(body.case_id).catch(() => null);
      if (!app) return Response.json({ error: "Case not found" }, { status: 404 });
      // §41 critical: no real submissions during development. Use a MOCK adapter
      // unless an explicit verified production adapter is registered. dry_run
      // defaults true to guarantee no real submission accidentally runs.
      const dryRun = body.dry_run !== false;
      const mock = createMockProviderAdapter({ key: body.mock_provider_key || "MOCK_PROVIDER", capabilities: body.mock_capabilities as any });
      try {
        const result = await runExecution(svc, user, app, { operation: body.operation || "SUBMIT", environment: body.environment || "SANDBOX", dry_run: dryRun, mockAdapter: mock });
        return Response.json(result);
      } catch (e: any) {
        return Response.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "FORBIDDEN" ? 403 : 500 });
      }
    }

    if (action === "ops-execution-attempts") {
      if (!body.case_id) return Response.json({ error: "case_id required" }, { status: 400 });
      return Response.json({ attempts: await listExecutionAttempts(svc, user, body.case_id) });
    }

    if (action === "ops-provider-health") {
      if (!body.provider_key) return Response.json({ error: "provider_key required" }, { status: 400 });
      return Response.json(await providerHealthCheck(svc, user, body.provider_key));
    }

    if (action === "ops-provider-webhook") {
      // Provider webhook ingestion. Authenticates by provider lookup + webhook_verified
      // connection; idempotent by idempotency_key. Never exposes internal secrets.
      if (!body.provider_key || !body.payload) return Response.json({ error: "provider_key and payload required" }, { status: 400 });
      try { return Response.json(await ingestExecWebhook(svc, { provider_key: body.provider_key, payload: body.payload, signature: body.signature })); }
      catch (e: any) { return Response.json({ error: e?.message || String(e), code: e?.code }, { status: 500 }); }
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e), code: e?.code }, { status: 500 });
  }
}

async function loadLaunchGate(svc: any): Promise<any> {
  const rows: any[] = await svc.entities.Setting.filter({ tenant_id: "krosz", category: "launch_control", key: "control" }, "-created_date", 1).catch(() : any[] => []);
  if (!rows[0]?.value) return { global_paused: false, countries: {} };
  return rows[0].value;
}
async function writeAudit(svc: any, p: { application_id: string; case_id: string; traveler_id: string; actor_id: string; actor_role: string; action: string; previous_state?: string | null; new_state?: string | null; reason?: string; metadata?: any }) {
  await svc.entities.OperationsAuditEvent.create({ application_id: p.application_id, case_id: p.case_id, traveler_id: p.traveler_id, actor_id: p.actor_id, actor_role: p.actor_role, action: p.action, previous_state: p.previous_state || null, new_state: p.new_state || null, reason: p.reason || null, metadata: p.metadata || {}, occurred_at: new Date().toISOString() }).catch(() => {});
}
function aForTransition(to: string): string {
  const m: any = { SUBMITTED: "SUBMISSION_CONFIRMED", APPROVED: "DECISION_RECEIVED", REJECTED: "DECISION_RECEIVED", CANCELLED: "CASE_CANCELLED", SUBMISSION_PENDING: "SUBMISSION_STARTED", REVIEW_REQUIRED: "REVIEW_STARTED" };
  return m[to] || "TRACKING_UPDATED";
}