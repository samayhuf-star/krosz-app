// Worldz Visa (Phase 37) — regression + live verification runner.
// Runs the full pure contract suite (now including Phase 37) and a live
// publish / supersede / rollback / impact test against the real IntelligenceVersion
// entity store, using a throwaway test country (ZZ) that is cleaned up after.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { runEntryContractTests } from "../../shared/visa/entry/contract.ts";
import { runDataContractTests } from "../../shared/visa/data/contract.ts";
import { runMvpEngineContractTests } from "../../shared/visa/mvp/contract.ts";
import { publishIntelligenceVersion, rollbackIntelligenceVersion, currentPublishedVersion, computeCaseImpact } from "../../shared/visa/intelligence/versionStore.ts";
import { revalidationResultFor, versionLockForCase } from "../../shared/visa/intelligence/versioning.ts";
import { createFinancialRecord, importProviderStatement, recordRefundLineage } from "../../shared/visa/finance/store.ts";

export default async function (req: Request): Promise<Response> {
  const contract = runEntryContractTests();
  const dataContract = runDataContractTests();
  const mvpEngineContract = runMvpEngineContractTests();

  // ---- live happy-path (against the real entity store) ----
  const base44 = createClientFromRequest(req);
  const svc = base44.asServiceRole;
  const live: any = { ok: false, steps: {} };
  const country = "ZZ", journey = "EVISA";
  const ADMIN = { role: "admin", id: "regression-runner" };
  // cleanup any prior test versions.
  await svc.entities.IntelligenceVersion.deleteMany({ country, journey }).catch(() => null);

  try {
    // Publish v1 (LOW, no material change).
    const r1 = await publishIntelligenceVersion(svc, ADMIN, { country, journey, data_version: "ZZ-EVISA-v1", confidence: "HIGH", change_summary: { materialFields: [], changedFields: [], previous_data_version: null } });
    live.steps.p1 = r1.ok;
    live.v1_id = r1.version?.id || null;

    // Publish v2 (HIGH — fee change).
    const r2 = await publishIntelligenceVersion(svc, ADMIN, { country, journey, data_version: "ZZ-EVISA-v2", confidence: "HIGH", change_summary: { materialFields: ["fee_government_minor"], changedFields: ["fee_government_minor"], previous_data_version: "ZZ-EVISA-v1", severity: "HIGH", affectsExecution: false, source: { name: "regression-source" } } });
    live.steps.p2 = r2.ok;
    live.v2_id = r2.version?.id || null;
    live.steps.superseded = !!r2.previous_superseded && r2.previous_superseded.data_version === "ZZ-EVISA-v1";

    // Current published should be v2.
    const cur = await currentPublishedVersion(svc, country, journey);
    live.steps.current_is_v2 = cur?.data_version === "ZZ-EVISA-v2";

    // Reactivate v1 via rollback.
    const rb = await rollbackIntelligenceVersion(svc, ADMIN, r1.version.id, "regression rollback");
    live.steps.rollback = !!rb?.ok && !!rb?.rolledTo;
    live.steps.current_superseded_is_v2 = rb?.currentSuperseded?.data_version === "ZZ-EVISA-v2";

    // After rollback, current published should be v1 again; v2 preserved as SUPERSEDED.
    const cur2 = await currentPublishedVersion(svc, country, journey);
    live.steps.current_is_v1_after_rollback = cur2?.data_version === "ZZ-EVISA-v1";
    const v2Row = await svc.entities.IntelligenceVersion.get(r2.version.id).catch(() => null);
    live.steps.v2_preserved_as_superseded = v2Row?.status === "SUPERSEDED";

    // Revalidation: a case locked at v2 against current v1 → non-UNCHANGED.
    const fakeApp = { case_state: "DOCUMENTS_REQUIRED", case_snapshot: { version_lock: { intelligence_version: "ZZ-EVISA-v2" } } };
    const lock = versionLockForCase(fakeApp);
    live.steps.revalidation_non_unchanged = revalidationResultFor({ lock, currentVersionId: cur2?.data_version, severityOfChange: "HIGH", affectsExecution: false, caseState: fakeApp.case_state }) === "ACTION_REQUIRED";

    // Impact computation runs without error.
    const impact = await computeCaseImpact(svc, country, journey, "ZZ-EVISA-v2", "HIGH", false);
    live.steps.impact_score_number = typeof impact.impact_score === "number";

    live.ok = live.steps.p1 && live.steps.p2 && live.steps.superseded && live.steps.current_is_v2 && live.steps.rollback && live.steps.current_superseded_is_v2 && live.steps.current_is_v1_after_rollback && live.steps.v2_preserved_as_superseded && live.steps.revalidation_non_unchanged && live.steps.impact_score_number;
  } catch (e: any) {
    live.error = String(e?.message || e);
  } finally {
    // cleanup test versions (never leave test data in production store).
    await svc.entities.IntelligenceVersion.deleteMany({ country, journey }).catch(() => null);
  }

  // ---- Phase 38 live happy-path: financial record + statement import + reconciliation + refund lineage ----
  const live38: any = { ok: false, steps: {} };
  const finCountry = "ZZ", finCaseId = "regression-finance-case";
  try {
    // Synthetic order + app for the throwaway case.
    const order = { id: "regression-order", order_number: "REG-1", application_id: finCaseId, traveler_id: "reg-trav", currency: "INR", total_minor: 4000, price_version: "p.v1", price_snapshot: { price_version: "p.v1", currency: "INR", components: [{ type: "GOVERNMENT_FEE", code: "gov", amount_minor: 2500 }, { type: "SERVICE_FEE", code: "orizn", amount_minor: 1500 }] } };
    const app = { id: finCaseId, case_state: "SUBMITTED", traveler_id: "reg-trav", provider_key: "GOV_ZZ", provider_application_id: "PROV-REG-1", destination: finCountry, organization_id: null };
    await svc.entities.ApplicationFinancialRecord.deleteMany({ case_id: finCaseId }).catch(() : any => null);
    await svc.entities.ProviderStatement.deleteMany({ provider_key: "GOV_ZZ" }).catch(() : any => null);

    const fr = await createFinancialRecord(svc, order, app, { government_fee_data_version: "ZZ-EVISA-v1" });
    live38.steps.record_created = !!fr?.record?.id;
    live38.steps.gov_fee = fr?.record?.government_fee_minor === 2500;
    live38.steps.provider_fee_unknown = fr?.record?.provider_cost_minor === 0 && fr?.record?.provider_cost_source === "UNKNOWN";

    // Statement import (MATCHED) — case_id hint resolves the case directly.
    const st1 = await importProviderStatement(svc, { provider_key: "GOV_ZZ", statement_id: "STMT-A", record_id: "R1", currency: "INR", case_id: finCaseId, provider_application_id: "PROV-REG-1", actual_provider_fee_minor: 0 });
    live38.steps.statement_matched = st1?.reconciliation?.status === "MATCHED";

    // Mismatched statement (provider fee diff) — idempotent via different record_id.
    const st2 = await importProviderStatement(svc, { provider_key: "GOV_ZZ", statement_id: "STMT-B", record_id: "R1", currency: "INR", case_id: finCaseId, provider_application_id: "PROV-REG-1", actual_provider_fee_minor: 500 });
    live38.steps.mismatch_detected = st2?.reconciliation?.status === "MISMATCH";
    live38.steps.mismatch_task_created = !!st2?.task?.id;

    // Duplicate import of the same statement is idempotent.
    const dup = await importProviderStatement(svc, { provider_key: "GOV_ZZ", statement_id: "STMT-A", record_id: "R1", currency: "INR", case_id: finCaseId, provider_application_id: "PROV-REG-1", actual_provider_fee_minor: 0 });
    live38.steps.duplicate_idempotent = dup?.idempotent === true;

    // Refund lineage recompute (no refunds yet → NO_REFUND).
    const rl = await recordRefundLineage(svc, fr.record);
    live38.steps.refund_recompute = rl?.refund_status === "NO_REFUND";

    live38.ok = live38.steps.record_created && live38.steps.gov_fee && live38.steps.provider_fee_unknown && live38.steps.statement_matched && live38.steps.mismatch_detected && live38.steps.mismatch_task_created && live38.steps.duplicate_idempotent && live38.steps.refund_recompute;
  } catch (e: any) {
    live38.error = String(e?.message || e);
  } finally {
    await svc.entities.ApplicationFinancialRecord.deleteMany({ case_id: finCaseId }).catch(() : any => null);
    await svc.entities.ProviderStatement.deleteMany({ provider_key: "GOV_ZZ" }).catch(() : any => null);
    await svc.entities.OperationsTask.deleteMany({ case_id: finCaseId }).catch(() : any => null);
    await svc.entities.FinancialAuditEvent.deleteMany({ case_id: finCaseId }).catch(() : any => null);
    await svc.entities.VisaApplication.deleteMany({ traveler_id: "reg-trav" }).catch(() : any => null);
  }

  return Response.json({ contract, dataContract, mvpEngineContract, live, live38 });
}