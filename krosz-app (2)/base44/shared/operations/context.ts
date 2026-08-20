// Immutable context snapshot. Captured at launch; dispatched unchanged to every
// Task. A Task never receives just {business_id} — it receives the full
// context so execution is reproducible and auditable.

export async function latestApprovedBlueprint(svc: any, businessId: string): Promise<any | null> {
  const all = await svc.entities.BusinessBlueprint.filter({ business_id: businessId });
  const approved = (all || []).filter((r: any) => r.status === "approved").sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
  return approved[0] || null;
}

export async function buildContextSnapshot(svc: any, business: any, runContext: any): Promise<any> {
  const approvedBlueprint = await latestApprovedBlueprint(svc, business.id).catch(() => null);
  return {
    business: {
      id: business.id,
      name: business.name,
      industry: business.industry,
      country: business.country,
      city: business.city,
      state: business.state,
      service_area: business.service_area,
      target_customers: business.target_customers,
      services_products: business.services_products || [],
      lifecycle_stage: business.lifecycle_stage || business.status || "draft",
      approved_blueprint: approvedBlueprint ? { id: approvedBlueprint.id, version: approvedBlueprint.version } : null,
      brand: (business.planner_profile && business.planner_profile.branding) || null,
      existing_assets: business.approved_assets || [],
    },
    run_context: runContext,
    prior_task_outputs: {}, // filled by the engine as tasks complete
  };
}

// Inject the outputs of completed tasks into a task's dispatch context.
export function withPriorOutputs(snapshot: any, outputsByKey: Record<string, any>): any {
  return { ...snapshot, prior_task_outputs: { ...outputsByKey } };
}