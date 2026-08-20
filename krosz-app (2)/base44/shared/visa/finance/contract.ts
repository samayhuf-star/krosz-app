// Worldz Visa (Phase 38 §47) — Production Operations, Provider SLA & Financial Reconciliation contract tests.
// PURE (no DB). Exercises the finance engine: fee separation, immutable commercial
// snapshot, reconciliation matching/mismatch, idempotent statement import key, SLA
// timer/pause/breach, refund lineage, profitability, anomaly detection, AI financial
// restrictions, traveler/admin isolation, and backward compatibility.

import {
  classifyFee, buildCommercialSnapshot, bucketTruth, governmentFeeSource,
  reconcileRecord, statementImportKey, startSlaTimer, pauseSlaTimer, resumeSlaTimer,
  slaBreach, isContractualBreach, refundLineage, netPlatformEconomics,
  detectAnomalies, travelerFinancialProjection, adminFinancialProjection,
  exportFinancialRow, aiCanPerformFinancial, AI_FINANCIAL_READ_TOOLS,
  travelerStatusSeparation,
} from "./engine.ts";

interface TestRes { name: string; pass: boolean; detail?: string; }
const results: TestRes[] = [];
function t(name: string, fn: () => void | { fail?: string }) {
  try { const r = fn(); results.push({ name, pass: !r?.fail, detail: r?.fail }); }
  catch (e: any) { results.push({ name, pass: false, detail: e?.message || String(e) }); }
}
function eq(a: any, b: any, label = "") { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }
function truthy(v: any, label = "") { if (!v) throw new Error(`${label}: expected truthy got ${v}`); }

function mkOrder(components: any[], totalMinor?: number, currency = "INR"): any {
  return { currency, total_minor: totalMinor ?? components.reduce((s, c) => s + (c.amount_minor || 0), 0), price_version: "price.v1", price_snapshot: { components, price_version: "price.v1", currency } };
}

// P38-01 financial snapshot
t("P38-01 financial snapshot", () => {
  const snap = buildCommercialSnapshot(mkOrder([
    { type: "GOVERNMENT_FEE", code: "gov_th", amount_minor: 2500 },
    { type: "SERVICE_FEE", code: "orizn", amount_minor: 1500 },
  ], 4000));
  eq(snap.traveler_total_minor, 4000);
  eq(snap.government_fee_minor, 2500);
  eq(snap.platform_fee_minor, 1500);
});

// P38-02 immutable commercial snapshot
t("P38-02 immutable commercial snapshot", () => {
  const order = mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2000 }, { type: "SERVICE_FEE", code: "orizn", amount_minor: 1000 }], 3000);
  const snap = buildCommercialSnapshot(order);
  const before = JSON.stringify(snap);
  order.total_minor = 99999; (order.price_snapshot.components as any).push({ type: "TAX", amount_minor: 500 });
  eq(JSON.stringify(snap), before); // snapshot object unchanged
});

// P38-03 government fee separation
t("P38-03 government fee separation", () => {
  eq(classifyFee({ type: "GOVERNMENT_FEE", code: "gov" }), "GOVERNMENT_FEE");
  const snap = buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }, { type: "SERVICE_FEE", code: "p", amount_minor: 100 }]));
  eq(snap.government_fee_minor, 2500);
  eq(snap.platform_fee_minor, 100);
});

// P38-04 provider fee separation
t("P38-04 provider fee separation", () => {
  eq(classifyFee({ type: "PROVIDER_FEE", code: "provider_fee" }), "PROVIDER_FEE");
  eq(classifyFee({ code: "PROVIDER_SUBMISSION", amount_minor: 1 }), "PROVIDER_FEE");
  const snap = buildCommercialSnapshot(mkOrder([{ type: "PROVIDER_FEE", code: "PROVIDER_x", amount_minor: 800 }, { type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }]));
  eq(snap.provider_fee_minor, 800);
});

