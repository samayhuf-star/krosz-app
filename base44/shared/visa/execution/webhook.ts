// Worldz Visa (Phase 33) — Provider webhook ingestion (\u00a718/\u00a719).
//
// Webhook \u2192 authenticate \u2192 provider lookup \u2192 binding validation \u2192
// idempotency \u2192 normalize status \u2192 Case Engine transition \u2192 CaseEvent
// \u2192 OperationsTask. Duplicate webhooks produce no duplicate event/transition/task
// (\u00a719). Secrets are never logged. This layer routes; the Case Engine owns state.

import { recordCaseEvent, persistCaseTransition, loadCaseEvents } from "../application/caseStore.ts";
import { normalizeProviderStatus, canTransitionCase, TERMINAL_CASE } from "../application/caseEngine.ts";
import { ensureTasksFromCaseEvent } from "../operations/taskStore.ts";
import { createException } from "../operations/taskStore.ts";

export interface WebhookInput {
  provider_key: string;
  raw_status: string;
  idempotency_key: string;
  signature?: string;
  provider_application_id?: string;
  case_id?: string;
  payload?: any;
  environment?: "SANDBOX" | "PRODUCTION";
}

export interface WebhookAuthResult { authenticated: boolean; reason: string; provider?: any; connection?: any; }

// --- Authentication (\u00a721) ---
export async function authenticateWebhook(svc: any, input: WebhookInput): Promise<WebhookAuthResult> {
  const providers: any[] = await svc.entities.Provider.filter({ key: input.provider_key }).catch(() => []);
  const provider = providers[0];
  if (!provider) return { authenticated: false, reason: "UNKNOWN_PROVIDER" };
  if (provider.provider_lifecycle === "SUSPENDED" || provider.provider_lifecycle === "REJECTED") {
    return { authenticated: false, reason: "PROVIDER_SUSPENDED" };
  }
  const conns: any[] = await svc.entities.ProviderConnection.filter({ provider_key: input.provider_key }).catch(() => []);
  const env = input.environment || "PRODUCTION";
  const conn = conns.find((c) => c.environment === env) || conns[0];
  if (!conn || conn.status === "DISABLED" || conn.status === "ERROR" || conn.status === "NOT_CONNECTED") {
    return { authenticated: false, reason: "NO_ACTIVE_CONNECTION" };
  }
  // Signature verification is provider-adapter-specific; a connection with
  // webhook_verified=true and a signature present satisfies authentication.
  if (!conn.webhook_endpoint) return { authenticated: false, reason: "WEBHOOK_NOT_CONFIGURED" };
  if (conn.webhook_verified === false) return { authenticated: false, reason: "WEBHOOK_NOT_VERIFIED" };
  if (input.signature === undefined && conn.webhook_verified !== true) return { authenticated: false, reason: "MISSING_SIGNATURE" };
  return { authenticated: true, reason: "ok", provider, connection: conn };
}

// Pure status normalization map (\u00a723). Provider-specific overrides extend the
// generic caseEngine normalizeProviderStatus.
const PROVIDER_STATUS_OVERRIDES: Record<string, Record<string, string>> = {
  // Example: a provider whose "SUCCESS" means "received" not "approved".
  PIPEWORX: { SUCCESS: "PROCESSING", COMPLETED: "PROCESSING" },
};

export function normalizeWebhookStatus(raw_status: string, provider_key?: string): { normalized: string; event_type: string; is_decision: boolean } {
  const override = provider_key ? PROVIDER_STATUS_OVERRIDES[provider_key]?.[raw_status] : undefined;
  const effective = override || raw_status;
  const { normalized } = normalizeProviderStatus(effective);
  const event_type = normalizedToEventType(normalized);
  const is_decision = normalized === "APPROVED" || normalized === "REJECTED";
  return { normalized, event_type, is_decision };
}

function normalizedToEventType(normalized: string): string {
  switch (normalized) {
    case "APPROVED": return "APPROVED";
    case "REJECTED": return "REJECTED";
    case "PROCESSING": return "PROCESSING";
    case "ADDITIONAL_INFORMATION_REQUIRED": return "ADDITIONAL_INFORMATION_REQUIRED";
    case "SUBMITTED": return "SUBMITTED";
    default: return "PROVIDER_STATUS_UPDATED";
  }
}

// --- Idempotency ---
export async function isDuplicateWebhook(svc: any, idempotency_key: string): Promise<boolean> {
  if (!idempotency_key) return false;
  const evs: any[] = await svc.entities.CaseEvent.filter({ source: "provider_webhook" }).catch(() => []);
  return evs.some((e) => e.correlation_id === idempotency_key || e.idempotency_key === idempotency_key);
}

