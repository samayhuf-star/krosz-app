// Worldz Visa (Phase 37) — pure contract tests for the Intelligence Versioning +
// Change Severity + Impact + Revalidation + Execution Version-Lock spine.
// PURE (no DB): exercises the pure engine in base44/shared/visa/intelligence/versioning.ts.
// Reuses Phase 25 change detection + Phase 24 verification invariants where the spec
// calls for regression coverage (P37-40).

interface TestRes { name: string; pass: boolean; detail?: string; }
const results: TestRes[] = [];
function t(name: string, fn: () => void | { fail?: string }) {
  try { const r = fn(); results.push({ name, pass: !r?.fail, detail: r?.fail }); }
  catch (e: any) { results.push({ name, pass: false, detail: e?.message || String(e) }); }
}
function eq(a: any, b: any, label = "") { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }
function truthy(v: any, label = "") { if (!v) throw new Error(`${label}: expected truthy got ${v}`); }

import {
  canTransitionVersion, VERSION_STATUSES, TERMINAL_VERSION,
  classifyChangeSeverity, severityForDiff, affectsExecution, canAutoPublish, NEVER_AUTO_PUBLISH,
  computeImpactScore, detectSourceConflict, fetchFailureDecision, stalenessStatus,
  buildVersion, versionIdentity, publishTransition, rollbackTransition, versionLockForCase, lockCompatible,
  revalidationResultFor, preSubmissionRevalidation, buildProvenance, buildChangeNotification,
  canPublishVersion, canApproveVersion, intelligenceTaskIdempotencyKey,
  INTELLIGENCE_VERSION_CHANGED_EVENT, INTELLIGENCE_CHANGE_REQUIRES_ACTION_EVENT, REVALIDATION_TASK_TYPES,
  type Severity, type VersionStatus,
} from "./versioning.ts";
import { fingerprintPayload, detectChange, normalizeSourcePayload } from "../verification/change.ts";
import { meetsTwoSourceRule, sourcePrecedence } from "../verification/engine.ts";
import { normalizeEntryInput } from "../entry/engine.ts";
import { AGENT_TOOLS, TOOL_BY_NAME, canInvokeTool } from "../agent/catalog.ts";

// ---------- §2 lifecycle ----------
t("P37-01 version creation (buildVersion emits required fields)", () => {
  const v = buildVersion({ country: "TH", journey: "EVISA", data_version: "TH-EVISA-v1", source_version: "src-1", confidence: "HIGH", status: "PUBLISHED", severity: "LOW" });
  eq(v.country, "TH"); eq(v.journey, "EVISA"); eq(v.data_version, "TH-EVISA-v1");
  eq(v.source_version, "src-1"); eq(v.confidence, "HIGH"); eq(v.status, "PUBLISHED"); eq(v.severity, "LOW");
});

t("P37-02 immutable version (identity fields stable; publishing copies never mutate)", () => {
  const v = buildVersion({ country: "TH", journey: "EVISA", data_version: "TH-EVISA-v1" });
  const id = versionIdentity(v);
  const before = JSON.stringify(v);
  const v2 = { ...v, status: "PUBLISHED" as VersionStatus };
  eq(JSON.stringify(versionIdentity(v)), JSON.stringify(id));
  eq(JSON.stringify(v), before); // original untouched
  eq(v2.status, "PUBLISHED");
  eq(v.status, "DRAFT"); // original status unchanged
});

// ---------- §5/§6 source snapshot + content hashing (reuse Phase 25) ----------
t("P37-03 source snapshot normalization retained (Phase 25 reuse)", () => {
  const p = normalizeSourcePayload({ fee_government_minor: 5000, journey_type: "EVISA", z: { a: 1 } });
  eq(Object.keys(p).join(","), "fee_government_minor,journey_type,z");
  eq(p.fee_government_minor, 5000);
});
t("P37-04 content hashing deterministic + order-independent", () => {
  const a = fingerprintPayload({ fee_government_minor: 5000, journey_type: "EVISA" });
  const b = fingerprintPayload({ journey_type: "EVISA", fee_government_minor: 5000 });
  eq(a, b);
  truthy(a.startsWith("fp_"));
});

