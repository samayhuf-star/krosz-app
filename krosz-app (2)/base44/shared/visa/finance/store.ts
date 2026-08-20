// Worldz Visa (Phase 38) — Durable financial reconciliation + SLA store.
//
// Wraps the pure finance engine with persistence over the existing entities
// (ApplicationFinancialRecord, ProviderSLADefinition, ProviderStatement,
// ProviderInvoice, FinancialAuditEvent, OperationsTask, Order, Payment, Refund,
// CaseEvent). NEVER duplicates payment state — the Order/Payment/Refund system
// remains authoritative (§4/§5). Fee separation is computed once from the
// immutable Order price_snapshot and frozen into the ApplicationFinancialRecord
// commercial snapshot (§3); later price changes never mutate historical records.

import {
  buildCommercialSnapshot, reconcileRecord, statementImportKey, refundLineage,
  netPlatformEconomics, detectAnomalies, governmentFeeSource,
  providerCostSource, slaDefinitionFor, startSlaTimer, pauseSlaTimer, resumeSlaTimer,
  slaBreach, isContractualBreach, adminFinancialProjection, travelerFinancialProjection,
  type CommercialSnapshot, type ReconcileResult,
} from "./engine.ts";
import { sumMinor } from "../payments/money.ts";

// ---------- §3 create financial record on order PAID ----------
export async function createFinancialRecord(svc: any, order: any, app: any, opts: { provider_version?: string | null; government_fee_data_version?: string | null } = {}): Promise<any> {
  const existing: any[] = await svc.entities.ApplicationFinancialRecord.filter({ case_id: order.application_id }).catch(() : any[] => []);
  if (existing.length) return { record: existing[0], idempotent: true };
  const snap = buildCommercialSnapshot(order, opts);
  const record = await svc.entities.ApplicationFinancialRecord.create({
    case_id: order.application_id, application_id: order.application_id, traveler_id: order.traveler_id,
    organization_id: app?.organization_id || null, order_id: order.id, order_number: order.order_number,
    provider_id: null, provider_key: app?.provider_key || null, provider_binding_id: app?.provider_binding_id || null,
    provider_application_id: app?.provider_application_id || null,
    currency: snap.currency,
    commercial_snapshot: snap,
    government_fee_minor: snap.government_fee_minor, provider_fee_minor: snap.provider_fee_minor,
    platform_fee_minor: snap.platform_fee_minor, tax_minor: snap.tax_minor, discount_minor: snap.discount_minor,
    payment_processing_fee_minor: snap.payment_processing_fee_minor, traveler_total_minor: snap.traveler_total_minor,
    government_fee_source: governmentFeeSource(snap, opts.government_fee_data_version || null),
    government_fee_data_version: opts.government_fee_data_version || null,
    amount_paid_minor: order.total_minor, amount_refunded_minor: 0, refund_status: "NO_REFUND",
    provider_cost_minor: 0, provider_cost_source: "UNKNOWN", provider_amount_due_minor: 0, provider_amount_paid_minor: 0,
    provider_refund_minor: 0, reconciliation_status: "UNRECONCILED", reconciliation_version: 1, reconciliation_match: null,
    chargeback_minor: 0, chargeback_status: "NONE", net_platform_economics_minor: 0, net_economics_basis: "UNKNOWN",
    anomalies: [], settlement_status: "UNSETTLED", metadata: {},
  }).catch(() => null);
  if (record) await audit(svc, record, "FINANCIAL_RECORD_CREATED", "system", { new_value: { traveler_total_minor: snap.traveler_total_minor, currency: snap.currency } });
  await recomputeEconomics(svc, record);
  return { record };
}

// ---------- §8/§30 recompute net economics ----------
export async function recomputeEconomics(svc: any, record: any): Promise<any> {
  if (!record) return null;
  const payments: any[] = await svc.entities.Payment.filter({ order_id: record.order_id }).catch(() : any[] => []);
  const succeeded = payments.filter((p) => p.status === "SUCCEEDED");
  const amount_paid = sumMinor(succeeded.map((p) => p.amount_minor || 0));
  const refunds: any[] = await svc.entities.Refund.filter({ order_id: record.order_id }).catch(() : any[] => []);
  const amount_refunded = sumMinor(refunds.filter((r) => r.status === "COMPLETED").map((r) => r.amount_minor || 0));
  const snap = record.commercial_snapshot as CommercialSnapshot;
  // §46: a legitimate numeric 0 provider cost must remain 0; only "UNKNOWN" source means unknown.
  const providerCostForNet: number | "UNKNOWN" = record.provider_cost_source === "UNKNOWN" ? "UNKNOWN" : (record.provider_cost_minor ?? 0);
  const net = netPlatformEconomics(snap, { amount_paid_minor: amount_paid, amount_refunded_minor: amount_refunded, provider_cost_minor: providerCostForNet, chargeback_minor: record.chargeback_minor ?? 0 });
  const refund_status = amount_refunded <= 0 ? "NO_REFUND" : amount_refunded >= record.traveler_total_minor ? "FULL_REFUND" : "PARTIAL_REFUND";
  const updated = await svc.entities.ApplicationFinancialRecord.update(record.id, {
    amount_paid_minor: amount_paid, amount_refunded_minor: amount_refunded, refund_status,
    net_platform_economics_minor: net.net_minor, net_economics_basis: net.basis,
  }).catch(() => null);
  return updated || record;
}

