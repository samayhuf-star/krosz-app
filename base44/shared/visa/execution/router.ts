// Worldz Visa (Phase 33) — Execution Router.
//
// PURE (no DB, no network). The single deterministic answer to "How can this
// exact visa case be executed?" (\u00a744). Derives a route from:
//   country \u00d7 journey \u00d7 nationality \u00d7 execution_capability
//   \u00d7 provider binding \u00d7 capability \u00d7 verification \u00d7 environment
//   \u00d7 commercial authorization \u00d7 connection \u00d7 circuit health.
//
// NEVER from provider name alone (\u00a75). NEVER selects DISCOVERED/RESEARCHING/
// SANDBOX/FAILED for production submission (\u00a77/\u00a711). No fake execution:
// when nothing verified exists it returns EXECUTION_UNAVAILABLE (\u00a78), not a
// fabricated provider application id or status.
//
// This is NOT a second submission engine. It routes; the existing execution/
// submission engines perform the work. The Case Engine remains authoritative
// for application lifecycle (\u00a715).

export type RouteType =
  | "PROVIDER_API"
  | "GOVERNMENT_API"
  | "PORTAL_AUTOMATION"
  | "HUMAN_OPERATIONS"
  | "GUIDANCE"
  | "EXECUTION_UNAVAILABLE";

export type ExecutionCapability =
  | "GUIDANCE_ONLY" | "INTELLIGENCE_ONLY" | "PARTIAL_ASSIST"
  | "APPLICATION_ASSIST" | "END_TO_END" | "DOCUMENT_ASSIST" | "UNKNOWN";

export type Operation = "SUBMISSION" | "STATUS" | "TRACKING" | "DOCUMENTS" | "CANCELLATION" | "REFUND";

export interface RouteInput {
  country: string;
  nationality: string;
  journey: string;
  purpose?: string;
  execution_capability: ExecutionCapability;
  case_route_status?: string;
  bindings: any[];
  providers: Record<string, any>;
  connections: any[];
  portals?: any[];
  environment?: "SANDBOX" | "PRODUCTION";
  requested_operation?: Operation;
}

export interface ExecutionRoute {
  route_type: RouteType;
  provider: string | null;
  provider_binding: string | null;
  capabilities: Record<string, string> | null;
  environment: "SANDBOX" | "PRODUCTION" | null;
  submission_available: boolean;
  tracking_available: boolean;
  requires_human_review: boolean;
  fallback_route: ExecutionRoute | null;
  reason: string;
}

const OP_CAPABILITY_FIELD: Record<Operation, string> = {
  SUBMISSION: "submission",
  STATUS: "status",
  TRACKING: "tracking",
  DOCUMENTS: "documents",
  CANCELLATION: "cancellation",
  REFUND: "refund",
};

// --- Provider usability predicate (\u00a77/\u00a711/\u00a716) ---
export interface UsabilityResult { usable: boolean; reason: string | null; missing: string[]; }