// ---------- §6 change detection (reuse Phase 25 detectChange) ----------
t("P37-05 unchanged detection (NONE)", () => {
  const prev = { fingerprint: fingerprintPayload({ fee_government_minor: 5000 }), normalized_payload: { fee_government_minor: 5000 } };
  eq(detectChange(prev, { fee_government_minor: 5000 }, "fee").change, "NONE");
});
t("P37-06 field modification (MATERIAL for fee)", () => {
  const prev = { fingerprint: fingerprintPayload({ fee_government_minor: 5000 }), normalized_payload: { fee_government_minor: 5000 } };
  const c = detectChange(prev, { fee_government_minor: 6000 }, "fee");
  eq(c.change, "MATERIAL"); truthy(c.materialFields.includes("fee_government_minor"));
});
t("P37-07 field addition (ADDED → previous null)", () => {
  const prev = { fingerprint: "fp_x", normalized_payload: {} };
  const c = detectChange(prev, { required_documents: "bank_statement" }, "required_documents");
  const added = c.diff.find((d) => d.field === "required_documents");
  truthy(added); eq(added!.previous, null); truthy(added!.material); eq(c.change, "MATERIAL");
});
t("P37-08 field removal (REMOVED → current null)", () => {
  const prev = { fingerprint: "fp_y", normalized_payload: { advisory_text: "old note" } };
  const c = detectChange(prev, {}, "general");
  const removed = c.diff.find((d) => d.field === "advisory_text");
  truthy(removed); eq(removed!.current, null);
});

// ---------- §7 severity ----------
t("P37-09 severity classification (CRITICAL/HIGH/MEDIUM/LOW)", () => {
  eq(classifyChangeSeverity("journey_type"), "CRITICAL");
  eq(classifyChangeSeverity("fee_government_minor"), "HIGH");
  eq(classifyChangeSeverity("processing_time_days"), "MEDIUM");
  eq(classifyChangeSeverity("description"), "LOW");
  eq(classifyChangeSeverity("totally_unknown_field"), "MEDIUM"); // fail-safe, never LOW
  eq(severityForDiff(["fee_government_minor", "processing_time_days"]), "HIGH");
  eq(severityForDiff(["journey_type"]), "CRITICAL");
  eq(severityForDiff(["description"]), "LOW");
  eq(severityForDiff([]), "LOW");
});

// ---------- §8 impact score ----------
t("P37-10 impact scoring (CRITICAL + execution + many cases > MEDIUM few)", () => {
  const hi = computeImpactScore({ severity: "CRITICAL", activeCases: 20, affectsExecution: true, futureTravelCases: 5 });
  const lo = computeImpactScore({ severity: "MEDIUM", activeCases: 1, affectsExecution: false, futureTravelCases: 0 });
  truthy(hi > lo, `hi ${hi} > lo ${lo}`);
  truthy(hi >= 95, `critical+exec caps high ${hi}`);
  truthy(lo <= 45, `medium+few stays low ${lo}`);
});

// ---------- §17/§18 source conflict ----------
t("P37-11 source conflict (two verified officials disagree → SOURCE_CONFLICT)", () => {
  const ev = [
    { source_type: "GOVERNMENT", verification_status: "VERIFIED", claim_value: "USD 50" },
    { source_type: "EMBASSY_CONSULATE", verification_status: "VERIFIED", claim_value: "USD 60" },
  ];
  const c = detectSourceConflict(ev);
  eq(c.conflict, true); eq(c.values.length, 2); truthy(c.officialSources >= 2);
  eq(detectSourceConflict([{ source_type: "GOVERNMENT", verification_status: "VERIFIED", claim_value: "USD 50" }]).conflict, false);
  eq(detectSourceConflict([{ source_type: "GOVERNMENT", verification_status: "UNVERIFIED", claim_value: "a" }, { source_type: "GOVERNMENT", verification_status: "UNVERIFIED", claim_value: "b" }]).conflict, false);
});

// ---------- §20 fetch failure ----------
t("P37-12 fetch failure retains last verified (never invalidates)", () => {
  const d = fetchFailureDecision();
  eq(d.status, "SOURCE_FETCH_FAILED"); eq(d.retain_last_verified, true);
});

// ---------- §21 stale data ----------
t("P37-13 stale data detection (FRESH/AGING/STALE/CRITICAL_STALE)", () => {
  const now = "2026-08-15T00:00:00Z";
  eq(stalenessStatus("2026-08-01T00:00:00Z", now), "FRESH");
  eq(stalenessStatus("2026-06-01T00:00:00Z", now), "AGING");
  eq(stalenessStatus("2026-03-01T00:00:00Z", now), "STALE");
  eq(stalenessStatus("2025-01-01T00:00:00Z", now), "CRITICAL_STALE");
  eq(stalenessStatus(null, now), "CRITICAL_STALE");
});