// ---------- §14 idempotent statement import + §11 reconciliation ----------
export async function importProviderStatement(svc: any, statement: { provider_key: string; statement_id: string; record_id: string; currency: string; case_id?: string; statement_date?: string; provider_application_id?: string; actual_provider_fee_minor?: number; actual_government_fee_minor?: number; actual_refund_minor?: number; actual_application_status?: string; actual_decision?: string; period_from?: string; period_to?: string; source_format?: string; raw_reference?: string }): Promise<{ statement: any; idempotent: boolean; reconciliation?: ReconcileResult | null; task?: any | null }> {
  const import_key = statementImportKey(statement.provider_key, statement.statement_id, statement.record_id);
  const existing: any[] = await svc.entities.ProviderStatement.filter({ import_key }).catch(() : any[] => []);
  if (existing.length) return { statement: existing[0], idempotent: true }; // §14 dedup
  const row = await svc.entities.ProviderStatement.create({
    ...statement, import_key, imported_at: new Date().toISOString(),
    matched: false, reconciliation_status: "UNMATCHED",
  }).catch(() => null);
  let reconciliation: ReconcileResult | null = null;
  let task: any | null = null;
  let rec: any = null, app: any = null;
  if (statement.case_id) {
    const recs: any[] = await svc.entities.ApplicationFinancialRecord.filter({ case_id: statement.case_id }).catch(() : any[] => []);
    rec = recs[0];
    app = await svc.entities.VisaApplication.get(statement.case_id).catch(() => null);
  } else if (statement.provider_application_id) {
    const apps: any[] = await svc.entities.VisaApplication.filter({ provider_application_id: statement.provider_application_id }).catch(() : any[] => []);
    app = apps[0];
    if (app) {
      const recs: any[] = await svc.entities.ApplicationFinancialRecord.filter({ case_id: app.id }).catch(() : any[] => []);
      rec = recs[0];
    }
  }
  if (rec) {
    reconciliation = reconcileRecord({
      expected_provider_fee_minor: rec.provider_fee_minor ?? "UNKNOWN",
      actual_provider_fee_minor: statement.actual_provider_fee_minor ?? "UNKNOWN",
      expected_application_status: app?.case_state || null, actual_application_status: statement.actual_application_status || null,
      expected_refund_minor: rec.amount_refunded_minor ?? "UNKNOWN", actual_refund_minor: statement.actual_refund_minor ?? "UNKNOWN",
    });
    const provider_cost = statement.actual_provider_fee_minor ?? "UNKNOWN";
    const updated = await svc.entities.ApplicationFinancialRecord.update(rec.id, {
      provider_cost_minor: provider_cost === "UNKNOWN" ? rec.provider_cost_minor : provider_cost,
      provider_cost_source: providerCostSource(provider_cost as any, row),
      provider_application_id: statement.provider_application_id,
      reconciliation_status: reconciliation.status, reconciliation_version: (rec.reconciliation_version || 1) + (reconciliation.status === "MISMATCH" ? 1 : 0),
      reconciliation_match: { ...reconciliation, statement_id: statement.statement_id, matched_at: new Date().toISOString() },
    }).catch(() => null);
    await svc.entities.ProviderStatement.update(row.id, { case_id: rec.case_id, matched: true, reconciliation_status: reconciliation.status === "MISMATCH" ? "MISMATCH" : "MATCHED" }).catch(() : any => null);
    await audit(svc, updated || rec, reconciliation.status === "MISMATCH" ? "RECONCILIATION_MISMATCH" : "RECONCILIATION_MATCHED", "reconciliation", { reconciliation });
    if (reconciliation.status === "MISMATCH") {
      const k = `finrecon:${rec.case_id}:${statement.statement_id}`;
      const eTask: any[] = await svc.entities.OperationsTask.filter({ idempotency_key: k }).catch(() : any[] => []);
      if (!eTask.length) task = await createTask(svc, { case_id: rec.case_id, task_type: "FINANCIAL_RECONCILIATION", queue: "PAYMENTS", title: "Financial reconciliation mismatch", description: `Provider fee mismatch (diff ${reconciliation.diff_minor})`, idempotency_key: k, priority: "HIGH" });
    }
    await recomputeEconomics(svc, updated || rec);
  }
  return { statement: row, idempotent: false, reconciliation, task };
}

