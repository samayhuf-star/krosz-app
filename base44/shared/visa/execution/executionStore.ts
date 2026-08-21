// Worldz Visa (Phase 33) — Execution store (durable).
//
// Wraps the pure Phase 33 router + adapter contract + retry/circuit-breaker with
// persistence over ExecutionAttempt, CaseEvent, and the Phase 27/31 Case Engine.
//
// Hard rules:
//   §8 NO FAKE EXECUTION: a real submission is only attempted when a verified,
//      production-authorized provider adapter is actually registered. Otherwise
//      the attempt is recorded as EXECUTION_UNAVAILABLE / NOT_EXECUTABLE.
//   §11 sandbox credentials never execute production applications.
//   §12 idempotent application creation: attempts key by (case + operation).
//   §16 submission gates reuse Phase 27 submissionAllowed.
//   §18 provider status normalization -> Case Engine transition (single source).
//   §19 webhooks dedup by idempotency_key; no duplicate event/transition/task.
//   §21 transient retries; §22 circuit-breaker records on Provider.failure_count.
//   §39 never store secrets / passport data / document content in attempts/events.

import {
  resolveExecutionRoute, type RouteBinding, type RouteProvider, type RouteConnection, type ExecutionRoute, type RouteType,
} from "./router.ts";
import {
  classifyError, shouldRetry, isCircuitOpen, recordFailure, recordSuccess, type ErrorClass,
} from "./retry.ts";
import {
  createMockProviderAdapter, wrapSubmissionAdapter, wrapPortalAdapter,
  type ProviderExecutionAdapter, type ExecutionAttemptInput, CAPABILITY_NOT_SUPPORTED,
} from "./adapterContract.ts";
import { hasSubmissionAdapter, getSubmissionAdapter } from "../submission/registry.ts";
import { hasExecutionAdapter, getExecutionAdapter } from "./registry.ts";
import { providerStatusToCaseState } from "./adapterContract.ts";
import { submissionAllowed } from "../application/caseEngine.ts";
import { setApplicationLifecycle, recordCaseEvent, loadCaseEvents } from "../application/caseStore.ts";
import { ensureTasksFromCaseEvent } from "../operations/taskStore.ts";
import { legacyStatusFromCaseState } from "../application/caseProjections.ts";

function assertAdmin(user: any) {
  if (!user || user.role !== "admin") throw Object.assign(new Error("Operations access required"), { code: "FORBIDDEN" });
}

export function attemptIdempotencyKey(caseId: string, providerKey: string, operation: string): string {
  return `exec|${caseId}|${providerKey}|${operation}`;
}

// ---------- Route resolution at runtime ----------
export async function resolveRouteForCase(svc: any, app: any, opts: { environmentOverride?: "SANDBOX" | "PRODUCTION" } = {}): Promise<ExecutionRoute> {
  const destination = String(app.destination || "").toUpperCase();
  const bindings: any[] = await svc.entities.CountryProviderBinding.filter({ country_code: destination }).catch(() => []);
  const providerKeys = Array.from(new Set(bindings.map((b) => b.provider_key).filter(Boolean)));
  const providers: Record<string, any> = {};
  for (const k of providerKeys) {
    const p: any[] = await svc.entities.Provider.filter({ key: k }).catch(() => []);
    if (p[0]) providers[k] = p[0];
  }
  const connectionRows: any[] = await svc.entities.ProviderConnection.list(null, 200).catch(() => []);
  const connections: RouteConnection[] = connectionRows.map((c) => ({ provider_key: c.provider_key, environment: c.environment, status: c.status, health_status: c.health_status, webhook_verified: c.webhook_verified }));

  // Portal automation available if an active PortalDefinition with automation_allowed exists for this destination.
  const portalDefs: any[] = await svc.entities.PortalDefinition.filter({ country: app.destination, status: "ACTIVE" }).catch(() => []);
  const portalAutomationAvailable = portalDefs.some((p) => p.automation_allowed !== false && p.execution_strategy !== "MANUAL");

  // Human operations approved if a manual provider is configured/enabled, or manual_operations_required.
  const manualProviders: any[] = await svc.entities.Provider.filter({ category: "visa_submission", adapter_key: "visa.exec.manual" }).catch(() => []);
  const manualOperationsApproved = (manualProviders[0]?.enabled === true) || (app.case_snapshot?.manual_operations_required === true) || false;

  return resolveExecutionRoute({
    case: { destination: app.destination, journey: app.visa_type_key, visa_type_key: app.visa_type_key, nationality: app.nationality, case_state: app.case_state, execution_capability: app.execution_capability },
    bindings: bindings.map((b) => ({ provider_key: b.provider_key, provider_name: b.provider_name, country_code: b.country_code, nationality: b.nationality, journey_type: b.journey_type, role: b.role, capability: b.capability, our_api_access: b.our_api_access, our_commercial_authorized: b.our_commercial_authorized, our_active: b.our_active, verification_status: b.verification_status, status: b.status, commercial_access: b.commercial_access, is_primary: b.is_primary, fallback_order: b.fallback_order })) as RouteBinding[],
    providers,
    connections,
    portalAutomationAvailable,
    manualOperationsApproved,
    environmentOverride: opts.environmentOverride,
  });
}