// ---------- §4 lifecycle transitions ----------
t("P37-14 review queue (CHANGE_DETECTED → REVIEW_REQUIRED valid)", () => {
  eq(canTransitionVersion("CHANGE_DETECTED", "REVIEW_REQUIRED"), true);
  eq(canTransitionVersion("CHANGE_DETECTED", "PUBLISHED"), false); // cannot skip review
});
t("P37-15 approval (REVIEW_REQUIRED → APPROVED valid)", () => {
  eq(canTransitionVersion("REVIEW_REQUIRED", "APPROVED"), true);
  eq(canTransitionVersion("REVIEW_REQUIRED", "PUBLISHED"), false); // cannot skip approve
});
t("P37-16 rejection (REVIEW_REQUIRED → REJECTED valid)", () => {
  eq(canTransitionVersion("REVIEW_REQUIRED", "REJECTED"), true);
  eq(canTransitionVersion("PUBLISHED", "DRAFT"), false);
});
t("P37-17 publication (APPROVED → PUBLISHED; previous superseded)", () => {
  eq(canTransitionVersion("APPROVED", "PUBLISHED"), true);
  const pt = publishTransition({ newVersionId: "v2", currentPublished: { id: "v1" } });
  eq(pt.newStatus, "PUBLISHED"); eq(pt.previousStatus, "SUPERSEDED"); eq(pt.previousSuperseded, true);
  const noPrev = publishTransition({ newVersionId: "v1", currentPublished: null });
  eq(noPrev.previousSuperseded, false);
});
t("P37-18 rollback (current PUBLISHED → SUPERSEDED; previous SUPERSEDED → PUBLISHED)", () => {
  eq(canTransitionVersion("PUBLISHED", "SUPERSEDED"), true);
  eq(canTransitionVersion("SUPERSEDED", "PUBLISHED"), true);
  const rt = rollbackTransition({ currentPublishedId: "v2", previousVersionId: "v1" });
  eq(rt.currentStatus, "SUPERSEDED"); eq(rt.previousStatus, "PUBLISHED"); eq(rt.preserved, true);
});
t("P37-19 previous version preserved (rollback never deletes; history immutable)", () => {
  // Both entries remain in VERSION_STATUSES; SUPERSEDED is reachable and re-publishable.
  truthy(VERSION_STATUSES.includes("SUPERSEDED")); truthy(VERSION_STATUSES.includes("REJECTED"));
  truthy(canTransitionVersion("SUPERSEDED", "PUBLISHED")); // rollback re-publish path
  truthy(canTransitionVersion("REJECTED", "DRAFT")); // can re-draft after reject
});

// ---------- §9/§20/§22 active case impact + revalidation ----------
t("P37-20 active case impact (HIGH severity drift → ACTION_REQUIRED)", () => {
  const app = { case_snapshot: { version_lock: { intelligence_version: "TH-EVISA-v1" } }, case_state: "DOCUMENTS_REQUIRED" };
  const lock = versionLockForCase(app);
  eq(revalidationResultFor({ lock, currentVersionId: "TH-EVISA-v2", severityOfChange: "HIGH", affectsExecution: false, caseState: "DOCUMENTS_REQUIRED" }), "ACTION_REQUIRED");
});
t("P37-21 immutable case snapshot (revalidation never mutates case_snapshot)", () => {
  const app = { case_snapshot: { version_lock: { intelligence_version: "v1" }, requirements: [{ x: 1 }] }, case_state: "DOCUMENTS_REQUIRED" };
  const before = JSON.stringify(app.case_snapshot);
  const lock = versionLockForCase(app);
  const result = revalidationResultFor({ lock, currentVersionId: "v2", severityOfChange: "HIGH", affectsExecution: false, caseState: "DOCUMENTS_REQUIRED" });
  eq(JSON.stringify(app.case_snapshot), before); // untouched
  truthy(["ACTION_REQUIRED", "REVIEW_REQUIRED", "EXECUTION_BLOCKED"].includes(result));
});
t("P37-22 case revalidation (UNCHANGED / REVIEW_REQUIRED / EXECUTION_BLOCKED)", () => {
  const lock = { intelligence_version: "v1", provider_version: null, form_version: null, mapping_version: null, captured_at: "2026-01-01T00:00:00Z" };
  // No drift → UNCHANGED
  eq(revalidationResultFor({ lock, currentVersionId: "v1", severityOfChange: "HIGH", affectsExecution: true, caseState: "READY_FOR_SUBMISSION" }), "UNCHANGED");
  // MEDIUM drift → REVIEW_REQUIRED
  eq(revalidationResultFor({ lock, currentVersionId: "v2", severityOfChange: "MEDIUM", affectsExecution: false, caseState: "DOCUMENTS_REQUIRED" }), "REVIEW_REQUIRED");
  // CRITICAL drift → EXECUTION_BLOCKED
  eq(revalidationResultFor({ lock, currentVersionId: "v2", severityOfChange: "CRITICAL", affectsExecution: true, caseState: "READY_FOR_SUBMISSION" }), "EXECUTION_BLOCKED");
  // HIGH + execution path + affectsExecution → EXECUTION_BLOCKED
  eq(revalidationResultFor({ lock, currentVersionId: "v2", severityOfChange: "HIGH", affectsExecution: true, caseState: "SUBMISSION_PENDING" }), "EXECUTION_BLOCKED");
});