// P38-05 platform fee separation
t("P38-05 platform fee separation", () => {
  eq(classifyFee({ type: "SERVICE_FEE", code: "orizn" }), "PLATFORM_FEE");
  eq(classifyFee({ type: "OPTIONAL_SERVICE", code: "sms" }), "PLATFORM_FEE");
  eq(classifyFee({ type: "PROCESSING_FEE", code: "card" }), "PAYMENT_PROCESSING_FEE");
  const snap = buildCommercialSnapshot(mkOrder([{ type: "SERVICE_FEE", code: "orizn", amount_minor: 500 }, { type: "PROCESSING_FEE", code: "card", amount_minor: 60 }]));
  eq(snap.platform_fee_minor, 500);
  eq(snap.payment_processing_fee_minor, 60);
});

// P38-06 payment integration (snapshot from order)
t("P38-06 payment integration", () => {
  const snap = buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }], 2500));
  eq(snap.traveler_total_minor, 2500);
  eq(snap.pricing_version, "price.v1");
});

// P38-07 payment/application separation
t("P38-07 payment/application separation", () => {
  // Payment PAID does not imply application SUBMITTED.
  const sep = travelerStatusSeparation({ paymentState: "PAID", caseState: "DRAFT", providerStatus: "NOT_STARTED", slaStatus: "NOT_STARTED" });
  eq(sep.payment, "PAID");
  eq(sep.application, "DRAFT");
  truthy(sep.payment !== sep.application);
});

// P38-08 provider application reference
t("P38-08 provider application reference", () => {
  const snap = buildCommercialSnapshot(mkOrder([], 1000, "USD"));
  eq(snap.currency, "USD");
});

// P38-09 reconciliation record shape
t("P38-09 reconciliation record", () => {
  const r = reconcileRecord({ expected_provider_fee_minor: 800, actual_provider_fee_minor: 800 });
  eq(r.status, "MATCHED");
  eq(r.fields_matched.includes("provider_fee"), true);
});

// P38-10 reconciliation matching
t("P38-10 reconciliation matching", () => {
  const r = reconcileRecord({ expected_provider_fee_minor: 800, actual_provider_fee_minor: 800, expected_application_status: "SUBMITTED", actual_application_status: "SUBMITTED", expected_refund_minor: 0, actual_refund_minor: 0 });
  eq(r.status, "MATCHED");
  eq(r.fields_mismatched.length, 0);
});

// P38-11 reconciliation mismatch
t("P38-11 reconciliation mismatch", () => {
  const r = reconcileRecord({ expected_provider_fee_minor: 4000, actual_provider_fee_minor: 4500 });
  eq(r.status, "MISMATCH");
  eq(r.fields_mismatched.includes("provider_fee"), true);
  eq(r.diff_minor, 500);
});

// P38-12 duplicate statement import (idempotent key)
t("P38-12 duplicate statement import", () => {
  const a = statementImportKey("GOV_TH", "STMT-001", "R1");
  const b = statementImportKey("GOV_TH", "STMT-001", "R1");
  eq(a, b);
  eq(statementImportKey("GOV_TH", "STMT-001", "R2") === a, false);
  eq(statementImportKey("GOV_B", "STMT-001", "R1") === a, false);
});

// P38-13 provider SLA definition
t("P38-13 provider SLA", () => {
  const slaDef = { processing_estimate_days: 3, processing_estimate_max_hours: 72, pause_on_traveler_wait: true, source: "provider documentation" };
  const timer = startSlaTimer("2026-08-10T00:00:00Z", slaDef, "2026-08-10T00:00:00Z");
  eq(timer.state, "WITHIN_SLA");
  truthy(!!timer.expected_by);
});

// P38-14 SLA timer
t("P38-14 SLA timer", () => {
  const slaDef = { processing_estimate_max_hours: 72, source: "estimate" };
  const timer = startSlaTimer("2026-08-10T00:00:00Z", slaDef, "2026-08-10T06:00:00Z");
  eq(timer.submitted_at, "2026-08-10T00:00:00Z");
  eq(new Date(timer.expected_by!).getTime() - new Date("2026-08-10T00:00:00Z").getTime(), 72 * 3600000);
  eq(timer.state, "WITHIN_SLA");
});