// ---------- §16/§18 SLA timer evaluation ----------
export async function evaluateSlaForCase(svc: any, app: any, now: string = new Date().toISOString()): Promise<{ timer: any; breach_task?: any | null; warning_task?: any | null; breach: boolean } | null> {
  if (!app?.case_state || !["SUBMITTED", "PROCESSING", "ADDITIONAL_INFORMATION_REQUIRED"].includes(app.case_state)) return null;
  const bindings: any[] = await svc.entities.CountryProviderBinding.filter({ provider_key: app.provider_key, country_code: (app.destination || "").toUpperCase() }).catch(() : any[] => []);
  const binding = bindings[0];
  const defs: any[] = await svc.entities.ProviderSLADefinition.filter({ provider_key: app.provider_key, is_active: true }).catch(() : any[] => []);
  const slaDef = slaDefinitionFor(binding, defs);
  if (!slaDef && !app.provider_key) return null;
  const events: any[] = await svc.entities.CaseEvent.filter({ case_id: app.id, event_type: "SUBMITTED" }).catch(() : any[] => []);
  const submittedAt = events[0]?.created_date || null;
  if (!submittedAt) return null;
  let timer = startSlaTimer(submittedAt, slaDef || {}, now);
  if (app.case_state === "ADDITIONAL_INFORMATION_REQUIRED" && slaDef) timer = pauseSlaTimer(timer, app.case_state, slaDef, now);
  else timer = resumeSlaTimer(timer, now);
  const breach = slaBreach(timer, app.case_state, now);
  let breach_task: any | null = null, warning_task: any | null = null;
  if (breach) {
    const k = `slabreach:${app.id}`;
    const eTask: any[] = await svc.entities.OperationsTask.filter({ idempotency_key: k }).catch(() : any[] => []);
    if (!eTask.length) breach_task = await createTask(svc, { case_id: app.id, task_type: "PROVIDER_SLA_BREACH", queue: "PROVIDER", title: "Provider SLA breach", description: `Application overdue since ${timer.expected_by}`, idempotency_key: k, priority: slabreachPriority(slaDef) });
  } else if (timer.state === "DUE_SOON") {
    const k = `slawarn:${app.id}`;
    const eTask: any[] = await svc.entities.OperationsTask.filter({ idempotency_key: k }).catch(() : any[] => []);
    if (!eTask.length) warning_task = await createTask(svc, { case_id: app.id, task_type: "PROVIDER_SLA_WARNING", queue: "PROVIDER", title: "Provider SLA due soon", description: `Expected by ${timer.expected_by}`, idempotency_key: k, priority: "NORMAL" });
  }
  return { timer, breach_task, warning_task, breach };
}
function slabreachPriority(slaDef: any): "HIGH" | "URGENT" { return isContractualBreach(slaDef, true) ? "URGENT" : "HIGH"; }

// ---------- §22 refund lineage ----------
export async function recordRefundLineage(svc: any, record: any): Promise<any> {
  if (!record) return null;
  const refunds: any[] = await svc.entities.Refund.filter({ order_id: record.order_id }).catch(() : any[] => []);
  const statements: any[] = await svc.entities.ProviderStatement.filter({ provider_key: record.provider_key }).catch(() : any[] => []);
  const rl = refundLineage(refunds, statements);
  const update: any = { amount_refunded_minor: rl.traveler_refund_minor, refund_status: rl.traveler_refund_status as any, provider_refund_minor: rl.provider_refund_minor };
  if (rl.mismatch) update.metadata = { ...(record.metadata || {}), refund_mismatch: true };
  const updated = await svc.entities.ApplicationFinancialRecord.update(record.id, update).catch(() => null);
  if (rl.mismatch) await audit(svc, updated || record, "RECONCILIATION_MISMATCH", "reconciliation", { detail: "traveler refund != provider refund" });
  await recomputeEconomics(svc, updated || record);
  return updated || record;
}

// ---------- §23 chargeback ----------
export async function openChargeback(svc: any, args: { case_id: string; amount_minor: number; reason?: string; actor_id?: string }): Promise<any> {
  const records: any[] = await svc.entities.ApplicationFinancialRecord.filter({ case_id: args.case_id }).catch(() : any[] => []);
  const rec = records[0];
  if (!rec) return null;
  const k = `chargeback:${args.case_id}`;
  const eTask: any[] = await svc.entities.OperationsTask.filter({ idempotency_key: k }).catch(() : any[] => []);
  let task: any | null = null;
  if (!eTask.length) task = await createTask(svc, { case_id: args.case_id, task_type: "CHARGEBACK_REVIEW", queue: "PAYMENTS", title: "Chargeback review", description: args.reason || "Chargeback opened", idempotency_key: k, priority: "URGENT" });
  const updated = await svc.entities.ApplicationFinancialRecord.update(rec.id, { chargeback_minor: args.amount_minor, chargeback_status: "OPEN" }).catch(() => null);
  await audit(svc, updated || rec, "CHARGEBACK_OPENED", args.actor_id || "system", { amount_minor: args.amount_minor });
  return { record: updated || rec, task };
}