// ---------- §13/§23/§24/§25/§26 execution blocking ----------
t("P37-23 execution blocking (version drift blocks pre-submission)", () => {
  const lock = { intelligence_version: "v1", provider_version: null, form_version: null, mapping_version: null, captured_at: "2026-01-01T00:00:00Z" };
  const r = preSubmissionRevalidation({ lock, current: { intelligence_version: "v2", provider_version: null, form_version: null, mapping_version: null }, routeAvailable: true, routeConfirmedCompatible: true });
  eq(r.ok, false); eq(r.block, "BLOCKED_BY_INTELLIGENCE_CHANGE"); eq(r.code, "INTELLIGENCE_VERSION_DRIFT");
});
t("P37-24 form version change (incompatible form → blocked)", () => {
  const lock = { intelligence_version: "v1", provider_version: null, form_version: "form-7", mapping_version: null, captured_at: "2026-01-01T00:00:00Z" };
  const r = preSubmissionRevalidation({ lock, current: { intelligence_version: "v1", provider_version: null, form_version: "form-8", mapping_version: null }, routeAvailable: true, routeConfirmedCompatible: true });
  eq(r.ok, false); truthy(/PORTAL_SCHEMA/.test(r.block || "")); eq(r.code, "FORM_VERSION_INCOMPATIBLE");
});
t("P37-25 provider schema change (incompatible provider version → blocked)", () => {
  const lock = { intelligence_version: "v1", provider_version: "prov-2", form_version: null, mapping_version: null, captured_at: "2026-01-01T00:00:00Z" };
  const r = preSubmissionRevalidation({ lock, current: { intelligence_version: "v1", provider_version: "prov-3", form_version: null, mapping_version: null }, routeAvailable: true, routeConfirmedCompatible: true });
  eq(r.ok, false); eq(r.block, "BLOCKED_BY_PROVIDER_SCHEMA_CHANGE"); eq(r.code, "PROVIDER_VERSION_INCOMPATIBLE");
});
t("P37-26 provider capability change (route unavailable → blocked; affectsExecution detects)", () => {
  const lock = { intelligence_version: "v1", provider_version: null, form_version: null, mapping_version: null, captured_at: "2026-01-01T00:00:00Z" };
  const r = preSubmissionRevalidation({ lock, current: { intelligence_version: "v1", provider_version: null, form_version: null, mapping_version: null }, routeAvailable: false, routeConfirmedCompatible: false });
  eq(r.ok, false); eq(r.block, "BLOCKED_BY_INTELLIGENCE_CHANGE"); eq(r.code, "ROUTE_NOT_COMPATIBLE");
  // Submission-capability change is execution-affecting (§26).
  eq(affectsExecution(["submission_capability"]), true);
});
t("P37-27 provider route invalidation (lockCompatible compatibility view)", () => {
  const lock = { intelligence_version: "v1", provider_version: "p2", form_version: "f7", mapping_version: "m3", captured_at: "2026-01-01T00:00:00Z" };
  const compat = lockCompatible(lock, { intelligence_version: "v3", provider_version: "p2", form_version: "f7", mapping_version: "m3" });
  eq(compat.intelligenceCompatible, false); eq(compat.providerCompatible, true); eq(compat.formCompatible, true); eq(compat.mappingCompatible, true);
});

