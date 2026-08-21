// Worldz Visa (Phase 33) — Provider health check (\u00a742). PURE projection of
// provider/connection/adapter-health signals. Connectivity is NEVER interpreted
// as submission capability (\u00a742/\u00a74). Adapter invocation stays with the durable
// store/backend; this module classifies the result honestly.

export interface HealthInput {
  provider: any;
  connection: any;
  adapterHealth?: { connectivity?: string; authentication?: string; latency_ms?: number; status?: string; last_success?: string } | null;
}

export interface CapabilityAvailability { [cap: string]: "YES" | "NO" | "UNKNOWN"; }

export interface HealthResult {
  provider_key: string;
  environment: "SANDBOX" | "PRODUCTION" | null;
  connectivity: "CONNECTED" | "DEGRADED" | "DOWN" | "UNKNOWN";
  authentication: "OK" | "FAILED" | "UNKNOWN";
  capability_availability: CapabilityAvailability;
  latency_ms: number | null;
  last_success: string | null;
  submission_capable: boolean;
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  reason: string;
}

function capAv(provider: any): CapabilityAvailability {
  const cv = provider?.capability_verification || {};
  const out: CapabilityAvailability = {};
  for (const k of ["eligibility","requirements","application","documents","payment","submission","status","tracking","refund","cancellation","notifications"]) {
    out[k] = cv[k] === "VERIFIED" ? "YES" : cv[k] === "REJECTED" ? "NO" : "UNKNOWN";
  }
  return out;
}

export function evaluateHealth(input: HealthInput): HealthResult {
  const provider = input.provider;
  const connection = input.connection;
  const ah = input.adapterHealth || {};
  const cv = provider?.capability_verification || {};

  const connectivity: HealthResult["connectivity"] =
    ah.connectivity === "OK" && connection?.status !== "ERROR" && connection?.status !== "DISABLED" && provider?.health_status !== "down" ? "CONNECTED"
    : (ah.connectivity === "DEGRADED" || connection?.health_status === "DEGRADED" || provider?.health_status === "degraded" ? "DEGRADED"
    : (ah.connectivity === "DOWN" || connection?.health_status === "DOWN" || provider?.health_status === "down" ? "DOWN" : "UNKNOWN"));

  const authentication: HealthResult["authentication"] =
    ah.authentication === "OK" ? "OK" : ah.authentication === "FAILED" ? "FAILED" : (connection?.status === "CONNECTED" && ah.connectivity === "OK" ? "OK" : "UNKNOWN");

  const submission_capable =
    !!provider && (provider.provider_lifecycle === "PRODUCTION" || provider.provider_lifecycle === "VERIFIED")
    && cv.submission === "VERIFIED"
    && connection?.status === "CONNECTED"
    && connectivity !== "DOWN"
    && (connection?.environment !== "SANDBOX" || false); // sandbox never production-capable

  let status: HealthResult["status"] = "UNKNOWN";
  if (connectivity === "DOWN" || authentication === "FAILED") status = "DOWN";
  else if (connectivity === "DEGRADED" || authentication === "UNKNOWN") status = "DEGRADED";
  else if (connectivity === "CONNECTED" && authentication === "OK") status = "HEALTHY";

  const reason = submission_capable ? "submission_capable"
    : connectivity === "DOWN" ? "connectivity_down"
    : connectivity === "DEGRADED" ? "connectivity_degraded"
    : authentication === "FAILED" ? "auth_failed"
    : cv.submission !== "VERIFIED" ? "submission_not_verified"
    : connection?.status !== "CONNECTED" ? `connection_${connection?.status || "none"}`
    : "not_submission_capable";

  return {
    provider_key: provider?.key || "",
    environment: connection?.environment || (provider?.environment === "production" ? "PRODUCTION" : "SANDBOX"),
    connectivity, authentication,
    capability_availability: capAv(provider),
    latency_ms: ah.latency_ms ?? null,
    last_success: ah.last_success || connection?.last_health_check || null,
    submission_capable,
    status,
    reason,
  };
}

// Aggregated provider health summary for the admin matrix (\u00a735). Pure over rows.
export function aggregateHealth(rows: HealthResult[]): {
  total: number; healthy: number; degraded: number; down: number; unknown: number; submission_capable: number;
} {
  return {
    total: rows.length,
    healthy: rows.filter((r) => r.status === "HEALTHY").length,
    degraded: rows.filter((r) => r.status === "DEGRADED").length,
    down: rows.filter((r) => r.status === "DOWN").length,
    unknown: rows.filter((r) => r.status === "UNKNOWN").length,
    submission_capable: rows.filter((r) => r.submission_capable).length,
  };
}