export function providerUsable(
  provider: any,
  binding: any,
  connection: any,
  environment: "SANDBOX" | "PRODUCTION",
  operation: Operation,
): UsabilityResult {
  const missing: string[] = [];
  if (!provider) return { usable: false, reason: "NO_PROVIDER", missing: ["provider"] };

  // Lifecycle gate (\u00a77): DISCOVERED/RESEARCHING/SANDBOX/REJECTED never usable for prod.
  const lc = provider.provider_lifecycle;
  if (lc === "DISCOVERED" || lc === "RESEARCHING" || lc === "REJECTED" || lc === "SUSPENDED") {
    return { usable: false, reason: `PROVIDER_LIFECYCLE_${lc}`, missing: ["provider_lifecycle"] };
  }
  if (environment === "PRODUCTION" && lc !== "PRODUCTION" && lc !== "VERIFIED") {
    missing.push("provider_lifecycle_not_production");
  }

  // Capability verification gate (\u00a74/\u00a711): the SPECIFIC capability must be VERIFIED.
  const capField = OP_CAPABILITY_FIELD[operation];
  const capVer = provider.capability_verification?.[capField];
  if (capVer && capVer !== "VERIFIED") {
    return { usable: false, reason: `CAPABILITY_NOT_VERIFIED:${capField}`, missing: [`capability_verification.${capField}`] };
  }

  if (!binding) return { usable: false, reason: "NO_BINDING", missing: ["binding"] };

  // Binding capability (\u00a74).
  const bCap = binding.capability?.[capField];
  if (bCap && bCap !== "YES" && bCap !== "PARTIAL") {
    return { usable: false, reason: `CAPABILITY_NOT_SUPPORTED:${capField}`, missing: [`capability.${capField}`] };
  }

  // Binding verification (\u00a733).
  if (binding.verification_status && binding.verification_status !== "VERIFIED") {
    return { usable: false, reason: `BINDING_${binding.verification_status}`, missing: ["binding.verification_status"] };
  }
  if (binding.status === "SUSPENDED" || binding.status === "RESEARCHING") {
    return { usable: false, reason: `BINDING_${binding.status}`, missing: ["binding.status"] };
  }

  // API + commercial authorization gates (\u00a710/\u00a716) for operations needing API.
  if (operation === "SUBMISSION" || operation === "STATUS" || operation === "TRACKING" || operation === "DOCUMENTS") {
    if (binding.our_api_access && binding.our_api_access !== "YES") {
      missing.push("our_api_access");
    }
  }
  if (operation === "SUBMISSION") {
    if (binding.our_commercial_authorized && binding.our_commercial_authorized !== "YES") {
      missing.push("our_commercial_authorized");
    }
    if (binding.our_active === false) missing.push("our_active");
  }

  // Connection gate (\u00a711).
  if (connection) {
    if (connection.status === "ERROR" || connection.status === "DISABLED" || connection.status === "NOT_CONNECTED") {
      return { usable: false, reason: `CONNECTION_${connection.status}`, missing: ["connection.status"] };
    }
    if (environment === "PRODUCTION" && connection.environment === "SANDBOX") {
      missing.push("connection_environment_mismatch");
    }
    if (connection.health_status === "DOWN") {
      return { usable: false, reason: "CONNECTION_DOWN", missing: ["connection.health_status"] };
    }
  }

  // Circuit breaker (\u00a722).
  if (provider.health_status === "down") {
    return { usable: false, reason: "CIRCUIT_OPEN", missing: ["provider.health_status"] };
  }
  if (Number(provider.failure_count || 0) >= 5) {
    return { usable: false, reason: "CIRCUIT_OPEN_FAILURE_RATE", missing: ["provider.failure_count"] };
  }

  return { usable: missing.length === 0, reason: missing.length ? `MISSING:${missing.join(",")}` : null, missing };
}

function matchesBindingScope(binding: any, input: RouteInput): boolean {
  if (binding.country_code !== input.country) return false;
  if (binding.journey_type !== input.journey && binding.journey_type !== "ANY") return false;
  if (binding.nationality && binding.nationality !== input.nationality && binding.nationality !== "ANY") return false;
  return true;
}

function routeTypeForBinding(provider: any, binding: any, portals: any[]): RouteType {
  if (provider.provider_type === "GOVERNMENT_OFFICIAL" || provider.category === "government_official") return "GOVERNMENT_API";
  // Portal automation if a supported portal exists for this country/journey with automation allowed.
  const portal = portals.find((p: any) => p?.country === binding.country_code && p.automation_allowed && p.execution_strategy === "BROWSER_AUTOMATION");
  if (portal) return "PORTAL_AUTOMATION";
  return "PROVIDER_API";
}

function sortPreference(provider: any, routeType: RouteType): number {
  // Lower = preferred.
  const lcPref = provider.provider_lifecycle === "PRODUCTION" ? 0 : provider.provider_lifecycle === "VERIFIED" ? 1 : 2;
  const rtPref = routeType === "PROVIDER_API" ? 0 : routeType === "GOVERNMENT_API" ? 1 : routeType === "PORTAL_AUTOMATION" ? 2 : 3;
  return lcPref * 10 + rtPref;
}

function buildGuidanceRoute(reason: string): ExecutionRoute {
  return {
    route_type: "GUIDANCE", provider: null, provider_binding: null, capabilities: null,
    environment: null, submission_available: false, tracking_available: false,
    requires_human_review: false, fallback_route: null, reason,
  };
}

function buildUnavailableRoute(reason: string): ExecutionRoute {
  return {
    route_type: "EXECUTION_UNAVAILABLE", provider: null, provider_binding: null, capabilities: null,
    environment: null, submission_available: false, tracking_available: false,
    requires_human_review: false, fallback_route: null, reason,
  };
}

