// Server-side shared logging services: usage ledger, cost ledger, audit log.
// Usage kinds keep health checks separate from customer usage. Costs are never fabricated:
// estimated_amount is written when a pricing rule computes a value; cost_amount is written
// only when the provider returns or settles an actual cost.

export type UsageKind = "test_connection" | "production_operation" | "failed_operation";

export interface UsageParams {
  tenant_id?: string | null;
  business_id?: string | null;
  provider_id: string;
  service: string;
  operation: string;
  usage_quantity: number;
  usage_unit: string;
  provider_request_id?: string | null;
  success: boolean;
  kind?: UsageKind;
  error_message?: string | null;
}

export interface CostParams {
  tenant_id?: string | null;
  business_id?: string | null;
  provider_id: string;
  usage_log_id?: string | null;
  service: string;
  operation: string;
  cost_amount?: number;            // actual cost, only when the provider returns/settles one
  estimated_amount?: number;       // estimated cost, when computed from a pricing config
  currency?: string;
  billable_amount?: number | null;
}

export interface AuditParams {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  changes?: Record<string, unknown> | null;
}

export async function recordUsage(base44: any, params: UsageParams): Promise<void> {
  try {
    await base44.asServiceRole.entities.UsageLog.create({
      tenant_id: params.tenant_id ?? null,
      business_id: params.business_id ?? null,
      provider_id: params.provider_id,
      service: params.service,
      operation: params.operation,
      usage_quantity: params.usage_quantity,
      usage_unit: params.usage_unit,
      provider_request_id: params.provider_request_id || null,
      success: Boolean(params.success),
      kind: params.kind || (params.success ? "production_operation" : "failed_operation"),
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // logging is best-effort; never block the operation that triggered it
  }
}

export async function recordCost(base44: any, params: CostParams): Promise<void> {
  try {
    const hasActual = typeof params.cost_amount === "number";
    const hasEstimated = typeof params.estimated_amount === "number";
    if (!hasActual && !hasEstimated) return; // do not write empty cost rows
    await base44.asServiceRole.entities.CostLog.create({
      tenant_id: params.tenant_id ?? null,
      business_id: params.business_id ?? null,
      provider_id: params.provider_id,
      usage_log_id: params.usage_log_id || null,
      service: params.service,
      operation: params.operation,
      cost_amount: hasActual ? params.cost_amount : 0,
      estimated_amount: hasEstimated ? params.estimated_amount : null,
      is_estimated: !hasActual && hasEstimated,
      currency: params.currency || "USD",
      billable_amount: params.billable_amount ?? null,
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // best-effort
  }
}

export async function recordAudit(base44: any, params: AuditParams): Promise<void> {
  try {
    let user: any = null;
    try { user = await base44.auth.me(); } catch {}
    const tenantId = (user && user.data && user.data.tenant_id) || (user && user.tenant_id) || null;
    await base44.asServiceRole.entities.AuditLog.create({
      tenant_id: tenantId,
      actor_user_id: (user && user.id) || null,
      action: params.action,
      entity_type: params.entity_type,
      entity_id: params.entity_id || null,
      changes: params.changes || {},
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // best-effort
  }
}