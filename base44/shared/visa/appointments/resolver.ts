// Worldz Visa (Phase 9) — AppointmentProviderResolver.
//
// DETERMINISTIC provider selection for an appointment requirement (§11). Input:
// the application + its appointment requirement + the bound SubmissionRoute.
// The route already names a primary submission provider; the appointment
// resolver reuses that route's provider IF it advertises the needed appointment
// capability, else falls back to any enabled, healthy provider (same tenant
// scope) that advertises the capability. No LLM selection.

import { getAppointmentAdapter } from "./registry.ts";
import type { AppointmentCapability, AppointmentProviderAdapter, AppointmentType } from "./types.ts";

export interface ResolvedAppointmentProvider {
  provider: any;
  route: any;
  adapter: AppointmentProviderAdapter;
  provider_id: string;
  provider_key: string;
  provider_type: string;
  channel: string;
  environment: "sandbox" | "production";
  capabilities: AppointmentCapability[];
  supports: (cap: AppointmentCapability) => boolean;
  fallback_used: boolean;
  skipped: { provider_id: string; reason: string }[];
}

function capFor(type: AppointmentType): AppointmentCapability {
  // The capability needed to BOOK an appointment of this type.
  return "APPOINTMENT_BOOK";
}

export async function resolveAppointmentProvider(
  svc: any,
  app: any,
  requirement: { type: AppointmentType; required: boolean },
  opts?: { preferred_provider_id?: string }
): Promise<ResolvedAppointmentProvider> {
  if (!requirement.required) throw Object.assign(new Error("Appointment not required for this route"), { code: "NOT_REQUIRED" });
  const need = capFor(requirement.type);

  // Candidate 1: the submission route's bound provider.
  const routes: any[] = await svc.entities.SubmissionRoute.filter({
    destination: app.destination, visa_type_key: app.visa_type_key, purpose: app.purpose, status: "active",
  }).catch(() => []);
  if (!routes.length) {
    const wide: any[] = await svc.entities.SubmissionRoute.filter({ destination: app.destination, purpose: app.purpose, status: "active" }).catch(() => []);
    routes.push(...wide);
  }
  routes.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const skipped: { provider_id: string; reason: string }[] = [];
  const candidates: any[] = [];
  const seen = new Set<string>();
  for (const r of routes) {
    if (r.channel && app.channel && r.channel !== app.channel) { skipped.push({ provider_id: r.provider_id, reason: "channel_mismatch" }); continue; }
    candidates.push({ route: r, provider_id: r.provider_id });
    seen.add(r.provider_id);
  }
  // Candidate 2: any enabled healthy submission-category provider with the cap.
  const all: any[] = await svc.entities.Provider.filter({ category: "submission", enabled: true }).catch(() => []);
  for (const p of all) {
    if (seen.has(p.id)) continue;
    candidates.push({ route: null, provider_id: p.id });
  }
  // Preferred provider (e.g. explicit route.appointment_provider) moves first.
  if (opts?.preferred_provider_id) {
    const idx = candidates.findIndex((c) => c.provider_id === opts.preferred_provider_id);
    if (idx > 0) { const [c] = candidates.splice(idx, 1); candidates.unshift(c); }
  }

  for (const cand of candidates) {
    const provider: any = await svc.entities.Provider.get(cand.provider_id).catch(() => null);
    if (!provider || !provider.enabled) { skipped.push({ provider_id: cand.provider_id, reason: "disabled" }); continue; }
    if (provider.health_status === "down") { skipped.push({ provider_id: provider.id, reason: "unhealthy" }); continue; }
    let adapter: AppointmentProviderAdapter;
    try { adapter = getAppointmentAdapter(provider.adapter_key); }
    catch { skipped.push({ provider_id: provider.id, reason: "no_appointment_adapter" }); continue; }
    const caps = adapter.getCapabilities({ providerId: provider.id, providerKey: provider.key, category: provider.category, environment: provider.environment, adapterConfig: provider.adapter_config || {}, credentials: {}, requestId: crypto.randomUUID() } as any) || [];
    if (!caps.includes(need)) { skipped.push({ provider_id: provider.id, reason: `missing_${need}` }); continue; }
    return {
      provider, route: cand.route, adapter,
      provider_id: provider.id, provider_key: provider.key,
      provider_type: cand.route?.provider_type || (provider.adapter_config as any)?.provider_type || "VISA_CENTER_API",
      channel: cand.route?.channel || app.channel,
      environment: provider.environment === "production" ? "production" : "sandbox",
      capabilities: caps,
      supports: (cap: AppointmentCapability) => caps.includes(cap),
      fallback_used: skipped.length > 0 || !cand.route,
      skipped,
    };
  }
  throw Object.assign(new Error("No appointment provider available for this requirement"), { code: "NO_APPOINTMENT_PROVIDER", skipped });
}