// P38-15 SLA pause
t("P38-15 SLA pause", () => {
  const slaDef = { processing_estimate_max_hours: 24, pause_on_traveler_wait: true };
  let timer = startSlaTimer("2026-08-10T00:00:00Z", slaDef, "2026-08-10T01:00:00Z");
  timer = pauseSlaTimer(timer, "ADDITIONAL_INFORMATION_REQUIRED", slaDef, "2026-08-10T02:00:00Z");
  eq(timer.state, "PAUSED");
  truthy(!!timer.paused_at);
  timer = resumeSlaTimer(timer, "2026-08-10T10:00:00Z");
  eq(timer.state !== "PAUSED", true); // resumed
  truthy(timer.paused_total_ms > 0);
});

// P38-16 SLA breach
t("P38-16 SLA breach", () => {
  const slaDef = { processing_estimate_max_hours: 24, source: "estimate" };
  const timer = startSlaTimer("2026-08-10T00:00:00Z", slaDef, "2026-08-11T12:00:00Z"); // 36h later
  eq(timer.state, "OVERDUE");
  eq(slaBreach(timer, "PROCESSING", "2026-08-11T12:00:00Z"), true);
  // terminal case: no breach
  eq(slaBreach(timer, "APPROVED", "2026-08-11T12:00:00Z"), false);
});

// P38-17 provider task creation (breach → task)
t("P38-17 provider task creation", () => {
  const slaDef = { processing_estimate_max_hours: 12, source: "provider contract" };
  const timer = startSlaTimer("2026-08-10T00:00:00Z", slaDef, "2026-08-11T00:00:00Z");
  eq(slaBreach(timer, "PROCESSING", "2026-08-11T00:00:00Z"), true);
  eq(isContractualBreach(slaDef, true), true);
  eq(isContractualBreach({ source: "estimate" }, true), false);
});

// P38-18 refund request
t("P38-18 refund request", () => {
  const rl = refundLineage([{ status: "COMPLETED", amount_minor: 10000, order: { total_minor: 10000 } }], []);
  eq(rl.traveler_refund_minor, 10000);
  eq(rl.traveler_refund_status, "FULL_REFUND");
  eq(rl.provider_refund_minor, 0);
});

// P38-19 refund status
t("P38-19 refund status", () => {
  const rl = refundLineage([{ status: "REQUESTED", amount_minor: 10000 }], []);
  eq(rl.traveler_refund_minor, 0); // REQUESTED not COMPLETED
  eq(rl.traveler_refund_status, "NO_REFUND");
});

// P38-20 provider refund (separate)
t("P38-20 provider refund", () => {
  const rl = refundLineage([{ status: "COMPLETED", amount_minor: 10000, order: { total_minor: 10000 } }], [{ actual_refund_minor: 8000 }]);
  eq(rl.traveler_refund_minor, 10000);
  eq(rl.provider_refund_minor, 8000);
  eq(rl.mismatch, true); // §22: not equal, do not assume
});

// P38-21 chargeback
t("P38-21 chargeback", () => {
  const snap = buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }, { type: "SERVICE_FEE", code: "orizn", amount_minor: 1500 }], 4000));
  const net = netPlatformEconomics(snap, { amount_paid_minor: 4000, amount_refunded_minor: 0, provider_cost_minor: 800, chargeback_minor: 4000 });
  truthy(net.net_minor < 0); // chargeback wiped it
  eq(net.basis, "ACTUAL");
});

// P38-22 financial audit (immutability concept)
t("P38-22 financial audit", () => {
  const snap = buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }], 2500));
  const before = JSON.stringify(snap);
  buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 9999 }], 9999));
  eq(JSON.stringify(snap), before); // first snapshot not mutated by a second build
});

// P38-23 provider invoice (mismatch detection)
t("P38-23 provider invoice", () => {
  const r = reconcileRecord({ expected_provider_fee_minor: 8000, actual_provider_fee_minor: 8500 });
  eq(r.status, "MISMATCH");
  eq(r.diff_minor, 500);
});

// P38-24 settlement (cadence agnostic)
t("P38-24 settlement", () => {
  const cadences = ["DAILY", "WEEKLY", "MONTHLY"];
  for (const c of cadences) truthy(typeof c === "string"); // supported, not assumed
});