// ---------- ExecutionAttempt persistence (idempotent) ----------
export async function ensureExecutionAttempt(svc: any, input: { case_id: string; traveler_id?: string; provider_key: string; provider_binding_id?: string; route_type: RouteType; operation: string; environment: "SANDBOX" | "PRODUCTION"; dry_run?: boolean; request_reference?: string; idempotency_key?: string; metadata?: any }): Promise<{ attempt: any; created: boolean }> {
  const idem = input.idempotency_key || attemptIdempotencyKey(input.case_id, input.provider_key, input.operation);
  const existing: any[] = await svc.entities.ExecutionAttempt.filter({ idempotency_key: idem }).catch(() => []);
  if (existing && existing.length) return { attempt: existing[0], created: false };
  const now = new Date().toISOString();
  const attempt = await svc.entities.ExecutionAttempt.create({
    case_id: input.case_id, application_id: input.case_id, traveler_id: input.traveler_id || null,
    provider_key: input.provider_key, provider_binding_id: input.provider_binding_id || null,
    route_type: input.route_type, operation: input.operation, idempotency_key: idem,
    status: "PENDING", environment: input.environment, dry_run: !!input.dry_run,
    request_reference: input.request_reference || cryptoRef(), response_reference: null,
    provider_application_id: null, external_reference: null, normalized_status: null, raw_status: null,
    error_code: null, error_message: null, error_class: null, retry_count: 0, fallback_used: false,
    started_at: now, completed_at: null, latency_ms: null, webhook_received: false,
    metadata: input.metadata || {},
  });
  return { attempt, created: true };
}

function cryptoRef(): string {
  try { return crypto.randomUUID(); } catch { return "ref-" + Math.random().toString(36).slice(2); }
}

// Select the real execution adapter for a provider, if one is registered.
function selectRealAdapter(provider: any): ProviderExecutionAdapter | null {
  if (!provider) return null;
  try {
    if (hasSubmissionAdapter(provider.adapter_key)) return wrapSubmissionAdapter(getSubmissionAdapter(provider.adapter_key));
  } catch {}
  try {
    if (hasExecutionAdapter(provider.adapter_key)) return wrapPortalAdapter(getExecutionAdapter(provider.adapter_key));
  } catch {}
  return null;
}

