// Worldz Visa (Phase 33) — Retry policy + failure classification (\u00a721/\u00a722).
// PURE. Transient failures are retried (max 3, idempotency preserved). Permanent
// failures are never retried. Credentials/validation/rejected/unsupported are
// always permanent. Circuit-breaker state is derived from provider health/failures.

export const MAX_RETRIES = 3;

const TRANSIENT_CODES = new Set([
  "TIMEOUT", "RATE_LIMITED", "NETWORK_ERROR", "PROVIDER_5XX", "TRANSIENT",
  "CONNECTION_RESET", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT",
]);
const PERMANENT_CODES = new Set([
  "UNAUTHORIZED", "INVALID_CREDENTIALS", "VALIDATION_ERROR", "REJECTED",
  "UNSUPPORTED_CAPABILITY", "CAPABILITY_NOT_SUPPORTED", "POLICY_VIOLATION",
  "PERMANENT", "BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONSENT_REQUIRED",
]);

export type ErrorCategory = "TRANSIENT" | "PERMANENT" | "HUMAN_REQUIRED" | "UNKNOWN";

export function isTransient(error_code?: string, status?: number): boolean {
  if (error_code && PERMANENT_CODES.has(error_code)) return false;
  if (error_code && TRANSIENT_CODES.has(error_code)) return true;
  if (!error_code && status) {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }
  return false;
}

export function isPermanent(error_code?: string): boolean {
  if (!error_code) return false;
  return PERMANENT_CODES.has(error_code);
}

export function isHumanRequired(error_code?: string): boolean {
  if (!error_code) return false;
  return ["OTP_REQUIRED", "CAPTCHA_REQUIRED", "LOGIN_REQUIRED", "WORKFLOW_DRIFT", "PORTAL_SCHEMA_CHANGED", "HUMAN_REQUIRED", "UNKNOWN_EXTERNAL_STATE"].includes(error_code);
}

export function classifyError(error_code?: string, status?: number): ErrorCategory {
  if (isHumanRequired(error_code)) return "HUMAN_REQUIRED";
  if (isPermanent(error_code)) return "PERMANENT";
  if (isTransient(error_code, status)) return "TRANSIENT";
  return "UNKNOWN";
}

export interface RetryDecision { retry: boolean; reason: string; delay_ms: number; next_attempt: number; }

export function shouldRetry(attempt: { retry_count?: number; status?: string }, error_code?: string, status?: number): RetryDecision {
  const count = Number(attempt?.retry_count || 0);
  if (attempt?.status === "SUCCEEDED" || attempt?.status === "CANCELLED") {
    return { retry: false, reason: "terminal", delay_ms: 0, next_attempt: count };
  }
  if (count >= MAX_RETRIES) return { retry: false, reason: "max_retries", delay_ms: 0, next_attempt: count };
  const cat = classifyError(error_code, status);
  if (cat === "PERMANENT") return { retry: false, reason: "permanent_failure", delay_ms: 0, next_attempt: count };
  if (cat === "HUMAN_REQUIRED") return { retry: false, reason: "human_required", delay_ms: 0, next_attempt: count };
  if (cat === "TRANSIENT") {
    const delay = Math.min(30000, 1000 * Math.pow(2, count)); // exponential capped 30s
    return { retry: true, reason: "transient", delay_ms: delay, next_attempt: count + 1 };
  }
  // UNKNOWN — fail safe: do not retry ambiguous failures automatically.
  return { retry: false, reason: "unknown_no_retry_fail_safe", delay_ms: 0, next_attempt: count };
}

export function nextRetryDelay(retryCount: number): number {
  return Math.min(30000, 1000 * Math.pow(2, Math.max(0, retryCount)));
}

// Circuit-breaker (\u00a722).
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export function circuitState(provider?: { health_status?: string; failure_count?: number; enabled?: boolean }, connection?: { health_status?: string; status?: string }): CircuitState {
  if (provider?.enabled === false) return "OPEN";
  if (connection?.status === "DISABLED" || connection?.status === "ERROR") return "OPEN";
  if (provider?.health_status === "down" || connection?.health_status === "DOWN") return "OPEN";
  if (Number(provider?.failure_count || 0) >= 5) return "OPEN";
  if (Number(provider?.failure_count || 0) >= 3) return "HALF_OPEN";
  return "CLOSED";
}

export function isCircuitOpen(provider?: { health_status?: string; failure_count?: number; enabled?: boolean }, connection?: { health_status?: string; status?: string }): boolean {
  return circuitState(provider, connection) === "OPEN";
}

// ErrorClass is the legacy alias for ErrorCategory used by executionStore.
export type ErrorClass = ErrorCategory;

// Circuit-breaker recorders (§22). Used by executionStore to update Provider
// failure_count + health_status after a real adapter success/failure.
export function recordSuccess(provider: { failure_count?: number; health_status?: string }): { failure_count: number; health_status: string } {
  const fc = Math.max(0, Number(provider?.failure_count || 0) - 1);
  return { failure_count: fc, health_status: fc === 0 ? "healthy" : "degraded" };
}

export function recordFailure(provider: { failure_count?: number; health_status?: string; last_failure_at?: string }, now: string): { failure_count: number; last_failure_at: string; health_status: string } {
  const fc = Number(provider?.failure_count || 0) + 1;
  const health: string = fc >= 5 ? "down" : fc >= 3 ? "degraded" : "healthy";
  return { failure_count: fc, last_failure_at: now, health_status: health };
}

// Fallback decision (\u00a723): never silently switch to unverified provider or one
// that changes price/consent/authorization.
export function canFallbackTo(primaryRoute: { provider?: string | null }, fallbackRoute: { provider?: string | null; route_type?: string }, consentDelta: boolean): { allowed: boolean; reason: string } {
  if (!fallbackRoute || !fallbackRoute.provider) return { allowed: false, reason: "no_fallback" };
  if (consentDelta) return { allowed: false, reason: "consent_or_price_change_requires_review" };
  if (fallbackRoute.route_type === "GUIDANCE" || fallbackRoute.route_type === "EXECUTION_UNAVAILABLE") return { allowed: false, reason: "fallback_not_executable" };
  return { allowed: true, reason: "verified_fallback_available" };
}