function connectionFor(connections: any[], providerKey: string, env: "SANDBOX"|"PRODUCTION"): any {
  // Prefer an exact environment match; fall back to any connection for this
  // provider so the env-mismatch gate in providerUsable still fires (\u00a711).
  const exact = connections.find((c: any) => c.provider_key === providerKey && (!c.environment || c.environment === env));
  if (exact) return exact;
  return connections.find((c: any) => c.provider_key === providerKey) || null;
}

// --- Main resolver ---
export function resolveExecutionRoute(input: RouteInput): ExecutionRoute {
  const env = input.environment || "PRODUCTION";
  const op: Operation = input.requested_operation || "SUBMISSION";

  // \u00a78 no-fake: explicit blocked route statuses force unavailable (unless guidance-only).
  if (input.case_route_status === "BLOCKED" || input.case_route_status === "PROVIDER_UNVERIFIED" && input.execution_capability === "UNKNOWN") {
    return buildUnavailableRoute(`case_route_status=${input.case_route_status}`);
  }

  // Guidance / intelligence-only journeys never submit (\u00a75/\u00a716).
  if (input.execution_capability === "GUIDANCE_ONLY" || input.execution_capability === "INTELLIGENCE_ONLY") {
    return buildGuidanceRoute(`execution_capability_${input.execution_capability}`);
  }

  // Find a usable submission-capable binding (priority order).
  const candidates = (input.bindings || [])
    .filter((b: any) => matchesBindingScope(b, input))
    .filter((b: any) => b.role === "application" || b.role === "submission" || b.role === "operations")
    .map((b: any) => {
      const provider = input.providers[b.provider_key];
      const connection = connectionFor(input.connections || [], b.provider_key, env);
      const u = providerUsable(provider, b, connection, env, op);
      const routeType = b.role === "operations" ? "HUMAN_OPERATIONS" : routeTypeForBinding(provider, b, input.portals || []);
      return { binding: b, provider, connection, usable: u.usable, reason: u.reason, routeType, pref: sortPreference(provider, routeType) };
    })
    .sort((a: any, b: any) => a.pref - b.pref);

  const primary = candidates.find((c: any) => c.usable);

  if (!primary) {
    // PARTIAL_ASSIST or APPLICATION_ASSIST without a verified API route → human operations if available, else unavailable.
    const humanOps = candidates.find((c: any) => c.routeType === "HUMAN_OPERATIONS" && c.provider && (c.provider.provider_lifecycle === "PRODUCTION" || c.provider.provider_lifecycle === "VERIFIED") && c.provider.capability_verification?.human_operations !== "REJECTED");
    if (humanOps && (input.execution_capability === "PARTIAL_ASSIST" || input.execution_capability === "APPLICATION_ASSIST")) {
      return {
        route_type: "HUMAN_OPERATIONS", provider: humanOps.provider?.key || null, provider_binding: humanOps.binding?.id || null,
        capabilities: humanOps.binding?.capability || null, environment: env, submission_available: true,
        tracking_available: false, requires_human_review: true, fallback_route: null,
        reason: "human_operations_required_review",
      };
    }
    if (input.execution_capability === "UNKNOWN") return buildUnavailableRoute("no_verified_route");
    return buildUnavailableRoute(primary === undefined ? "no_usable_binding" : (candidates[0]?.reason || "no_usable_binding"));
  }

  const requires_human_review =
    input.execution_capability === "PARTIAL_ASSIST" ||
    primary.routeType === "PORTAL_AUTOMATION" ||
    (input.execution_capability === "APPLICATION_ASSIST");

  const trackingRoute = computeTrackingRoute(input, env, primary.provider?.key);
  const fallback = computeFallbackRoute(input, env, primary.provider?.key, op);

  return {
    route_type: primary.routeType,
    provider: primary.provider?.key || null,
    provider_binding: primary.binding?.id || null,
    capabilities: primary.binding?.capability || null,
    environment: env,
    submission_available: op === "SUBMISSION",
    tracking_available: !!trackingRoute,
    requires_human_review,
    fallback_route: fallback,
    reason: `selected:${primary.provider?.key}:${primary.routeType}`,
  };
}