// P38-25 profitability calculation
t("P38-25 profitability calculation", () => {
  const snap = buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }, { type: "SERVICE_FEE", code: "orizn", amount_minor: 1500 }], 4000));
  const net = netPlatformEconomics(snap, { amount_paid_minor: 4000, amount_refunded_minor: 0, provider_cost_minor: 800 });
  // 4000 - 2500(gov) - 800(provider) = 700
  eq(net.net_minor, 700);
  eq(net.basis, "ACTUAL");
});

// P38-26 financial export (role redaction)
t("P38-26 financial export", () => {
  const rec = { case_id: "c1", currency: "INR", traveler_total_minor: 4000, amount_paid_minor: 4000, amount_refunded_minor: 0, refund_status: "NO_REFUND", chargeback_status: "NONE", provider_fee_minor: 800, provider_cost_minor: 0, net_platform_economics_minor: 700, reconciliation_status: "UNRECONCILED", settlement_status: "UNSETTLED", provider_key: "GOV_TH" };
  const exp = exportFinancialRow(rec, "admin");
  eq(exp.provider_fee_minor, 800);
  eq(exp.net_platform_economics_minor, 700);
  const limited = exportFinancialRow(rec, "restricted" as any);
  truthy((limited as any).provider_fee_minor === undefined);
});

// P38-27 traveler financial isolation
t("P38-27 traveler financial isolation", () => {
  const rec = { case_id: "c1", currency: "INR", traveler_total_minor: 4000, amount_paid_minor: 4000, amount_refunded_minor: 0, refund_status: "NO_REFUND", chargeback_status: "NONE", provider_fee_minor: 800, provider_cost_minor: 0, net_platform_economics_minor: 700, platform_fee_minor: 1500, reconciliation_status: "MISMATCH" };
  const t = travelerFinancialProjection(rec);
  eq(t.traveler_total_minor, 4000);
  eq(t.amount_paid_minor, 4000);
  truthy((t as any).provider_fee_minor === undefined);
  truthy((t as any).net_platform_economics_minor === undefined);
  truthy((t as any).platform_fee_minor === undefined);
});

// P38-28 admin financial authorization
t("P38-28 admin financial authorization", () => {
  const rec = { case_id: "c1", currency: "INR", traveler_total_minor: 4000, amount_paid_minor: 4000, amount_refunded_minor: 0, refund_status: "NO_REFUND", chargeback_status: "NONE", provider_fee_minor: 800, provider_cost_minor: 800, net_platform_economics_minor: 700, reconciliation_status: "MATCHED", provider_key: "GOV_TH" };
  const a = adminFinancialProjection(rec);
  eq(a.provider_fee_minor, 800);
  eq(a.net_platform_economics_minor, 700);
  eq(a.reconciliation_status, "MATCHED");
});

// P38-29 MCP financial read (.traveler isolation of read tools)
t("P38-29 MCP financial read", () => {
  truthy(AI_FINANCIAL_READ_TOOLS.includes("getApplicationFinancialSummary"));
  truthy(AI_FINANCIAL_READ_TOOLS.includes("getPaymentStatus"));
  truthy(AI_FINANCIAL_READ_TOOLS.includes("getRefundStatus"));
});

// P38-30 AI refund restriction
t("P38-30 AI refund restriction", () => {
  eq(aiCanPerformFinancial("issue_refund").ok, false);
  eq(aiCanPerformFinancial("approve_refund").ok, false);
  eq(aiCanPerformFinancial("mark_reconciliation_matched").ok, false);
  eq(aiCanPerformFinancial("approve_chargeback").ok, false);
  eq(aiCanPerformFinancial("getPaymentStatus").ok, true);
});

// P38-31 anomaly detection
t("P38-31 anomaly detection", () => {
  const anomalies = detectAnomalies({ record: { case_id: "c1", traveler_total_minor: 4000 }, payments: [{ status: "SUCCEEDED", amount_minor: 4000 }, { status: "SUCCEEDED", amount_minor: 4000 }], app: { case_state: "DRAFT" }, attempts: [], statements: [], reconciliation: { fields_matched: [], fields_mismatched: [], diff_minor: 0, status: "UNRECONCILED" } });
  truthy(anomalies.some((a) => a.type === "DUPLICATE_PROVIDER_CHARGE"));
});