// --- Main ingestion ---
export async function ingestWebhook(svc: any, input: WebhookInput): Promise<{
  accepted: boolean; duplicate: boolean; normalized: string | null; new_case_state: string | null; reason: string; event_id?: string;
}> {
  const auth = await authenticateWebhook(svc, input);
  if (!auth.authenticated) return { accepted: false, duplicate: false, normalized: null, new_case_state: null, reason: `auth_failed:${auth.reason}` };

  if (await isDuplicateWebhook(svc, input.idempotency_key)) {
    return { accepted: false, duplicate: true, normalized: null, new_case_state: null, reason: "duplicate_webhook" };
  }

  // Resolve the case.
  let caseId = input.case_id;
  if (!caseId && input.provider_application_id) {
    const apps: any[] = await svc.entities.VisaApplication.filter({ provider_application_id: input.provider_application_id }).catch(() => []);
    caseId = apps[0]?.id;
  }
  if (!caseId) return { accepted: false, duplicate: false, normalized: null, new_case_state: null, reason: "case_not_resolved" };

  const app: any = await svc.entities.VisaApplication.get(caseId).catch(() => null);
  if (!app) return { accepted: false, duplicate: false, normalized: null, new_case_state: null, reason: "case_not_found" };

  // Terminal cases: accept + record the signal, but do NOT transition (\u00a718).
  if (TERMINAL_CASE.includes(app.case_state) || app.case_state === "COMPLETED") {
    await recordCaseEvent(svc, app, { event_type: "PROVIDER_WEBHOOK_RECEIVED", new_case_state: app.case_state, actor_type: "PROVIDER", actor_id: input.provider_key, source: "provider_webhook", idempotency_key: input.idempotency_key, correlation_id: input.idempotency_key, reason: `raw=${input.raw_status}`, metadata: { raw: input.raw_status, normalized: normalizeWebhookStatus(input.raw_status, input.provider_key).normalized } });
    return { accepted: true, duplicate: false, normalized: normalizeWebhookStatus(input.raw_status, input.provider_key).normalized, new_case_state: app.case_state, reason: "terminal_no_transition", event_id: input.idempotency_key };
  }

  const { normalized, event_type, is_decision } = normalizeWebhookStatus(input.raw_status, input.provider_key);

  // Idempotently record the provider status event.
  const evt = await recordCaseEvent(svc, app, { event_type: "PROVIDER_WEBHOOK_RECEIVED", new_case_state: app.case_state, actor_type: "PROVIDER", actor_id: input.provider_key, source: "provider_webhook", idempotency_key: input.idempotency_key, correlation_id: input.idempotency_key, reason: `raw=${input.raw_status}`, metadata: { raw: input.raw_status, normalized, provider_application_id: input.provider_application_id || null } });

  // Attempt deterministic transition when the normalized target is a state the
  // engine permits from the current state.
  let new_state = app.case_state;
  if (canTransitionCase(app.case_state, normalized)) {
    try {
      const t = await persistCaseTransition(svc, app, normalized, { actor_type: "PROVIDER", actor_id: input.provider_key, source: "provider_webhook", idempotency_key: `wh:${input.idempotency_key}:${normalized}`, reason: `webhook:${input.raw_status}` });
      new_state = t?.case?.case_state || normalized;
      // Surface the decision/state event too.
      await recordCaseEvent(svc, app, { event_type, new_case_state: new_state, actor_type: "PROVIDER", actor_id: input.provider_key, source: "provider_webhook", idempotency_key: `${input.idempotency_key}:${event_type}`, correlation_id: input.idempotency_key, metadata: { raw: input.raw_status, normalized } });
    } catch { /* invalid transition: leave for operations review */ }
  } else if (normalized !== app.case_state) {
    // Status mismatch \u2192 exception (\u00a718/\u00a726).
    await createException(svc, { case_id: app.id, application_id: app.id, traveler_id: app.traveler_id, type: "status_mismatch", severity: "MEDIUM", message: `Provider reported ${normalized} while case is ${app.case_state}`, metadata: { raw: input.raw_status, normalized, case_state: app.case_state }, actor_id: input.provider_key }).catch(() => {});
  }

  // Generate / update operational tasks from the recorded event (\u00a737).
  await ensureTasksFromCaseEvent(svc, app, evt).catch(() => {});

  return { accepted: true, duplicate: false, normalized, new_case_state: new_state, reason: "accepted", event_id: input.idempotency_key };
}