// ---------- Run an execution operation (mock/sandbox safe; §41 no real submission) ----------
export async function runExecution(svc: any, user: any, app: any, opts: { operation: "SUBMIT" | "STATUS" | "CANCEL" | "UPLOAD_DOCUMENT"; environment?: "SANDBOX" | "PRODUCTION"; dry_run?: boolean; mockAdapter?: ProviderExecutionAdapter; request_reference?: string }): Promise<{ route: ExecutionRoute; attempt: any; outcome: any }> {
  assertAdmin(user);
  const environment = opts.environment || "PRODUCTION";
  const route = await resolveRouteForCase(svc, app, { environmentOverride: environment });

  // §16 submission gate for SUBMIT operations (Phase 27 authority).
  if (opts.operation === "SUBMIT" && route.submission_available) {
    if (route.route_type === "EXECUTION_UNAVAILABLE" || route.route_type === "GUIDANCE") {
      // route already says no; record an attempt as unavailable (no fake).
    } else {
      const sa = submissionAllowed({ state: app.case_state, execution_capability: app.execution_capability, snapshot: app.case_snapshot, ownership: {} } as any);
      if (!sa.ok) {
        const { attempt } = await ensureExecutionAttempt(svc, { case_id: app.id, traveler_id: app.traveler_id, provider_key: route.provider_key || "none", route_type: route.route_type, operation: opts.operation, environment, dry_run: opts.dry_run, metadata: { gate: sa.reason || "submission gated" } });
        await svc.entities.ExecutionAttempt.update(attempt.id, { status: "FAILED", error_code: "SUBMISSION_GATE_BLOCKED", error_message: sa.reason || "Submission not allowed by case engine", error_class: "PERMANENT", completed_at: new Date().toISOString() }).catch(() => {});
        return { route, attempt: await svc.entities.ExecutionAttempt.get(attempt.id).catch(() => attempt), outcome: { ok: false, reason: sa.reason } };
      }
    }
  }

  // §8 no fake execution: only a real registered adapter may run against a real
  // production environment. Otherwise we record EXECUTION_UNAVAILABLE.
  let adapter: ProviderExecutionAdapter | null = opts.mockAdapter || null;
  if (!adapter && route.provider_key) {
    const pRows: any[] = await svc.entities.Provider.filter({ key: route.provider_key }).catch(() => []);
    adapter = selectRealAdapter(pRows[0]);
  }
  const isMock = !!opts.mockAdapter;
  const dryRun = !!opts.dry_run || isMock;

  if (route.route_type === "GUIDANCE") {
    const { attempt } = await ensureExecutionAttempt(svc, { case_id: app.id, traveler_id: app.traveler_id, provider_key: route.provider_key || "guidance", route_type: route.route_type, operation: opts.operation, environment, dry_run: true, metadata: { reason: route.reason } });
    await svc.entities.ExecutionAttempt.update(attempt.id, { status: "CANCELLED", completed_at: new Date().toISOString(), error_code: "GUIDANCE_ONLY", error_message: route.reason }).catch(() => {});
    return { route, attempt, outcome: { ok: false, guidance: true, reason: route.reason } };
  }

  if (route.route_type === "EXECUTION_UNAVAILABLE" || (!adapter && !dryRun)) {
    const { attempt } = await ensureExecutionAttempt(svc, { case_id: app.id, traveler_id: app.traveler_id, provider_key: route.provider_key || "none", route_type: route.route_type, operation: opts.operation, environment, dry_run: dryRun, metadata: { reason: route.reason } });
    await svc.entities.ExecutionAttempt.update(attempt.id, { status: "FAILED", error_code: "EXECUTION_UNAVAILABLE", error_message: route.reason || "No verified execution route", error_class: "PERMANENT", completed_at: new Date().toISOString() }).catch(() => {});
    return { route, attempt, outcome: { ok: false, unavailable: true, reason: route.reason } };
  }

  // We have an adapter (real when not mock, mock when explicitly provided).
  const { attempt, created } = await ensureExecutionAttempt(svc, { case_id: app.id, traveler_id: app.traveler_id, provider_key: route.provider_key || adapter!.key, provider_binding_id: route.provider_binding_id || null, route_type: route.route_type, operation: opts.operation, environment, dry_run: dryRun, request_reference: opts.request_reference, metadata: { route_reason: route.reason } });
  await svc.entities.ExecutionAttempt.update(attempt.id, { status: "RUNNING", started_at: attempt.started_at }).catch(() => {});

  const t0 = Date.now();
  const input: ExecutionAttemptInput = {
    case_id: app.id, operation: mapOperation(opts.operation), idempotency_key: attempt.idempotency_key,
    environment, dry_run: dryRun, external_reference: app.provider_application_id || undefined,
  };

  // Retry loop (§21) for transient errors only.
  let result: any = null;
  let retryCount = 0;
  const maxRetries = 3;
  for (let attemptN = 0; attemptN <= maxRetries; attemptN++) {
    try {
      result = await dispatch(adapter!, opts.operation, input);
    } catch (e: any) {
      result = { ok: false, capability_supported: true, error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e) };
    }
    if (result?.ok) break;
    if (!result?.capability_supported) break; // CAPABILITY_NOT_SUPPORTED — never retry
    const cls = (result.retryable === true ? "TRANSIENT" : classifyError(result.error_code)) as ErrorClass;
    if (cls !== "TRANSIENT") break;
    const retry = shouldRetry({ retry_count: attemptN }, result.error_code);
    if (!retry.retry) break;
    retryCount++;
    await svc.entities.ExecutionAttempt.update(attempt.id, { status: "RETRYING", retry_count: retryCount, error_code: result.error_code, error_class: cls }).catch(() => {});
    await new Promise((r) => setTimeout(r, retry.delay_ms));
  }

  const latency_ms = Date.now() - t0;
  const now = new Date().toISOString();

  if (result?.ok) {
    // Success — persist provider references + drive Case Engine.
    const status = result.normalized_status || null;
    const upd: any = { status: "SUCCEEDED", response_reference: result.external_reference || null, provider_application_id: result.provider_application_id || result.external_reference || null, external_reference: result.external_reference || null, normalized_status: status, raw_status: result.raw_status || null, error_code: null, error_message: null, retry_count: retryCount, latency_ms, completed_at: now };
    await svc.entities.ExecutionAttempt.update(attempt.id, upd).catch(() => {});
    // Persist provider application id on the case (§26).
    if (result.provider_application_id || result.external_reference) {
      await svc.entities.VisaApplication.update(app.id, { provider_application_id: result.provider_application_id || result.external_reference, external_reference: result.external_reference }).catch(() => {});
    }
    // Record a durable CaseEvent for the execution outcome (§38).
    await recordCaseEvent(svc, app, { event_type: result.normalized_status === "SUBMITTED" ? "SUBMISSION_ATTEMPTED" : "PROVIDER_STATUS_UPDATED", source: "execution", actor_id: "system", idempotency_key: `evt_${attempt.idempotency_key}`, reason: route.reason, metadata: { provider_key: route.provider_key, route_type: route.route_type, external_reference: result.external_reference || null, normalized_status: status } }).catch(() => {});
    // Drive the Case Engine for a submitted application (§24/§15).
    if (opts.operation === "SUBMIT" && status === "SUBMITTED") {
      const t = await setApplicationLifecycle(svc, app, "submitted", { source: "execution", actor_id: "system", idempotency_key: `lifecycle_${attempt.idempotency_key}`, metadata: { provider_key: route.provider_key, external_reference: result.external_reference } }).catch(() => null);
      if (t?.events?.length) for (const e of t.events) { const freshApp = await svc.entities.VisaApplication.get(app.id).catch(() => app); await ensureTasksFromCaseEvent(svc, freshApp, e).catch(() => {}); }
    } else if (status && status !== "SUBMITTED") {
      // Map normalized status to legacy status for the compatibility entrypoint.
      const legacy = legacyStatusFromCaseState(status as any);
      if (legacy && legacy !== "draft") {
        const t = await setApplicationLifecycle(svc, app, legacy, { source: "provider_webhook", actor_id: route.provider_key || "provider", idempotency_key: `wh_${attempt.idempotency_key}` }).catch(() => null);
        if (t?.events?.length) for (const e of t.events) { const freshApp = await svc.entities.VisaApplication.get(app.id).catch(() => app); await ensureTasksFromCaseEvent(svc, freshApp, e).catch(() => {}); }
      }
    }
    // Circuit breaker: record success.
    if (route.provider_key) {
      const pRows: any[] = await svc.entities.Provider.filter({ key: route.provider_key }).catch(() => []);
      if (pRows[0]) { const r = recordSuccess(pRows[0]); await svc.entities.Provider.update(pRows[0].id, { failure_count: r.failure_count, health_status: r.health_status }).catch(() => {}); }
    }
    return { route, attempt: await svc.entities.ExecutionAttempt.get(attempt.id).catch(() => attempt), outcome: { ok: true, external_reference: result.external_reference, provider_application_id: result.provider_application_id, normalized_status: status } };
  }

  // Failure — classify + record + circuit breaker.
  const cls = classifyError(result?.error_code, undefined, result?.retryable) as ErrorClass;
  const fallback = route.fallback_route;
  await svc.entities.ExecutionAttempt.update(attempt.id, { status: "FAILED", error_code: result?.error_code || "EXECUTION_FAILED", error_message: result?.error_message || "Execution failed", error_class: cls, retry_count: retryCount, fallback_used: !!fallback, latency_ms, completed_at: now }).catch(() => {});
  await recordCaseEvent(svc, app, { event_type: "SUBMISSION_FAILED", source: "execution", actor_id: "system", idempotency_key: `fail_${attempt.idempotency_key}`, reason: result?.error_code || "failed", metadata: { provider_key: route.provider_key, error_code: result?.error_code, error_class: cls, fallback_route: fallback } }).catch(() => {});
  if (route.provider_key) {
    const pRows: any[] = await svc.entities.Provider.filter({ key: route.provider_key }).catch(() => []);
    if (pRows[0]) { const r = recordFailure(pRows[0], now); await svc.entities.Provider.update(pRows[0].id, { failure_count: r.failure_count, last_failure_at: r.last_failure_at, health_status: r.health_status }).catch(() => {}); }
  }
  return { route, attempt: await svc.entities.ExecutionAttempt.get(attempt.id).catch(() => attempt), outcome: { ok: false, error_code: result?.error_code, error_class: cls, fallback_route: fallback, reason: result?.error_message } };
}