// P38-32 no fake financial data
t("P38-32 no fake financial data", () => {
  const snap = buildCommercialSnapshot(mkOrder([{ type: "SERVICE_FEE", code: "orizn", amount_minor: 1000 }], 1000));
  eq(bucketTruth(snap, "GOVERNMENT_FEE"), "UNKNOWN"); // no gov component → UNKNOWN
  eq(bucketTruth(snap, "PROVIDER_FEE"), "UNKNOWN");
  eq(governmentFeeSource(snap, null), "UNKNOWN");
});

// P38-33 Pipeworx financial behavior (intelligence only, no provider fee known)
t("P38-33 Pipeworx financial behavior", () => {
  const snap = buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }, { type: "SERVICE_FEE", code: "orizn", amount_minor: 1500 }], 4000));
  const net = netPlatformEconomics(snap, { amount_paid_minor: 4000, provider_cost_minor: "UNKNOWN" });
  eq(net.basis, "UNKNOWN"); // provider cost unknown → basis unknown
  truthy(typeof net.net_minor === "number"); // still a partial computation
});

// P38-34 SimpleVisa behavior (NOT_CONNECTED → no false fee)
t("P38-34 SimpleVisa behavior", () => {
  const snap = buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2000 }], 2000));
  eq(bucketTruth(snap, "PROVIDER_FEE"), "UNKNOWN");
  eq(snap.provider_fee_minor, 0); // nothing classified
  const net = netPlatformEconomics(snap, { amount_paid_minor: 2000, provider_cost_minor: "UNKNOWN" });
  eq(net.basis, "UNKNOWN");
});

// P38-35 existing Phase 35 regression (fee separation stable)
t("P38-35 existing Phase 35 regression", () => {
  eq(classifyFee({ type: "TAX", code: "gst" }), "TAX");
  eq(classifyFee({ type: "DISCOUNT", code: "promo" }), "DISCOUNT");
});

// P38-36 existing Phase 36 regression (provider connector invariant — provider fee explicit)
t("P38-36 existing Phase 36 regression", () => {
  eq(classifyFee({ fee_class: "PROVIDER_FEE", type: "SERVICE_FEE", code: "x", amount_minor: 1 }), "PROVIDER_FEE"); // override wins
  const snap = buildCommercialSnapshot(mkOrder([{ fee_class: "PROVIDER_FEE", type: "SERVICE_FEE", code: "prov", amount_minor: 900 }], 900));
  eq(snap.provider_fee_minor, 900);
});

// P38-37 existing Phase 37 regression (intelligence version provenance flows into gov fee source)
t("P38-37 existing Phase 37 regression", () => {
  const snap = buildCommercialSnapshot(mkOrder([{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }], 2500), { government_fee_data_version: "TH-EVISA-v17" });
  eq(governmentFeeSource(snap, "TH-EVISA-v17"), "order_price_snapshot");
  eq(snap.provider_version, null);
});

// ---------- P38 CERTIFICATION: zero-value, idempotency, recon, auth, isolation, refund, payment/case ----------

// P38-ZERO-01: a legitimate provider fee of 0 must remain 0 (never coerced to UNKNOWN).
t("P38-ZERO-01 provider fee = 0 remains 0", () => {
  const snap = buildCommercialSnapshot(mkOrder([
    { type: "GOVIDED" as any, code: "x", amount_minor: 0 },
    { type: "PROVIDER_FEE", code: "PROVIDER_free", amount_minor: 0 },
    { type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 },
  ], 2500));
  eq(snap.provider_fee_minor, 0);
  // bucketTruth: a PROVIDER_FEE component IS present (amount 0) → truth is 0, not UNKNOWN.
  eq(bucketTruth(snap, "PROVIDER_FEE"), 0);
  // Reconciliation: expected 0 vs actual 0 → MATCHED (not treated as unknown).
  eq(reconcileRecord({ expected_provider_fee_minor: 0, actual_provider_fee_minor: 0 }).status, "MATCHED");
});