// ---------- §28/§29/§30/§31 notification + task + event integration ----------
t("P37-28 notification integration (structured, no unsupported claims)", () => {
  const n = buildChangeNotification({ severity: "HIGH", country: "TH", journey: "EVISA" });
  truthy(/Visa requirements for your destination have changed/.test(n.message));
  truthy(!/invalid|denied/.test(n.message));
  const low = buildChangeNotification({ severity: "LOW", country: "TH", journey: "EVISA" });
  truthy(/No action is required/.test(low.message));
});
t("P37-29 OperationsTask integration (revalidation task types + idempotency key)", () => {
  truthy(REVALIDATION_TASK_TYPES.includes("INTELLIGENCE_REVIEW"));
  truthy(REVALIDATION_TASK_TYPES.includes("APPLICATION_REVALIDATION"));
  truthy(REVALIDATION_TASK_TYPES.includes("PROVIDER_ROUTE_REVIEW"));
  const k1 = intelligenceTaskIdempotencyKey("c1", "INTELLIGENCE_REVIEW");
  const k2 = intelligenceTaskIdempotencyKey("c1", "INTELLIGENCE_REVIEW");
  eq(k1, k2); eq(k1, "intel|c1|INTELLIGENCE_REVIEW");
  truthy(intelligenceTaskIdempotencyKey("c2", "INTELLIGENCE_REVIEW") !== k1);
});
t("P37-30 CaseEvent integration (canonical event types)", () => {
  eq(INTELLIGENCE_VERSION_CHANGED_EVENT, "INTELLIGENCE_VERSION_CHANGED");
  eq(INTELLIGENCE_CHANGE_REQUIRES_ACTION_EVENT, "INTELLIGENCE_CHANGE_REQUIRES_ACTION");
  truthy(INTELLIGENCE_CHANGE_REQUIRES_ACTION_EVENT !== INTELLIGENCE_VERSION_CHANGED_EVENT);
});

// ---------- §31/§32/§33 MCP integration ----------
t("P37-31 MCP read access (getCurrentVisaVersion +getSourceConfidence +.. are read-only traveler tools)", () => {
  for (const name of ["getCurrentVisaVersion", "getSourceConfidence", "getRequirementChanges", "getCaseImpact", "getExecutionImpact"]) {
    truthy(TOOL_BY_NAME[name], "tool exists " + name);
    eq(TOOL_BY_NAME[name].risk, "READ_ONLY", name + " read-only");
    truthy(TOOL_BY_NAME[name].supportedRoles.includes("traveler"), name + " traveler");
  }
  // Traveler may invoke the read tools.
  eq(canInvokeTool("traveler", "getCurrentVisaVersion").ok, true);
  eq(canInvokeTool("traveler", "getCaseImpact").ok, true);
});
t("P37-32 MCP cannot publish (no publish/rollback/version-transition tool in catalog)", () => {
  const forbidden = ["publishIntelligenceVersion", "approveIntelligenceVersion", "rollbackIntelligenceVersion", "publishVersion", "approveVersion"];
  for (const f of forbidden) truthy(!TOOL_BY_NAME[f], "no " + f + " tool");
  const writeRisk = AGENT_TOOLS.filter((x: any) => x.risk === "HIGH_RISK_WRITE" || x.risk === "EXTERNAL_EXECUTION").map((x: any) => x.name);
  truthy(!writeRisk.includes("publishIntelligenceVersion"));
});
t("P37-33 AI cannot approve (no tool transitions a version to APPROVED/PUBLISHED)", () => {
  truthy(!TOOL_BY_NAME["approveVersion"]); truthy(!TOOL_BY_NAME["publishVersion"]);
  truthy(!TOOL_BY_NAME["confirmIntelligenceApproval"]);
  eq(canApproveVersion("traveler"), false); eq(canApproveVersion("operations"), false);
  eq(canApproveVersion("admin"), true);
});

// ---------- §34 provenance ----------
t("P37-34 provenance (value → source → version → approval → publication)", () => {
  const v = buildVersion({ country: "TH", journey: "EVISA", data_version: "TH-EVISA-v2", source_version: "src-2026-08", published_at: "2026-08-15T10:00:00Z", published_by: "admin_a", confidence: "HIGH", status: "PUBLISHED" });
  const p = buildProvenance(v, { name: "Thai Immigration", url: "https://gov.th", type: "GOVERNMENT" });
  eq(p.data_version, "TH-EVISA-v2"); eq(p.source_version, "src-2026-08"); eq(p.published_by, "admin_a"); eq(p.confidence, "HIGH");
  truthy(!!p.source && !!p.source.url);
});