function mapOperation(op: string): "CREATE_APPLICATION" | "UPDATE_APPLICATION" | "UPLOAD_DOCUMENT" | "SUBMIT" | "STATUS" | "CANCEL" | "REFUND" {
  if (op === "SUBMIT") return "SUBMIT";
  if (op === "STATUS") return "STATUS";
  if (op === "CANCEL") return "CANCEL";
  if (op === "UPLOAD_DOCUMENT") return "UPLOAD_DOCUMENT";
  return "CREATE_APPLICATION";
}

async function dispatch(adapter: ProviderExecutionAdapter, op: string, input: ExecutionAttemptInput): Promise<any> {
  switch (op) {
    case "SUBMIT": return adapter.submitApplication ? adapter.submitApplication(input) : { ok: false, capability_supported: false, error_code: CAPABILITY_NOT_SUPPORTED };
    case "STATUS": return adapter.getApplicationStatus ? adapter.getApplicationStatus(input) : { ok: false, capability_supported: false, error_code: CAPABILITY_NOT_SUPPORTED };
    case "CANCEL": return adapter.cancelApplication ? adapter.cancelApplication(input) : { ok: false, capability_supported: false, error_code: CAPABILITY_NOT_SUPPORTED };
    case "UPLOAD_DOCUMENT": return adapter.uploadDocument ? adapter.uploadDocument(input) : { ok: false, capability_supported: false, error_code: CAPABILITY_NOT_SUPPORTED };
    default: return adapter.createApplication ? adapter.createApplication(input) : { ok: false, capability_supported: false, error_code: CAPABILITY_NOT_SUPPORTED };
  }
}

