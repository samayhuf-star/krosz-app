// Worldz Visa — VisaApplication lifecycle (domain entity side). Phase 3 will bind run_id
// to an orchestrator LaunchPlan (launchRun with a visa plan template). For Phase 1 this
// creates the application record and resolves the route deterministically.

import { resolveVisaRoute } from "./resolver.ts";
import { ensureTravelerForUser } from "./traveler.ts";
import { launchVisaRun } from "./lifecycle.ts";
import { buildRuleSnapshot } from "./workspace/snapshot.ts";

export async function createApplication(svc: any, user: any, input: any): Promise<any> {
  const nationality = String(input.nationality || "IN").toUpperCase();
  const residence = String(input.residence || nationality).toUpperCase();
  const destination = String(input.destination || "").toUpperCase();
  const purpose = String(input.purpose || "tourism").toLowerCase();
  if (!destination) throw Object.assign(new Error("destination is required"), { code: "BAD_REQUEST" });

  const routes: any[] = await svc.entities.VisaRoute.filter({ nationality, destination, purpose, status: "active" }).catch(() => []);
  const route = resolveVisaRoute(routes, { nationality, residence, destination, purpose, travel_dates: input.travel_dates });
  if (!route.eligible) throw Object.assign(new Error("No eligible route in catalog for this input"), { code: "NO_ROUTE", route });

  const traveler = input.traveler_id
    ? await svc.entities.Traveler.get(input.traveler_id).catch(() => null) || await ensureTravelerForUser(svc, user, { nationality, residence })
    : await ensureTravelerForUser(svc, user, { nationality, residence });

  // Phase 16 (§3): capture an immutable snapshot of the visa-rule context that
  // governed eligibility at this moment so changing rules never silently alter
  // an in-flight application. Best-effort — a missing catalog row does not fail
  // creation; the version labels are always pinned.
  const snap = await buildRuleSnapshot(svc, { nationality, destination, purpose, route }).catch(() => null);

  const app = await svc.entities.VisaApplication.create({
    traveler_id: traveler.id,
    organization_id: input.organization_id || null,
    nationality, residence, destination, purpose,
    visa_type_key: route.visa_type_key,
    channel: route.channel,
    status: "eligibility_confirmed",
    current_step: "documents",
    travel_start: input.travel_start || null,
    travel_end: input.travel_end || null,
    requirements_version: route.requirements_version,
    question_version: "visa.application.questions.v1",
    visa_rule_version: snap?.visa_rule_version || route.requirements_version,
    fee_version: snap?.fee_version || null,
    rule_snapshot: snap?.rule_snapshot || null,
    appointment_required: !!route.appointment_required,
  });
  // Phase 3: bind the application to a durable orchestrator Run. Failure here must
  // not lose the application — the run_id can be re-bound later via advance.
  try {
    const runId = await launchVisaRun(svc, user, app);
    if (runId) {
      await svc.entities.VisaApplication.update(app.id, { run_id: runId, status: "documents_pending", current_step: "documents" });
      return await svc.entities.VisaApplication.get(app.id);
    }
  } catch (e) {
    console.error("visa: launchVisaRun failed", e?.message || e);
  }
  return app;
}

export async function getApplication(svc: any, user: any, id: string): Promise<any> {
  const app = await svc.entities.VisaApplication.get(id).catch(() => null);
  if (!app) throw Object.assign(new Error("Application not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && app.created_by_id !== user.id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  return app;
}

export async function listApplications(svc: any, user: any): Promise<any[]> {
  // Customer endpoints remain owner-scoped even if an administrator opens the
  // customer shell. Cross-customer access belongs to isolated ops/admin APIs.
  return await svc.entities.VisaApplication.filter({ created_by_id: user.id }, "-created_date", 100).catch(() => []);
}