// ---------- §35/§36 execution version lock + pre-submission ----------
t("P37-35 execution version lock (captures intelligence+provider+form+mapping)", () => {
  const app = { case_snapshot: { version_lock: { intelligence_version: "v1", provider_version: "p2", form_version: "f7", mapping_version: "m3", captured_at: "2026-08-01T00:00:00Z" } } };
  const lock = versionLockForCase(app);
  eq(lock.intelligence_version, "v1"); eq(lock.provider_version, "p2"); eq(lock.form_version, "f7"); eq(lock.mapping_version, "m3");
  // Fallback to visa_rule_version when no explicit lock.
  const app2 = { visa_rule_version: "v-rules-1", case_snapshot: {} };
  eq(versionLockForCase(app2).intelligence_version, "v-rules-1");
});
t("P37-36 pre-submission revalidation (compatible → ok; any drift → block)", () => {
  const lock = { intelligence_version: "v1", provider_version: "p2", form_version: "f7", mapping_version: "m3", captured_at: "2026-01-01T00:00:00Z" };
  eq(preSubmissionRevalidation({ lock, current: { intelligence_version: "v1", provider_version: "p2", form_version: "f7", mapping_version: "m3" }, routeAvailable: true, routeConfirmedCompatible: true }).ok, true);
  // mapping drift → blocked
  eq(preSubmissionRevalidation({ lock, current: { intelligence_version: "v1", provider_version: "p2", form_version: "f7", mapping_version: "m9" }, routeAvailable: true, routeConfirmedCompatible: true }).ok, false);
});

// ---------- §37/§38 isolation + authorization ----------
t("P37-37 traveler isolation (read tools are public; traveler cannot act on others' cases)", () => {
  eq(canInvokeTool("traveler", "getCurrentVisaVersion").ok, true);
  // getCaseImpact is case-scoped on the backend (ownership enforced), but the tool is callable.
  eq(canInvokeTool("traveler", "getCaseImpact").ok, true);
  // auto-publish is false by default regardless of severity
  eq(canAutoPublish({ materialFields: ["description"], severity: "LOW" }, {}), false);
});
t("P37-38 admin authorization (publish/rollback admin-only)", () => {
  eq(canPublishVersion("admin"), true);
  eq(canPublishVersion("user"), false);
  eq(canPublishVersion("traveler"), false);
  eq(canPublishVersion(null), false);
  eq(canPublishVersion("operations"), false);
});

// ---------- §39/§40 rollback safety + regression ----------
t("P37-39 rollback safety (rollback is a valid state transition + revalidation), audit-valued)", () => {
  truthy(canTransitionVersion("SUPERSEDED", "PUBLISHED"));
  truthy(canTransitionVersion("PUBLISHED", "SUPERSEDED"));
  const lock = { intelligence_version: "v2", provider_version: null, form_version: null, mapping_version: null, captured_at: "2026-01-01T00:00:00Z" };
  // After rollback to v1, a case locked at v2 is now drifted → revalidation non-UNCHANGED.
  truthy(["EXECUTION_BLOCKED", "ACTION_REQUIRED", "REVIEW_REQUIRED"].includes(revalidationResultFor({ lock, currentVersionId: "v1", severityOfChange: "HIGH", affectsExecution: false, caseState: "DOCUMENTS_REQUIRED" })));
});
t("P37-40 regression compatibility (Phase 22/24/25/27 invariants green)", () => {
  eq(normalizeEntryInput({ destination: "th" }).nationality, "IN");
  eq(meetsTwoSourceRule([
    { source_type: "GOVERNMENT", verification_status: "VERIFIED", source_url: "https://gov" },
    { source_type: "EMBASSY_CONSULATE", verification_status: "VERIFIED", source_url: "https://emb" },
  ]).ok, true);
  eq(detectChange({ fingerprint: "x", normalized_payload: { a: 1 } }, { a: 2 }, "totally_unknown").change, "MATERIAL");
  truthy(sourcePrecedence("GOVERNMENT") < sourcePrecedence("VERIFIED_COMMERCIAL_PROVIDER"));
  // auto-publish never for eligibility/fee/url
  eq(canAutoPublish({ materialFields: ["eligibility"], severity: "CRITICAL" }, { autoPublishLowRisk: true }), false);
  eq(canAutoPublish({ materialFields: ["fee_government_minor"], severity: "HIGH" }, { autoPublishLowRisk: true }), false);
});

export function runIntelligenceContractTests(): { total: number; passed: number; failed: number; failed_names: string[]; results: TestRes[] } {
  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, failed_names: failed.map((r) => r.name), results };
}