// ---------- §45 anomaly evaluation ----------
export async function evaluateAnomalies(svc: any, record: any, app: any): Promise<any[]> {
  if (!record) return [];
  const payments: any[] = await svc.entities.Payment.filter({ order_id: record.order_id }).catch(() : any[] => []);
  const attempts: any[] = await svc.entities.ExecutionAttempt.filter({ case_id: record.case_id }).catch(() : any[] => []);
  const statements: any[] = await svc.entities.ProviderStatement.filter({ provider_key: record.provider_key, matched: true }).catch(() : any[] => []);
  const reconciliation = reconcileRecord({ expected_provider_fee_minor: record.provider_fee_minor ?? "UNKNOWN", actual_provider_fee_minor: record.provider_cost_source === "UNKNOWN" ? "UNKNOWN" : (record.provider_cost_minor ?? "UNKNOWN") });
  const anomalies = detectAnomalies({ record, payments, app, attempts, statements, reconciliation });
  if (anomalies.length) {
    await svc.entities.ApplicationFinancialRecord.update(record.id, { anomalies }).catch(() : any => null);
    await audit(svc, record, "ANOMALY_DETECTED", "system", { anomalies });
    const k = `anomaly:${record.case_id}:${anomalies[0].type}`;
    const eTask: any[] = await svc.entities.OperationsTask.filter({ idempotency_key: k }).catch(() : any[] => []);
    if (!eTask.length && anomalies.some((a) => ["HIGH", "CRITICAL"].includes(a.severity))) {
      await createTask(svc, { case_id: record.case_id, task_type: "FINANCIAL_RECONCILIATION", queue: "PAYMENTS", title: `Financial anomaly: ${anomalies[0].type}`, description: anomalies[0].detail, idempotency_key: k, priority: anomalies.some((a) => a.severity === "CRITICAL") ? "URGENT" : "HIGH" });
    }
  }
  return anomalies;
}

// ---------- §35 settlement allocation ----------
export async function allocateSettlement(svc: any, args: { provider_key: string; period_from: string; period_to: string; cadence: "DAILY" | "WEEKLY" | "MONTHLY" }): Promise<any> {
  const records: any[] = await svc.entities.ApplicationFinancialRecord.filter({ provider_key: args.provider_key }).catch(() : any[] => []);
  const open = records.filter((r) => r.settlement_status === "UNSETTLED" && r.provider_cost_minor > 0);
  for (const r of open) {
    await svc.entities.ApplicationFinancialRecord.update(r.id, { settlement_period: `${args.cadence}:${args.period_from}:${args.period_to}`, settlement_status: "ALLOCATED" }).catch(() : any => null);
    await audit(svc, r, "SETTLEMENT_ALLOCATED", "system", { period: args });
  }
  return { allocated: open.length };
}

// ---------- helpers ----------
async function createTask(svc: any, spec: { case_id: string; task_type: string; queue: string; title: string; description: string; idempotency_key: string; priority: string }): Promise<any> {
  return await svc.entities.OperationsTask.create({
    case_id: spec.case_id, application_id: spec.case_id, traveler_id: null, task_type: spec.task_type,
    queue: spec.queue, priority: spec.priority, status: "QUEUED", idempotency_key: spec.idempotency_key,
    source_rule: "phase38.finance", title: spec.title, description: spec.description, created_at: new Date().toISOString(),
  }).catch(() => null);
}
async function audit(svc: any, record: any, action: string, actor: string, detail: any): Promise<void> {
  if (!record) return;
  await svc.entities.FinancialAuditEvent.create({
    case_id: record.case_id, financial_record_id: record.id, order_id: record.order_id,
    action, actor_id: actor, actor_role: actor === "system" ? "SYSTEM" : "ADMIN",
    field: detail?.field || null, old_value: detail?.old_value || null, new_value: detail?.new_value || null,
    reason: detail?.reason || detail?.detail || null, source: "phase38.finance", authorization: actor,
    amount_minor: detail?.amount_minor || 0, currency: record.currency, occurred_at: new Date().toISOString(), metadata: detail || {},
  }).catch(() : any => null);
}

// ---------- read projections (admin vs traveler) ----------
export function projectForRole(record: any, role: "admin" | "traveler"): any {
  return role === "admin" ? adminFinancialProjection(record) : travelerFinancialProjection(record);
}

export { buildCommercialSnapshot, reconcileRecord, statementImportKey, refundLineage, netPlatformEconomics, detectAnomalies };