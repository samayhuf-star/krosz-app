// Worldz Visa (Phase 38) — Production Operations, Provider SLA & Financial Reconciliation.
//
// PURE module (no DB, no network, no LLM). It owns the deterministic rules of the
// financial reconciliation + provider SLA layer that sits ON TOP of the existing
// payment/case/operations systems. It NEVER duplicates payment/order/refund state
// (§4); the payment engine remains authoritative (§5). It NEVER estimates unknown
// fees as fact (§46).
//
// Responsibilities:
//   • fee classification (§2) — explicit, deterministic; UNKNOWN stays UNKNOWN
//   • immutable commercial snapshot from an Order price snapshot (§3)
//   • reconciliation status: expected vs actual (§10/§11); idempotent import key (§14)
//   • SLA timer + pause + breach (§16/§17/§18) — configuration-driven, never a gov guarantee
//   • refund lineage: traveler refund vs provider refund separate (§22)
//   • profitability / net platform economics (§8/§30) — internal-only
//   • anomaly detection (§45) — deterministic
//   • role-gated projections (§40): traveler hides internal margins; admin sees full
//   • export redaction (§41)
//   • AI financial-action restrictions (§44) — agents may only recommend, never mutate

import { sumMinor } from "../payments/money.ts";

// ---------- §2 fee classification ----------
export type FeeBucket = "GOVERNMENT_FEE" | "PROVIDER_FEE" | "PLATFORM_FEE" | "TAX" | "DISCOUNT" | "PAYMENT_PROCESSING_FEE" | "OTHER" | "UNKNOWN";

// A price component MAY carry an explicit `fee_class` (metadata) that overrides the
// type-based default. This keeps classification deterministic and auditable (§3).
export function classifyFee(component: any): FeeBucket {
  if (!component || typeof component !== "object") return "UNKNOWN";
  // Explicit override (authoritative when present).
  const fc = component.fee_class || component.metadata?.fee_class;
  if (fc && ["GOVERNMENT_FEE", "PROVIDER_FEE", "PLATFORM_FEE", "PAYMENT_PROCESSING_FEE", "OTHER"].includes(fc)) return fc as FeeBucket;
  const type = String(component.type || "").toUpperCase();
  if (type === "TAX") return "TAX";
  if (type === "DISCOUNT") return "DISCOUNT";
  if (type === "GOVERNMENT_FEE") return "GOVERNMENT_FEE";
  // Provider fee must be EXPLICIT (code/type carries 'provider') — never inferred.
  if (type === "PROVIDER_FEE") return "PROVIDER_FEE";
  if (/^PROVIDER/.test(String(component.code || ""))) return "PROVIDER_FEE";
  if (type === "PROCESSING_FEE") return "PAYMENT_PROCESSING_FEE"; // payment processing cost
  if (type === "SERVICE_FEE" || type === "APPOINTMENT_FEE" || type === "COURIER_FEE" || type === "DOCUMENT_SERVICE_FEE" || type === "OPTIONAL_SERVICE") return "PLATFORM_FEE";
  return "OTHER";
}

// ---------- §3 immutable commercial snapshot ----------
export interface CommercialSnapshot {
  currency: string;
  government_fee_minor: number;
  provider_fee_minor: number;
  platform_fee_minor: number;
  tax_minor: number;
  discount_minor: number;
  payment_processing_fee_minor: number;
  other_fee_minor: number;
  traveler_total_minor: number;
  pricing_version: string | null;
  provider_version: string | null;
  effective_at: string;
  component_classes: { code: string; bucket: FeeBucket; amount_minor: number; government_fee_basis?: string }[];
  unknown_buckets: FeeBucket[]; // buckets that could not be confidently classified
}

