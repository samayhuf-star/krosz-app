// Worldz Visa (Phase 16) — Workspace contract tests.
//
// Pure, deterministic tests that exercise the Phase 16 logic without a database:
//   - readiness classification (READY / NOT_READY / NEEDS_REVIEW)
//   - checklist state mapping (AVAILABLE / MISSING / EXPIRED / NEEDS_REVIEW)
//   - section-level progress
//   - application snapshot capture (mocked catalog)
//   - security: owner vs unauthorized vs admin (getApplication)
//   - cancel boundary (state guard)
//
// Run via: action=run-workspace-contract-tests (admin).

import { classifyReadiness, checklistStateFor, sectionProgress, cancelApplication, updateApplication } from "./engine.ts";
import { buildRuleSnapshot } from "./snapshot.ts";
import { getApplication } from "../application.ts";

let pass = 0, fail = 0;
const results: { name: string; pass: boolean; detail: string }[] = [];
function ok(name: string) { pass++; results.push({ name, pass: true, detail: "" }); }
function bad(name: string, detail: string) { fail++; results.push({ name, pass: false, detail }); }

function assertEq(name: string, actual: any, expected: any) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(name);
  else bad(name, `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
}

// ---------- READINESS CLASSIFICATION ----------
assertEq("readiness.ready", classifyReadiness(0, 0), "READY");
assertEq("readiness.not_ready_blocking", classifyReadiness(3, 0), "NOT_READY");
assertEq("readiness.not_ready_both", classifyReadiness(2, 2), "NOT_READY");
assertEq("readiness.needs_review", classifyReadiness(0, 4), "NEEDS_REVIEW");

// ---------- CHECKLIST STATE MAPPING ----------
assertEq("checklist.missing", checklistStateFor("missing", "valid"), "MISSING");
assertEq("checklist.verified_valid", checklistStateFor("verified", "valid"), "AVAILABLE");
assertEq("checklist.verified_expired", checklistStateFor("verified", "expired"), "EXPIRED");
assertEq("checklist.verified_expiring", checklistStateFor("verified", "expiring_soon"), "NEEDS_REVIEW");
assertEq("checklist.needs_review", checklistStateFor("needs_review", "valid"), "NEEDS_REVIEW");
assertEq("checklist.processing", checklistStateFor("processing", "valid"), "NEEDS_REVIEW");
assertEq("checklist.uploaded", checklistStateFor("uploaded", "valid"), "NEEDS_REVIEW");

// ---------- SECTION PROGRESS ----------
const sections: any = [
  { key: "PERSONAL", label: "Personal", questions: [
    { code: "a", required: true }, { code: "b", required: true }, { code: "c", required: false },
  ] },
  { key: "TRAVEL", label: "Travel", questions: [
    { code: "d", required: true },
  ] },
];
const ans: any = { a: { normalized_value: "X", verified: true }, b: { normalized_value: "", verified: false }, d: { normalized_value: "Y", verified: true } };
const sp = sectionProgress(sections, ans);
assertEq("progress.required_total", sp.required_total, 3);
assertEq("progress.required_done", sp.required_done, 2);
assertEq("progress.overall_pct", sp.overall_pct, 67);
assertEq("progress.section_personal_complete", sp.sections[0].complete, false);
assertEq("progress.section_travel_complete", sp.sections[1].complete, true);
// empty
assertEq("progress.empty_pct", sectionProgress([], {}).overall_pct, 0);

// ---------- SNAPSHOT (mocked catalog) ----------
const mockSvc: any = {
  entities: {
    VisaType: { filter: async () => [{ visa_type_key: "TH-tourism", name: "Thailand Tourist Visa", channel: "evisa", category: "evisa", max_stay_days: 60, validity_days: 90, processing_min_days: 2, processing_max_days: 5, authority: "Thai e-Visa Office" }] },
    VisaRequirementsVersion: { filter: async () => [{ requirements_version: "IN-TH-tourism-2026-08", effective_from: "2026-01-01", effective_until: "2026-12-31", verification_status: "verified", source_id: "src1" }] },
    VisaProduct: { filter: async () => [] },
    VisaPrice: { filter: async () => [] },
  },
};
// resolveProduct throws (no product) → fee_version null, snapshot still built.
const snap = await buildRuleSnapshot(mockSvc, { destination: "TH", purpose: "tourism", nationality: "IN", route: { visa_type_key: "TH-tourism", channel: "evisa", requirements_version: "IN-TH-tourism-2026-08", appointment_required: false } }).catch((e: any) => ({ error: e?.message }));
if (snap && !snap.error) {
  ok("snapshot.built");
  assertEq("snapshot.visa_rule_version", snap.visa_rule_version, "IN-TH-tourism-2026-08");
  assertEq("snapshot.fee_version_null", snap.fee_version, null);
  assertEq("snapshot.option_name", snap.rule_snapshot.visa_option.name, "Thailand Tourist Visa");
  assertEq("snapshot.option_max_stay", snap.rule_snapshot.visa_option.max_stay_days, 60);
  assertEq("snapshot.effective_until", snap.rule_snapshot.effective_until, "2026-12-31");
} else bad("snapshot.built", "snapshot build threw");

// ---------- SECURITY (getApplication ownership) ----------
const ownerApp = { id: "a1", created_by_id: "u_me", traveler_id: "t1" };
const secSvc: any = { entities: { VisaApplication: { get: async () => ownerApp } } };
assertEq("security.owner_allowed", !!(await getApplication(secSvc, { id: "u_me", role: "user" }, "a1").catch(() => null)), true);
assertEq("security.unauthorized_denied", (await getApplication(secSvc, { id: "u_other", role: "user" }, "a1").catch((e: any) => e.code)) === "FORBIDDEN", true);
assertEq("security.admin_allowed", !!(await getApplication(secSvc, { id: "u_other", role: "admin" }, "a1").catch(() => null)), true);

// ---------- CANCEL BOUNDARY ----------
const updSvc: any = { entities: { VisaApplication: { update: async (id: string, p: any) => ({ ...ownerApp, ...p }), get: async () => ({ ...ownerApp, status: "cancelled" }) } } };
let cancelErr: any = null;
try { await cancelApplication(updSvc, { id: "u_me", role: "user" } as any, { ...ownerApp, status: "submitted" }); } catch (e: any) { cancelErr = e.code; }
assertEq("cancel.submitted_blocked", cancelErr, "BAD_STATE");
const cancelled = await cancelApplication(updSvc, { id: "u_me", role: "user" } as any, { ...ownerApp, status: "documents_pending" }).catch(() => null);
assertEq("cancel.draft_succeeds", cancelled?.status, "cancelled");

// ---------- UPDATE BOUNDARY (only allowlisted fields) ----------
const upd2 = await updateApplication(updSvc, { id: "u_me", role: "user" } as any, ownerApp, { travel_start: "2026-09-01", status: "approved", risk_score: 99 });
assertEq("update.allowlisted_travel_start", (upd2 as any).travel_start, "2026-09-01");
assertEq("update.ignored_status", (upd2 as any).status, undefined);

export function runWorkspaceContractTests() {
  return { pass: fail === 0, total: pass + fail, passed: pass, results };
}

// Evaluate at module load so the exported runner reflects the run.
const _run = runWorkspaceContractTests();
void _run;