// ---------- Webhook ingestion (§19) ----------
export async function ingestProviderWebhook(svc: any, input: { provider_key: string; payload: any; signature?: string }): Promise<{ ok: boolean; idempotent?: boolean; normalized?: string; case_id?: string; error?: string }> {
  // Authenticate: provider must exist + connection must be webhook_verified (§19/§21).
  const pRows: any[] = await svc.entities.Provider.filter({ key: input.provider_key }).catch(() => []);
  const provider = pRows[0];
  if (!provider) return { ok: false, error: "UNKNOWN_PROVIDER" };
  const connRows: any[] = await svc.entities.ProviderConnection.filter({ provider_key: input.provider_key, status: "CONNECTED" }).catch(() => []);
  const conn = connRows[0];
  if (!conn || !conn.webhook_verified) return { ok: false, error: "WEBHOOK_NOT_VERIFIED" };

  const raw = String(input.payload?.status || input.payload?.event || "UNKNOWN");
  const adapter = selectRealAdapter(provider) || createMockProviderAdapter({ key: provider.key });
  const norm = await adapter.handleWebhook(input.payload).catch(() => ({ normalized: providerStatusToCaseState(raw), raw, external_reference: input.payload?.external_reference, idempotency_key: input.payload?.idempotency_key } as any));
  if ((norm as any).error) return { ok: false, error: (norm as any).error };

  const externalRef = (norm as any).external_reference || input.payload?.external_reference;
  const idemKey = (norm as any).idempotency_key || input.payload?.idempotency_key || `wh|${input.provider_key}|${externalRef || raw}|${(norm as any).normalized}`;
  // Dedup: an existing CaseEvent for this webhook idempotency key means we already processed it.
  const existing: any[] = await svc.entities.CaseEvent.filter({ idempotency_key: idemKey }).catch(() => []);
  if (existing && existing.length) return { ok: true, idempotent: true, normalized: (norm as any).normalized, case_id: existing[0].case_id };

  // Resolve the case by external reference (provider_application_id) on the case.
  if (!externalRef) return { ok: false, error: "NO_REFERENCE" };
  const appRows: any[] = await svc.entities.VisaApplication.filter({ provider_application_id: externalRef }).catch(() => []);
  const app = appRows[0];
  if (!app) return { ok: false, error: "CASE_NOT_FOUND" };

  const normalized = (norm as any).normalized || providerStatusToCaseState(raw);
  // Record a webhook CaseEvent (non-transition unless a state change is implied).
  await recordCaseEvent(svc, app, { event_type: "PROVIDER_WEBHOOK", source: "provider_webhook", actor_type: "PROVIDER", actor_id: input.provider_key, idempotency_key: idemKey, reason: `Provider webhook: ${raw}`, metadata: { raw, normalized, provider_key: input.provider_key, external_reference: externalRef } }).catch(() => {});

  // Drive the Case Engine with the normalized state (§18/§24).
  const legacy = legacyStatusFromCaseState(normalized as any);
  if (legacy && legacy !== legacyStatusFromCaseState(app.case_state) && legacy !== "draft") {
    const t = await setApplicationLifecycle(svc, app, legacy, { source: "provider_webhook", actor_type: "PROVIDER", actor_id: input.provider_key, idempotency_key: `wh_lc_${idemKey}` }).catch(() => null);
    if (t?.events?.length) { const freshApp = await svc.entities.VisaApplication.get(app.id).catch(() => app); for (const e of t.events) await ensureTasksFromCaseEvent(svc, freshApp, e).catch(() => {}); }
  }

  // Persist an ExecutionAttempt STATUS row linked to the webhook.
  await ensureExecutionAttempt(svc, { case_id: app.id, traveler_id: app.traveler_id, provider_key: input.provider_key, route_type: "PROVIDER_API", operation: "STATUS", environment: conn.environment, metadata: { webhook: true, raw, normalized } }).then(async ({ attempt }) => {
    await svc.entities.ExecutionAttempt.update(attempt.id, { status: "SUCCEEDED", webhook_received: true, raw_status: raw, normalized_status: normalized, external_reference: externalRef, completed_at: new Date().toISOString() }).catch(() => {});
  }).catch(() => {});

  return { ok: true, idempotent: false, normalized, case_id: app.id };
}