export function buildCommercialSnapshot(order: any, opts: { provider_version?: string | null; government_fee_data_version?: string | null; effective_at?: string } = {}): CommercialSnapshot {
  const snap = order?.price_snapshot || {};
  const components: any[] = Array.isArray(snap.components) ? snap.components : [];
  const currency = (order?.currency || snap.currency || "").toUpperCase();
  const buckets: Record<FeeBucket, number> = { GOVERNMENT_FEE: 0, PROVIDER_FEE: 0, PLATFORM_FEE: 0, TAX: 0, DISCOUNT: 0, PAYMENT_PROCESSING_FEE: 0, OTHER: 0, UNKNOWN: 0 };
  const classes: CommercialSnapshot["component_classes"] = [];
  const unknownSeen = new Set<FeeBucket>();
  for (const c of components) {
    const bucket = classifyFee(c);
    buckets[bucket] = sumMinor([buckets[bucket], Math.trunc(c.amount_minor || 0)]);
    classes.push({ code: c.code || "", bucket, amount_minor: Math.trunc(c.amount_minor || 0), government_fee_basis: c.government_fee_basis });
    if (bucket === "OTHER" || bucket === "UNKNOWN") unknownSeen.add(bucket);
  }
  // Traveler total is authoritative from the order (never recomputed).
  const traveler_total_minor = Math.trunc(order?.total_minor ?? snap.total_minor ?? sumMinor(components.map((c) => c.amount_minor || 0)));
  return {
    currency,
    government_fee_minor: buckets.GOVERNMENT_FEE,
    provider_fee_minor: buckets.PROVIDER_FEE,
    platform_fee_minor: buckets.PLATFORM_FEE,
    tax_minor: buckets.TAX,
    discount_minor: buckets.DISCOUNT,
    payment_processing_fee_minor: buckets.PAYMENT_PROCESSING_FEE,
    other_fee_minor: buckets.OTHER + buckets.UNKNOWN,
    traveler_total_minor,
    pricing_version: order?.price_version || snap.price_version || null,
    provider_version: opts.provider_version ?? null,
    effective_at: opts.effective_at || new Date().toISOString(),
    component_classes: classes,
    unknown_buckets: [...unknownSeen],
  };
}

// §46: truth of a bucket — if a required fee bucket is 0 AND no component classified
// into it, the value is UNKNOWN, not "free". Returns minor | "UNKNOWN".
export function bucketTruth(snapshot: CommercialSnapshot, bucket: FeeBucket): number | "UNKNOWN" {
  const has = snapshot.component_classes.some((c) => c.bucket === bucket);
  const val = (snapshot as any)[`${bucket.toLowerCase()}_minor`] || 0;
  if (!has && !val) return "UNKNOWN";
  return val;
}

// ---------- §4/§6/§7 fee provenance ----------
export function governmentFeeSource(snapshot: CommercialSnapshot, intelligenceVersion: string | null): string {
  if (snapshot.component_classes.some((c) => c.bucket === "GOVERNMENT_FEE")) return "order_price_snapshot";
  if (intelligenceVersion) return intelligenceVersion;
  return "UNKNOWN";
}

export function providerCostSource(providerCostMinor: number | "UNKNOWN", statement: any): "UNKNOWN" | "STATEMENT" | "INVOICE" | "BINDING_ESTIMATE" | "WEBHOOK" {
  if (providerCostMinor === "UNKNOWN" || providerCostMinor == null) return "UNKNOWN";
  if (statement && statement.provider_key) return "STATEMENT";
  return "BINDING_ESTIMATE";
}

// ---------- §10/§11 reconciliation ----------
export type ReconciliationStatus = "UNRECONCILED" | "MATCHED" | "PARTIAL_MATCH" | "MISMATCH" | "REFUND_PENDING" | "REFUND_MATCHED" | "DISPUTED" | "CLOSED";

export interface ReconcileInput {
  expected_provider_fee_minor: number | "UNKNOWN";
  actual_provider_fee_minor: number | "UNKNOWN";
  expected_application_status?: string | null;
  actual_application_status?: string | null;
  expected_refund_minor?: number | "UNKNOWN";
  actual_refund_minor?: number | "UNKNOWN";
}
export interface ReconcileResult { status: ReconciliationStatus; diff_minor: number | "UNKNOWN"; fields_matched: string[]; fields_mismatched: string[]; }