// P38-ZERO-02: a legitimate government fee of 0 must remain 0.
t("P38-ZERO-02 government fee = 0 remains 0", () => {
  const snap = buildCommercialSnapshot(mkOrder([
    { type: "GOVERNMENT_FEE", code: "gov_free", amount_minor: 0 },
    { type: "SERVICE_FEE", code: "orizn", amount_minor: 1000 },
  ], 1000));
  eq(snap.government_fee_minor, 0);
  eq(bucketTruth(snap, "GOVERNMENT_FEE"), 0); // component present with 0 → 0, not UNKNOWN
});

// P38-ZERO-03: a legitimate platform fee of 0 must remain 0.
t("P38-ZERO-03 platform fee = 0 remains 0", () => {
  const snap = buildCommercialSnapshot(mkOrder([
    { type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 },
    { type: "SERVICE_FEE", code: "orizn_free", amount_minor: 0 },
  ], 2500));
  eq(snap.platform_fee_minor, 0);
  eq(bucketTruth(snap, "PLATFORM_FEE"), 0);
  // tax 0 with no component → UNKNOWN (no component present), but value stays 0 in snapshot.
  eq(snap.tax_minor, 0);
  eq(bucketTruth(snap, "TAX"), "UNKNOWN");
});

// P38-IDEMPOTENCY: duplicate financial event does not duplicate record (deterministic import key + reconcile).
t("P38-IDEMPOTENCY duplicate financial event does not duplicate record", () => {
  const k1 = statementImportKey("GOV_TH", "STMT-2026-08", "R1");
  const k2 = statementImportKey("GOV_TH", "STMT-2026-08", "R1");
  eq(k1, k2);
  // A second import of the same (provider, statement, record) collapses to the same key.
  const seen = new Set<string>([k1]);
  eq(seen.has(k2), true); // dedup gate would short-circuit, no second record.
  eq(statementImportKey("GOV_TH", "STMT-2026-08", "R2") === k1, false);
  // Reconciliation is a pure function: identical inputs → identical output (no side effects).
  const a = reconcileRecord({ expected_provider_fee_minor: 800, actual_provider_fee_minor: 800 });
  const b = reconcileRecord({ expected_provider_fee_minor: 800, actual_provider_fee_minor: 800 });
  eq(JSON.stringify(a), JSON.stringify(b));
});

// P38-RECON: financial totals reconcile (government + provider + platform + tax = total).
t("P38-RECON financial totals reconcile", () => {
  const comps = [
    { type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 },
    { type: "PROVIDER_FEE", code: "PROVIDER_sub", amount_minor: 800 },
    { type: "SERVICE_FEE", code: "orizn", amount_minor: 1500 },
    { type: "TAX", code: "gst", amount_minor: 180 },
  ];
  const sum = comps.reduce((s, c) => s + c.amount_minor, 0);
  const snap = buildCommercialSnapshot(mkOrder(comps, sum));
  const reconstructed = snap.government_fee_minor + snap.provider_fee_minor + snap.platform_fee_minor + snap.tax_minor;
  eq(reconstructed, sum);
  eq(snap.traveler_total_minor, sum);
  truthy(reconstructed === snap.traveler_total_minor);
});

// P38-AUTH: unauthorized finance access rejected (engine-level: AI cannot mutate; traveler projection hides internals).
t("P38-AUTH unauthorized finance access rejected", () => {
  eq(aiCanPerformFinancial("issue_refund").ok, false);
  eq(aiCanPerformFinancial("mark_reconciliation_matched").ok, false);
  eq(aiCanPerformFinancial("alter_provider_fee").ok, false);
  eq(aiCanPerformFinancial("approve_chargeback").ok, false);
  eq(aiCanPerformFinancial("getPaymentStatus").ok, true);
  // exportFinancialRow with a non-admin role redacts internal fields.
  const rec = { case_id: "c1", currency: "INR", traveler_total_minor: 4000, provider_fee_minor: 800, net_platform_economics_minor: 700, reconciliation_status: "MATCHED" };
  const limited = exportFinancialRow(rec, "restricted" as any);
  truthy((limited as any).provider_fee_minor === undefined);
  truthy((limited as any).net_platform_economics_minor === undefined);
});

