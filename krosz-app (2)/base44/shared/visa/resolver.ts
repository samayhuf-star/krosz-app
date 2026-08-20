// Worldz Visa — deterministic VisaRouteResolver (spec S10).
// Pure function over catalog rows. LLMs may EXPLAIN a route; they never DECIDE one.

export interface RouteInput {
  nationality: string;
  residence?: string;
  destination: string;
  purpose: string;
  travel_dates?: { departure?: string; return?: string };
}

export interface RouteOutput {
  eligible: boolean;
  visa_type_key?: string;
  channel?: string;
  appointment_required?: boolean;
  requirements_version?: string;
  reason?: string;
}

// routes: VisaRoute rows (already loaded). Exact match first, then nationality-only fallback
// (residence assumed = nationality when absent).
export function resolveVisaRoute(routes: any[], input: RouteInput): RouteOutput {
  const nat = String(input.nationality || "").toUpperCase();
  const dest = String(input.destination || "").toUpperCase();
  const purpose = String(input.purpose || "").toLowerCase();
  if (!nat || !dest || !purpose) return { eligible: false, reason: "missing_input" };

  const match = (r: any) =>
    String(r.nationality).toUpperCase() === nat &&
    String(r.destination).toUpperCase() === dest &&
    String(r.purpose).toLowerCase() === purpose &&
    String(r.status) === "active";

  const exact = routes.find((r) => match(r) && String(r.residence).toUpperCase() === (String(input.residence || nat).toUpperCase()));
  const fallback = exact || routes.find((r) => match(r) && String(r.residence || "").toUpperCase() === nat);
  const any = fallback || routes.find((r) => match(r));
  const r = any;
  if (!r) return { eligible: false, reason: "no_route_in_catalog" };
  return {
    eligible: !!r.eligible,
    visa_type_key: r.visa_type_key,
    channel: r.channel,
    appointment_required: !!r.appointment_required,
    requirements_version: r.requirements_version,
    reason: r.eligible ? "ok" : "route_not_eligible",
  };
}