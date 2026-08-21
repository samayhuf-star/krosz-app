// Worldz Visa (Phase 8) — SubmissionProviderResolver.
//
// DETERMINISTIC provider selection (§6-§9). Inputs: destination, visa_type_key,
// purpose, channel → SubmissionRoute (admin-configured) → the bound Provider.
// Priority is an explicit numeric column on the route (lower = higher priority)
// and is NOT hard-coded into business logic. An LLM never chooses the provider.
//
// A route is only usable if its Provider is enabled AND healthy_health != "down"
// (circuit breaker). If a provider is down, the resolver skips it and tries the
// next route by priority (§55). Automatic fallback only happens across routes
// configured for the same destination/visa/purpose; a single-provider route with
// no fallback surfaces REQUIRES_OPERATOR attention rather than silently
// switching portals (a different portal materially changes the submission route).

import { getSubmissionAdapter } from "./registry.ts";
import type { SubmissionCapability, SubmissionContract, SubmissionProviderAdapter } from "./types.ts";
import { submissionIdempotencyKey } from "./types.ts";

export interface ResolvedSubmissionProvider {
  provider: any;
  route: any;
  adapter: SubmissionProviderAdapter;
  provider_id: string;
  provider_key: string;
  provider_type: string;
  channel: string;
  environment: "sandbox" | "production";
  capabilities: SubmissionCapability[];
  idempotency_key: string;
  appointment_required: boolean;
  appointment_location?: string;
  fallback_used: boolean;
  skipped_unhealthy: { provider_id: string; reason: string }[];
}

export async function resolveSubmissionProvider(
  svc: any,
  app: any,
  pkg: any
): Promise<ResolvedSubmissionProvider> {
  const routes: any[] = await svc.entities.SubmissionRoute.filter({
    destination: app.destination,
    visa_type_key: app.visa_type_key,
    purpose: app.purpose,
    status: "active",
  }).catch(() => []);

  // Widen to destination+purpose if no visa-type-specific route exists.
  if (!routes.length) {
    const wide: any[] = await svc.entities.SubmissionRoute.filter({
      destination: app.destination,
      purpose: app.purpose,
      status: "active",
    }).catch(() => []);
    routes.push(...wide);
  }

  // Deterministic priority ordering (lower priority number first).
  routes.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const skipped: { provider_id: string; reason: string }[] = [];
  for (const route of routes) {
    if (route.channel && app.channel && route.channel !== app.channel) {
      skipped.push({ provider_id: route.provider_id, reason: "channel_mismatch" });
      continue;
    }
    const provider: any = await svc.entities.Provider.get(route.provider_id).catch(() => null);
    if (!provider || !provider.enabled) { skipped.push({ provider_id: route.provider_id, reason: "disabled" }); continue; }
    if (provider.health_status === "down") { skipped.push({ provider_id: provider.id, reason: "unhealthy" }); continue; }
    let adapter: SubmissionProviderAdapter;
    try { adapter = getSubmissionAdapter(provider.adapter_key); }
    catch { skipped.push({ provider_id: provider.id, reason: "no_adapter" }); continue; }

    const idempotency_key = submissionIdempotencyKey(app.id, pkg.package_hash, provider.id);
    return {
      provider,
      route,
      adapter,
      provider_id: provider.id,
      provider_key: provider.key,
      provider_type: route.provider_type || (provider.adapter_config as any)?.provider_type || "MANUAL_OPERATOR",
      channel: route.channel || app.channel,
      environment: provider.environment === "production" ? "production" : "sandbox",
      capabilities: (route.capabilities || adapter.capabilities) as SubmissionCapability[],
      idempotency_key,
      appointment_required: !!route.appointment_required,
      appointment_location: route.appointment_location,
      fallback_used: skipped.length > 0,
      skipped_unhealthy: skipped,
    };
  }

  throw Object.assign(new Error("No submission provider available for this route"), {
    code: "NO_SUBMISSION_PROVIDER",
    skipped,
  });
}

// Build the normalized contract the provider receives (§11). The provider never
// sees the full VisaApplication — only the immutable package + form snapshot.
export async function buildSubmissionContract(
  svc: any,
  app: any,
  pkg: any,
  resolved: ResolvedSubmissionProvider
): Promise<SubmissionContract> {
  const items: any[] = await svc.entities.SubmissionPackageItem.filter({ package_id: pkg.id }).catch(() => []);
  const documents = items
    .filter((i) => i.type !== "FORM" && i.document_version_id)
    .map((i) => ({ document_id: i.document_id, document_version_id: i.document_version_id, document_type: i.document_type, label: i.label }));
  const form = items.find((i) => i.type === "FORM");
  return {
    application_id: app.id,
    package_id: pkg.id,
    provider_id: resolved.provider_id,
    provider_key: resolved.provider_key,
    form_snapshot_id: pkg.form_snapshot_id,
    form_code: pkg.form_code,
    form_version: pkg.form_version,
    package_hash: pkg.package_hash,
    documents,
    idempotency_key: resolved.idempotency_key,
    environment: resolved.environment,
  };
}