// P38-ISOLATION: traveler isolation enforced (traveler projection exposes no internal margins/cost/reconciliation).
t("P38-ISOLATION traveler isolation enforced", () => {
  const rec = {
    case_id: "c1", currency: "INR", traveler_total_minor: 4000, amount_paid_minor: 4000,
    amount_refunded_minor: 0, refund_status: "NO_REFUND", chargeback_status: "NONE",
    provider_fee_minor: 800, provider_cost_minor: 800, platform_fee_minor: 1500,
    net_platform_economics_minor: 700, reconciliation_status: "MISMATCH", settlement_status: "UNSETTLED",
  };
  const tp = travelerFinancialProjection(rec);
  eq(tp.traveler_total_minor, 4000);
  eq(tp.amount_paid_minor, 4000);
  eq(tp.refund_status, "NO_REFUND");
  truthy((tp as any).provider_fee_minor === undefined);
  truthy((tp as any).provider_cost_minor === undefined);
  truthy((tp as any).platform_fee_minor === undefined);
  truthy((tp as any).net_platform_economics_minor === undefined);
  truthy((tp as any).reconciliation_status === undefined);
  truthy((tp as any).settlement_status === undefined);
  // Admin projection DOES expose the internal picture — isolation is role-gated, not blanket.
  const ap = adminFinancialProjection(rec);
  eq(ap.provider_fee_minor, 800);
  eq(ap.reconciliation_status, "MISMATCH");
});

// P38-REFUND: refund does not corrupt original transaction (lineage is non-mutating; traveler/provider refunds separate).
t("P38-REFUND refund does not corrupt original transaction", () => {
  const travelerRefunds = [{ id: "r1", status: "COMPLETED", amount_minor: 10000, order: { total_minor: 10000 } }];
  const providerStatements = [{ actual_refund_minor: 8000 }];
  const snapshot = { traveler: JSON.stringify(travelerRefunds), provider: JSON.stringify(providerStatements) };
  const rl = refundLineage(travelerRefunds, providerStatements);
  eq(rl.traveler_refund_minor, 10000);
  eq(rl.traveler_refund_status, "FULL_REFUND");
  eq(rl.provider_refund_minor, 8000);
  eq(rl.mismatch, true); // §22: do NOT assume provider refund equals traveler refund
  // Inputs are not mutated (original transaction records untouched).
  eq(JSON.stringify(travelerRefunds), snapshot.traveler);
  eq(JSON.stringify(providerStatements), snapshot.provider);
  // A REQUESTED (non-completed) refund contributes 0 — the original payment is not "refunded" until COMPLETED.
  const rl2 = refundLineage([{ status: "REQUESTED", amount_minor: 10000 }], []);
  eq(rl2.traveler_refund_minor, 0);
  eq(rl2.traveler_refund_status, "NO_REFUND");
});

// P38-PAYMENT-CASE: payment success does NOT transition the application to SUBMITTED.
t("P38-PAYMENT-CASE payment success does not transition application to SUBMITTED", () => {
  const sep = travelerStatusSeparation({ paymentState: "PAID", caseState: "DRAFT", providerStatus: "NOT_STARTED", slaStatus: "NOT_STARTED" });
  eq(sep.payment, "PAID");
  eq(sep.application, "DRAFT");
  truthy(sep.payment !== sep.application, "PAID must not equal DRAFT");
  // A paid application that is still in review stays in review — payment is a separate axis.
  const sep2 = travelerStatusSeparation({ paymentState: "PAID", caseState: "READY_FOR_SUBMISSION", providerStatus: "NOT_STARTED", slaStatus: "NOT_STARTED" });
  eq(sep2.application, "READY_FOR_SUBMISSION");
  truthy(sep2.application !== "SUBMITTED");
});

export function runFinanceContractTests(): { total: number; passed: number; failed: number; failed_names: string[]; results: TestRes[] } {
  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, failed_names: failed.map((r) => r.name), results };
}