function computeTrackingRoute(input: RouteInput, env: "SANDBOX"|"PRODUCTION", excludeProvider?: string): any | null {
  const tracking = (input.bindings || [])
    .filter((b: any) => matchesBindingScope(b, input) && (b.role === "tracking" || b.role === "operations"))
    .filter((b: any) => b.provider_key !== excludeProvider)
    .map((b: any) => {
      const provider = input.providers[b.provider_key];
      const connection = connectionFor(input.connections || [], b.provider_key, env);
      return { binding: b, provider, connection, u: providerUsable(provider, b, connection, env, "TRACKING") };
    })
    .find((c: any) => c.u.usable);
  if (!tracking) return null;
  return { provider: tracking.provider?.key || null, binding: tracking.binding?.id || null };
}

function computeFallbackRoute(input: RouteInput, env: "SANDBOX"|"PRODUCTION", excludeProvider: string | undefined, op: Operation): ExecutionRoute | null {
  const fallback = (input.bindings || [])
    .filter((b: any) => matchesBindingScope(b, input) && (b.role === "application" || b.role === "submission" || b.role === "operations"))
    .filter((b: any) => b.provider_key !== excludeProvider)
    .map((b: any) => {
      const provider = input.providers[b.provider_key];
      const connection = connectionFor(input.connections || [], b.provider_key, env);
      const u = providerUsable(provider, b, connection, env, op);
      const routeType = b.role === "operations" ? "HUMAN_OPERATIONS" : routeTypeForBinding(provider, b, input.portals || []);
      return { binding: b, provider, connection, usable: u.usable, routeType, pref: sortPreference(provider, routeType) };
    })
    .sort((a: any, b: any) => a.pref - b.pref)
    .find((c: any) => c.usable);
  if (!fallback) return null;
  return {
    route_type: fallback.routeType, provider: fallback.provider?.key || null, provider_binding: fallback.binding?.id || null,
    capabilities: fallback.binding?.capability || null, environment: env, submission_available: op === "SUBMISSION",
    tracking_available: !!computeTrackingRoute(input, env, fallback.provider?.key), requires_human_review: fallback.routeType === "PORTAL_AUTOMATION",
    fallback_route: null, reason: `fallback:${fallback.provider?.key}`,
  };
}

// Honest projection for traveler-facing UI (\u00a726/\u00a727).
export function travelerRouteProjection(route: ExecutionRoute): {
  route_label: string;
  submission_available: boolean;
  tracking_available: boolean;
  official_portal_url?: string;
} {
  if (route.route_type === "GUIDANCE") return { route_label: "Guidance only", submission_available: false, tracking_available: false };
  if (route.route_type === "EXECUTION_UNAVAILABLE") return { route_label: "Submission unavailable through this route", submission_available: false, tracking_available: false };
  return {
    route_label: route.route_type === "PROVIDER_API" ? "Verified partner submission"
      : route.route_type === "GOVERNMENT_API" ? "Government API submission"
      : route.route_type === "PORTAL_AUTOMATION" ? "Guided portal submission"
      : "Human-assisted submission",
    submission_available: route.submission_available,
    tracking_available: route.tracking_available,
  };
}

// Provider capability inventory row (\u00a72) — admin projection.
export function providerInventoryRow(provider: any, connection: any): {
  provider_key: string;
  name: string;
  lifecycle: string;
  environment: string;
  connection_status: string;
  health: string;
  capabilities: Record<string, string>;
  submission_verified: boolean;
  ready: boolean;
  reason: string;
} {
  const cv = provider?.capability_verification || {};
  const submissionVerified = cv.submission === "VERIFIED";
  const connStatus = connection?.status || "NOT_CONNECTED";
  const ready = !!provider && (provider.provider_lifecycle === "PRODUCTION" || provider.provider_lifecycle === "VERIFIED") && connStatus === "CONNECTED" && submissionVerified && provider.health_status !== "down";
  return {
    provider_key: provider?.key || "",
    name: provider?.name || provider?.key || "",
    lifecycle: provider?.provider_lifecycle || "DISCOVERED",
    environment: connection?.environment || "SANDBOX",
    connection_status: connStatus,
    health: provider?.health_status || "unknown",
    capability_availability: cv,
    submission_verified: submissionVerified,
    ready,
    reason: ready ? "ready" : `lifecycle=${provider?.provider_lifecycle},connection=${connStatus},submission_verified=${submissionVerified}`,
  };
}