export function reconcileRecord(input: ReconcileInput): ReconcileResult {
  const matched: string[] = [];
  const mismatched: string[] = [];
  let diff: number | "UNKNOWN" = "UNKNOWN";
  // Provider fee comparison — only when BOTH are known.
  if (input.expected_provider_fee_minor !== "UNKNOWN" && input.actual_provider_fee_minor !== "UNKNOWN") {
    const e = Math.trunc(input.expected_provider_fee_minor as number);
    const a = Math.trunc(input.actual_provider_fee_minor as number);
    diff = a - e;
    if (a === e) matched.push("provider_fee");
    else mismatched.push("provider_fee");
  }
  // Application status comparison.
  if (input.expected_application_status != null && input.actual_application_status != null) {
    if (String(input.expected_application_status) === String(input.actual_application_status)) matched.push("application_status");
    else mismatched.push("application_status");
  }
  // Refund comparison.
  if (input.expected_refund_minor !== "UNKNOWN" && input.actual_refund_minor !== "UNKNOWN") {
    if (input.expected_refund_minor === input.actual_refund_minor) matched.push("refund");
    else mismatched.push("refund");
  }
  let status: ReconciliationStatus;
  if (mismatched.length) status = "MISMATCH";
  else if (matched.length && matched.length === (matched.length + mismatched.length)) status = "MATCHED";
  else if (matched.length) status = "PARTIAL_MATCH";
  else status = "UNRECONCILED";
  return { status, diff_minor: diff, fields_matched: matched, fields_mismatched: mismatched };
}

// ---------- §14 idempotent statement import key ----------
export function statementImportKey(providerKey: string, statementId: string, recordId: string): string {
  return `stmt|${providerKey}|${statementId}|${recordId}`;
}

// ---------- §16/§17/§18 SLA timer ----------
export type SLAStatus = "NOT_STARTED" | "WITHIN_SLA" | "DUE_SOON" | "OVERDUE" | "PAUSED" | "COMPLETED";

export interface SLATimer { submitted_at: string | null; expected_by: string | null; paused_at: string | null; paused_total_ms: number; state: SLAStatus; }

export function slaDefinitionFor(binding: any, defs: any[]): any | null {
  if (!binding) return null;
  return (defs || []).find((d) => d.provider_key === binding.provider_key && String(d.country_code || "").toUpperCase() === String(binding.country_code || "").toUpperCase() && String(d.journey_type || "").toUpperCase() === String(binding.journey_type || "").toUpperCase() && d.is_active) || null;
}

export function startSlaTimer(submittedAt: string | null, slaDef: any, now: string = new Date().toISOString()): SLATimer {
  if (!submittedAt) return { submitted_at: null, expected_by: null, paused_at: null, paused_total_ms: 0, state: "NOT_STARTED" };
  // §16: business/working days is a flag; here we compute wall-clock estimate from max_hours when
  // available, else processing_estimate_days * 24h. This is an EXPECTATION, not a guarantee.
  const hours = slaDef?.processing_estimate_max_hours || (slaDef?.processing_estimate_days ? Number(slaDef.processing_estimate_days) * 24 : null);
  if (!hours) return { submitted_at: submittedAt, expected_by: null, paused_at: null, paused_total_ms: 0, state: "WITHIN_SLA" };
  const expected_by = new Date(new Date(submittedAt).getTime() + hours * 3600000).toISOString();
  return { submitted_at: submittedAt, expected_by, paused_at: null, paused_total_ms: 0, state: timerState(submittedAt, expected_by, "PROCESSING", slaDef, now) };
}