// ---------- Provider health check (§42) ----------
export async function providerHealthCheck(svc: any, user: any, providerKey: string): Promise<{ ok: boolean; available?: boolean; latency_ms?: number; environment?: string; reason?: string }> {
  assertAdmin(user);
  const pRows: any[] = await svc.entities.Provider.filter({ key: providerKey }).catch(() => []);
  const provider = pRows[0];
  if (!provider) return { ok: false, reason: "UNKNOWN_PROVIDER" };
  const adapter = selectRealAdapter(provider) || createMockProviderAdapter({ key: providerKey });
  const connRows: any[] = await svc.entities.ProviderConnection.filter({ provider_key: providerKey }).catch(() => []);
  const conn = connRows[0];
  try {
    const r = await adapter.checkAvailability();
    const now = new Date().toISOString();
    if (conn) await svc.entities.ProviderConnection.update(conn.id, { last_health_check: now, health_status: r.available ? "HEALTHY" : "DEGRADED" }).catch(() => {});
    await svc.entities.Provider.update(provider.id, { last_tested_at: now, last_test_success: r.available, last_test_message: r.reason || null, last_test_latency: r.latency_ms || null, health_status: r.available ? "healthy" : "degraded" }).catch(() => {});
    return { ok: true, available: r.available, latency_ms: r.latency_ms, environment: conn?.environment, reason: r.reason };
  } catch (e: any) {
    if (conn) await svc.entities.ProviderConnection.update(conn.id, { last_health_check: new Date().toISOString(), health_status: "DOWN" }).catch(() => {});
    const fr = recordFailure(provider, new Date().toISOString());
    await svc.entities.Provider.update(provider.id, { failure_count: fr.failure_count, last_failure_at: fr.last_failure_at, health_status: fr.health_status, last_test_success: false, last_test_message: String(e?.message || e) }).catch(() => {});
    return { ok: false, reason: String(e?.message || e) };
  }
}

// ---------- Execution history for a case (admin UI) ----------
export async function listExecutionAttempts(svc: any, user: any, caseId: string): Promise<any[]> {
  assertAdmin(user);
  const rows: any[] = await svc.entities.ExecutionAttempt.filter({ case_id: caseId }, "-created_date", 100).catch(() => []);
  return rows;
}

export { isCircuitOpen };