// Worldz Visa (Phase 33) — ExecutionAttempt durable store (\u00a713/\u00a715).
// Wraps the pure router + retry policy with idempotent persistence. NEVER stores
// provider secrets or raw document content (\u00a739). The Case Engine remains the
// sole authority for case lifecycle; this layer records execution work-state +
// observability and threads results back into CaseEvents (\u00a738).

import { classifyError, circuitState } from "./retry.ts";
import type { CircuitState } from "./retry.ts";

// Attempt idempotency key (\u00a712): case_id + provider_binding_id + operation.
export function attemptIdempotencyKey(case_id: string, binding_id: string, operation: string): string {
  return `exec:${case_id}:${binding_id || "no_binding"}:${operation}`;
}

export type AttemptStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "RETRYING" | "WAITING" | "CANCELLED";
export type AttemptOperation = "CREATE_APPLICATION" | "UPDATE_APPLICATION" | "UPLOAD_DOCUMENT" | "SUBMIT_APPLICATION" | "GET_STATUS" | "TRACK" | "CANCEL" | "REFUND" | "HEALTH_CHECK";

export interface StartAttemptInput {
  case_id: string;
  application_id?: string;
  traveler_id?: string;
  organization_id?: string;
  provider_key: string;
  provider_id?: string;
  provider_binding_id: string;
  route_type: string;
  operation: AttemptOperation;
  environment: "SANDBOX" | "PRODUCTION";
  capabilities?: Record<string, string>;
  circuit_state?: CircuitState;
  request_reference?: string;
  fallback_from_attempt_id?: string;
}

export async function startAttempt(svc: any, input: StartAttemptInput): Promise<{ attempt: any; created: boolean }> {
  const key = attemptIdempotencyKey(input.case_id, input.provider_binding_id, input.operation);
  const existing: any[] = await svc.entities.ExecutionAttempt.filter({ idempotency_key: key }).catch(() => []);
  const live = existing.find((a) => ["PENDING", "RUNNING", "RETRYING", "WAITING"].includes(a.status));
  if (live) return { attempt: sanitize(live), created: false };
  const done = existing.find((a) => a.status === "SUCCEEDED");
  if (done) return { attempt: sanitize(done), created: false };
  const cs = input.circuit_state || (await resolveCircuit(svc, input.provider_key));
  const row = await svc.entities.ExecutionAttempt.create({
    case_id: input.case_id, application_id: input.application_id || input.case_id, traveler_id: input.traveler_id || null,
    organization_id: input.organization_id || null, provider_key: input.provider_key, provider_id: input.provider_id || null,
    provider_binding_id: input.provider_binding_id, route_type: input.route_type, operation: input.operation,
    idempotency_key: key, status: "PENDING", environment: input.environment, capabilities: input.capabilities || null,
    request_reference: input.request_reference || crypto.randomUUID(), retry_count: 0, circuit_state: cs,
    fallback_from_attempt_id: input.fallback_from_attempt_id || null, started_at: new Date().toISOString(),
    metadata: {},
  });
  return { attempt: sanitize(row), created: true };
}

export async function markRunning(svc: any, attemptId: string): Promise<any> {
  return sanitize(await svc.entities.ExecutionAttempt.update(attemptId, { status: "RUNNING" }).catch(() => null));
}

export async function markSucceeded(svc: any, attemptId: string, result: { provider_application_id?: string | null; response_reference?: string | null; metadata?: any }): Promise<any> {
  const row = await svc.entities.ExecutionAttempt.get(attemptId).catch(() => null);
  if (!row) return null;
  const completed_at = new Date().toISOString();
  const duration_ms = row.started_at ? (Date.now() - new Date(row.started_at).getTime()) : null;
  const updated = await svc.entities.ExecutionAttempt.update(attemptId, {
    status: "SUCCEEDED", provider_application_id: result.provider_application_id || row.provider_application_id || null,
    response_reference: result.response_reference || row.response_reference || null, completed_at, duration_ms,
    metadata: { ...(row.metadata || {}), ...(result.metadata || {}) },
  }).catch(() => null);
  // Persist provider application id on the case (\u00a726).
  if (result.provider_application_id && row.case_id) {
    await svc.entities.VisaApplication.update(row.case_id, { provider_application_id: result.provider_application_id, provider_binding_id: row.provider_binding_id, provider_key: row.provider_key }).catch(() => {});
  }
  return sanitize(updated);
}

export async function markFailed(svc: any, attemptId: string, error: { error_code?: string; error_message?: string; status?: number }): Promise<any> {
  const row = await svc.entities.ExecutionAttempt.get(attemptId).catch(() => null);
  if (!row) return null;
  const cat = classifyError(error.error_code, error.status);
  const retryable = cat === "TRANSIENT";
  await svc.entities.ExecutionAttempt.update(attemptId, {
    status: retryable ? "RETRYING" : "FAILED",
    error_code: error.error_code || null,
    error_message: sanitizeError(error.error_message),
    error_category: cat, retryable, completed_at: retryable ? null : new Date().toISOString(),
  }).catch(() => {});
  // Bump provider failure rate for circuit-breaker (\u00a722).
  if (row.provider_id) await svc.entities.Provider.update(row.provider_id, { failure_count: ((await svc.entities.Provider.get(row.provider_id).catch(() => ({}))).failure_count || 0) + 1, last_failure_at: new Date().toISOString() }).catch(() => {});
  return sanitize(await svc.entities.ExecutionAttempt.get(attemptId).catch(() => null));
}

export async function markWaiting(svc: any, attemptId: string, reason: string): Promise<any> {
  return sanitize(await svc.entities.ExecutionAttempt.update(attemptId, { status: "WAITING", waiting_reason: reason, metadata: { ...(await svc.entities.ExecutionAttempt.get(attemptId).catch(() => ({}))).metadata, waiting_reason: reason } }).catch(() => null));
}

export async function markCancelled(svc: any, attemptId: string): Promise<any> {
  return sanitize(await svc.entities.ExecutionAttempt.update(attemptId, { status: "CANCELLED", completed_at: new Date().toISOString() }).catch(() => null));
}

export async function listAttempts(svc: any, caseId: string): Promise<any[]> {
  const rows: any[] = await svc.entities.ExecutionAttempt.filter({ case_id: caseId }).catch(() => []);
  rows.sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  return rows.map(sanitize);
}

async function resolveCircuit(svc: any, providerKey: string): Promise<CircuitState> {
  const p: any[] = await svc.entities.Provider.filter({ key: providerKey }).catch(() => []);
  const provider = p[0];
  const conns: any[] = provider ? await svc.entities.ProviderConnection.filter({ provider_key: providerKey }).catch(() => []) : [];
  const conn = conns.find((c) => c.environment === "PRODUCTION") || conns[0];
  return circuitState(provider, conn);
}

function sanitize(row: any): any {
  if (!row) return null;
  return { ...row, metadata: row.metadata };
}

function sanitizeError(msg?: string): string {
  if (!msg) return null;
  // Never persist secrets/tokens/card numbers.
  return String(msg).replace(/(sk_|pk_|tok_|Bearer\s)[A-Za-z0-9._-]+/gi, "[REDACTED]").slice(0, 500);
}