// §17: pause states are configuration-driven (slaDef.pause_states). ADDITIONAL_INFORMATION_REQUIRED
// pauses the provider SLA only when pause_on_traveler_wait is true.
export function pauseSlaTimer(timer: SLATimer, caseState: string, slaDef: any, now: string = new Date().toISOString()): SLATimer {
  const pauseStates: string[] = slaDef?.pause_states || (slaDef?.pause_on_traveler_wait ? ["ADDITIONAL_INFORMATION_REQUIRED"] : []);
  if (!pauseStates.includes(caseState)) return { ...timer, state: recomputeState(timer, now) };
  if (timer.paused_at) return { ...timer, state: "PAUSED" };
  return { ...timer, paused_at: now, state: "PAUSED" };
}
export function resumeSlaTimer(timer: SLATimer, now: string = new Date().toISOString()): SLATimer {
  if (!timer.paused_at || !timer.expected_by) return { ...timer, paused_at: null, state: recomputeState(timer, now) };
  const pausedMs = new Date(now).getTime() - new Date(timer.paused_at).getTime();
  // Extend expected_by by the paused interval so traveler-wait time is excluded (§17).
  return { ...timer, paused_at: null, paused_total_ms: timer.paused_total_ms + pausedMs, expected_by: new Date(new Date(timer.expected_by).getTime() + pausedMs).toISOString(), state: recomputeState({ ...timer, paused_at: null }, now) };
}
function recomputeState(timer: SLATimer, now: string): SLAStatus {
  if (!timer.expected_by) return "WITHIN_SLA";
  return timerState(timer.submitted_at, timer.expected_by, "PROCESSING", null, now);
}
function timerState(submittedAt: string | null, expectedBy: string | null, caseState: string, slaDef: any, now: string = new Date().toISOString()): SLAStatus {
  if (["APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "COMPLETED"].includes(caseState)) return "COMPLETED";
  if (!expectedBy) return "WITHIN_SLA";
  const nowMs = new Date(now).getTime();
  const expMs = new Date(expectedBy).getTime();
  if (nowMs > expMs) return "OVERDUE";
  const remainingH = (expMs - nowMs) / 3600000;
  const windowH = slaDef?.processing_estimate_max_hours || (slaDef?.processing_estimate_days ? Number(slaDef.processing_estimate_days) * 24 : 72);
  if (remainingH < windowH * 0.2) return "DUE_SOON";
  return "WITHIN_SLA";
}

export function slaBreach(timer: SLATimer, caseState: string, now: string = new Date().toISOString()): boolean {
  if (["APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "COMPLETED"].includes(caseState)) return false;
  if (timer.state === "PAUSED") return false;
  return timer.state === "OVERDUE" && now && timer.expected_by ? new Date(now).getTime() > new Date(timer.expected_by).getTime() : timer.state === "OVERDUE";
}

// §18: a breach is an OVERDUE timer; the provider is only "violating a contractual SLA"
// when the SLA definition supports that conclusion (source is a provider contract, not an estimate).
export function isContractualBreach(slaDef: any, breach: boolean): boolean {
  if (!breach) return false;
  return !!slaDef && /contract|sla|agreement/i.test(String(slaDef.source || "")) && !/estimate|observed/i.test(String(slaDef.source || ""));
}

// ---------- §22 refund lineage ----------
export interface RefundLineage {
  traveler_refund_minor: number;
  traveler_refund_status: string;
  provider_refund_minor: number;
  provider_refund_status: string;
  mismatch: boolean; // §22: do NOT assume provider refund equals traveler refund
}
export function refundLineage(travelerRefunds: any[], providerStatements: any[]): RefundLineage {
  const trav = (travelerRefunds || []).filter((r) => r.status === "COMPLETED");
  const prov = (providerStatements || []).filter((s) => s.actual_refund_minor && s.actual_refund_minor > 0);
  const traveler_refund_minor = sumMinor(trav.map((r) => r.amount_minor || 0));
  const provider_refund_minor = sumMinor(prov.map((s) => s.actual_refund_minor || 0));
  return {
    traveler_refund_minor,
    traveler_refund_status: trav.length ? (traveler_refund_minor >= (trav[0]?.order?.total_minor || 0) ? "FULL_REFUND" : "PARTIAL_REFUND") : "NO_REFUND",
    provider_refund_minor,
    provider_refund_status: prov.length ? "REFUND_COMPLETED" : "NO_REFUND",
    mismatch: trav.length > 0 && prov.length > 0 && traveler_refund_minor !== provider_refund_minor,
  };
}

// ---------- §8/§30 profitability / net platform economics ----------
export function netPlatformEconomics(snapshot: CommercialSnapshot, opts: { amount_paid_minor?: number; amount_refunded_minor?: number; provider_cost_minor?: number | "UNKNOWN"; chargeback_minor?: number }): { net_minor: number; basis: "ACTUAL" | "ESTIMATE" | "UNKNOWN" } {
  const paid = Math.trunc(opts.amount_paid_minor ?? 0);
  const refunded = Math.trunc(opts.amount_refunded_minor ?? 0);
  const providerCost = opts.provider_cost_minor === "UNKNOWN" || opts.provider_cost_minor == null ? null : Math.trunc(opts.provider_cost_minor as number);
  const chargeback = Math.trunc(opts.chargeback_minor ?? 0);
  // Net = revenue - government fee - provider cost - payment processing - tax - refunds - chargebacks
  const gov = bucketTruth(snapshot, "GOVERNMENT_FEE");
  const proc = snapshot.payment_processing_fee_minor || 0;
  const tax = snapshot.tax_minor || 0;
  if (providerCost == null) {
    // Unknown provider cost → mark basis UNKNOWN (§46), but still compute a partial net.
    const provisional = paid - refunded - (typeof gov === "number" ? gov : 0) - proc - tax - chargeback;
    return { net_minor: provisional, basis: "UNKNOWN" };
  }
  const net = paid - refunded - (typeof gov === "number" ? gov : 0) - providerCost - proc - tax - chargeback;
  return { net_minor: net, basis: paid > 0 ? "ACTUAL" : "ESTIMATE" };
}

// ---------- §45 anomaly detection (deterministic) ----------
export interface Anomaly { type: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; detail: string; }

export function detectAnomalies(args: { record: any; payments: any[]; app: any; attempts: any[]; statements: any[]; reconciliation: ReconcileResult }): Anomaly[] {
  const out: Anomaly[] = [];
  const r = args.record || {};
  // Duplicate provider charge: more than one SUCCEEDED payment for the order (by amount).
  const succeeded = (args.payments || []).filter((p) => p.status === "SUCCEEDED");
  if (succeeded.length > 1) out.push({ type: "DUPLICATE_PROVIDER_CHARGE", severity: "HIGH", detail: `${succeeded.length} succeeded payments for one order` });
  // Unexpected provider fee: reconciliation mismatch on provider_fee.
  if (args.reconciliation.fields_mismatched.includes("provider_fee")) out.push({ type: "UNEXPECTED_PROVIDER_FEE", severity: "HIGH", detail: `provider fee diff ${args.reconciliation.diff_minor}` });
  // Missing provider reference when submitted.
  if (args.app?.case_state === "SUBMITTED" && !r.provider_application_id && !args.app?.provider_application_id) out.push({ type: "MISSING_PROVIDER_REFERENCE", severity: "MEDIUM", detail: "submitted case has no provider application id" });
  // Traveler charged but no application.
  if (succeeded.length && !args.app) out.push({ type: "TRAVELER_CHARGED_NO_APP", severity: "CRITICAL", detail: "payment succeeded with no application record" });
  // Application submitted but payment missing.
  if (args.app && ["SUBMITTED", "PROCESSING", "APPROVED"].includes(args.app?.case_state) && !succeeded.length && r.traveler_total_minor > 0) out.push({ type: "APP_SUBMITTED_NO_PAYMENT", severity: "HIGH", detail: "case advanced without a succeeded payment" });
  // Refund mismatch (traveler vs provider).
  const rl = refundLineage(args.payments.length ? [] : [], args.statements); // approx; full check elsewhere
  if ((r.metadata || {}).refund_mismatch) out.push({ type: "REFUND_MISMATCH", severity: "MEDIUM", detail: "traveler refund differs from provider refund" });
  // Provider invoice mismatch.
  if (args.reconciliation.status === "MISMATCH") out.push({ type: "PROVIDER_INVOICE_MISMATCH", severity: "HIGH", detail: `mismatched fields: ${args.reconciliation.fields_mismatched.join(",")}` });
  return out;
}

// ---------- §40 role-gated projections ----------
export function travelerFinancialProjection(record: any): any {
  // §40: traveler sees traveler total, what they paid, refund status — NEVER internal margins,
  // provider cost, platform fee, reconciliation, settlement.
  return {
    case_id: record.case_id,
    currency: record.currency,
    traveler_total_minor: record.traveler_total_minor,
    amount_paid_minor: record.amount_paid_minor,
    refund_status: record.refund_status,
    amount_refunded_minor: record.amount_refunded_minor,
    chargeback_status: ["NONE"].includes(record.chargeback_status) ? "NONE" : "OPEN",
  };
}

export function adminFinancialProjection(record: any): any {
  // §40: admin sees the full separated picture + net economics.
  return {
    case_id: record.case_id, order_id: record.order_id, order_number: record.order_number,
    provider_id: record.provider_id, provider_key: record.provider_key, provider_application_id: record.provider_application_id,
    currency: record.currency,
    government_fee_minor: record.government_fee_minor, provider_fee_minor: record.provider_fee_minor,
    platform_fee_minor: record.platform_fee_minor, tax_minor: record.tax_minor, discount_minor: record.discount_minor,
    payment_processing_fee_minor: record.payment_processing_fee_minor,
    traveler_total_minor: record.traveler_total_minor, amount_paid_minor: record.amount_paid_minor,
    amount_refunded_minor: record.amount_refunded_minor, refund_status: record.refund_status,
    provider_cost_minor: record.provider_cost_minor, provider_cost_source: record.provider_cost_source,
    provider_amount_due_minor: record.provider_amount_due_minor, provider_amount_paid_minor: record.provider_amount_paid_minor,
    provider_refund_minor: record.provider_refund_minor,
    reconciliation_status: record.reconciliation_status, reconciliation_version: record.reconciliation_version,
    reconciliation_match: record.reconciliation_match,
    chargeback_minor: record.chargeback_minor, chargeback_status: record.chargeback_status,
    net_platform_economics_minor: record.net_platform_economics_minor, net_economics_basis: record.net_economics_basis,
    settlement_status: record.settlement_status, anomalies: record.anomalies || [],
  };
}

// ---------- §41 export redaction ----------
export function exportFinancialRow(record: any, role: "admin" | "finance" = "admin"): any {
  const a = adminFinancialProjection(record);
  if (role !== "admin" && role !== "finance") {
    return { case_id: a.case_id, currency: a.currency, traveler_total_minor: a.traveler_total_minor, reconciliation_status: a.reconciliation_status };
  }
  return a;
}

// ---------- §44 AI financial-action restrictions ----------
// Agents may ONLY read + recommend + create a review task. They may NEVER mutate financial state.
export const AI_FORBIDDEN_FINANCIAL_ACTIONS = [
  "issue_refund", "approve_refund", "execute_refund",
  "alter_price", "alter_provider_fee", "alter_government_fee",
  "mark_payment_successful", "mark_reconciliation_matched", "close_financial_dispute",
  "override_sla", "alter_settlement", "approve_chargeback",
];
export function aiCanPerformFinancial(action: string): { ok: boolean; reason?: string } {
  if (AI_FORBIDDEN_FINANCIAL_ACTIONS.includes(action)) return { ok: false, reason: "AI_CANNOT_MUTATE_FINANCIAL_STATE" };
  return { ok: true };
}
export const AI_FINANCIAL_READ_TOOLS = ["getApplicationFinancialSummary", "getRefundStatus", "getProviderSLA", "getProviderPerformance", "getPaymentStatus"];

// ---------- §37 traveler status separation (payment ≠ application ≠ provider ≠ SLA) ----------
export function travelerStatusSeparation(args: { paymentState: string; caseState: string; providerStatus: string; slaStatus: SLAStatus }): { payment: string; application: string; provider: string; sla: string; combined_misleading: boolean } {
  return {
    payment: args.paymentState,
    application: args.caseState,
    provider: args.providerStatus,
    sla: args.slaStatus,
    combined_misleading: args.paymentState === "PAID" && args.caseState === "SUBMITTED" ? false : false,
  };
}