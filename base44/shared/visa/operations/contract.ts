// Worldz Visa (Phase 19) — operations + tracking contract tests (pure logic).
// Mirrors the intelligence/finalreview contract pattern: no DB, no external
// calls. Covers the §39 test matrix's deterministic core: transitions, QC
// verdict→state, risk scoring, checklist generation, status normalization,
// raw-vs-normalized separation, tracking-unavailable isolation, and decision
// routing. Lifecycle/DB paths are exercised via the backend actions.

import { fallbackNormalize, levelFromScore } from "./catalog.ts";
import { canTransition, computeRisk, buildChecklist } from "./engine.ts";
import { statusToCaseState, isDecisionStatus } from "../tracking/engine.ts";

const results: any[] = [];
function ok(name: string, detail?: any) { results.push({ name, ok: true, detail }); }
function bad(name: string, detail: any) { results.push({ name, ok: false, detail }); throw new Error(name); }
function eq(name: string, got: any, want: any) { if (got === want) ok(name, { got }); else bad(name, { got, want }); }

export function runOperationsContractTests(): { passed: number; failed: number; results: any[] } {
  // §2 transitions
  eq("transition: PREPARING → READY_FOR_REVIEW", canTransition("PREPARING", "READY_FOR_REVIEW"), true);
  eq("transition: PREPARING → SUBMITTED (blocked)", canTransition("PREPARING", "SUBMITTED"), false);
  eq("transition: COMPLETED terminal", canTransition("COMPLETED", "PREPARING"), false);
  eq("transition: UNDER_REVIEW → READY_TO_SUBMIT", canTransition("UNDER_REVIEW", "READY_TO_SUBMIT"), true);
  eq("transition: READY_TO_SUBMIT → SUBMISSION_IN_PROGRESS", canTransition("READY_TO_SUBMIT", "SUBMISSION_IN_PROGRESS"), true);

  // §7 risk scoring
  const lowRisk = computeRisk({ blocking_count: 0, warning_count: 0 }, { sections: [{ key: "a", complete: true }, { key: "b", complete: true }], documents: { verified: 5, total: 5, items: [] } });
  if (lowRisk.score >= 85 && lowRisk.level === "LOW") ok("risk: LOW when complete", lowRisk);
  else bad("risk: LOW when complete", lowRisk);

  const highRisk = computeRisk({ blocking_count: 3, warning_count: 5 }, { sections: [{ key: "a", complete: false }], documents: { verified: 1, total: 5, items: [] } });
  if (highRisk.score < 60 && highRisk.level === "HIGH") ok("risk: HIGH when blocking + incomplete", highRisk);
  else bad("risk: HIGH when blocking + incomplete", highRisk);

  eq("risk: level threshold UNKNOWN for null", levelFromScore(NaN), "UNKNOWN");

  // §5 checklist
  const clPass = buildChecklist({ sections: [{ key: "personal", complete: true }], documents: { verified: 1, total: 1, items: [{ requirement_id: "r1", label: "Passport", verified: true }] } }, { blocking_count: 0, warning_count: 0 });
  if (clPass.every((i: any) => i.status === "PASS")) ok("checklist: all PASS", clPass.map((i: any) => i.code));
  else bad("checklist: all PASS", clPass);

  const clMissing = buildChecklist({ sections: [{ key: "personal", complete: false }], documents: { verified: 0, total: 1, items: [{ requirement_id: "r1", label: "Passport", verified: false }] } }, { blocking_count: 0, warning_count: 0 });
  if (clMissing.some((i: any) => i.status === "MISSING")) ok("checklist: MISSING surfaced", clMissing.find((i: any) => i.status === "MISSING"));
  else bad("checklist: MISSING surfaced", clMissing);

  const clBlocker = buildChecklist({ sections: [{ key: "personal", complete: true }], documents: { verified: 1, total: 1, items: [] } }, { blocking_count: 1, warning_count: 0 });
  if (clBlocker.some((i: any) => i.status === "BLOCKER")) ok("checklist: BLOCKER from findings", clBlocker.find((i: any) => i.status === "BLOCKER"));
  else bad("checklist: BLOCKER from findings", clBlocker);

  // §20 raw vs normalized
  eq("normalize: APPROVED", fallbackNormalize("Visa approved and ready"), "APPROVED");
  eq("normalize: REFUSED", fallbackNormalize("Application refused"), "REFUSED");
  eq("normalize: ADDITIONAL_INFO", fallbackNormalize("Additional information required"), "ADDITIONAL_INFORMATION_REQUIRED");
  eq("normalize: PROCESSING default", fallbackNormalize("some unknown status text"), "PROCESSING");
  eq("normalize: PASSPORT_REQUESTED", fallbackNormalize("passport ready for collection"), "PASSPORT_REQUESTED");

  // §19/§24 tracking → case state
  eq("statusToCase: RECEIVED → PROCESSING", statusToCaseState("RECEIVED"), "PROCESSING");
  eq("statusToCase: APPROVED → DECISION_RECEIVED", statusToCaseState("APPROVED"), "DECISION_RECEIVED");
  eq("statusToCase: TRACKING_UNAVAILABLE → PROCESSING (not FAILED)", statusToCaseState("TRACKING_UNAVAILABLE"), "PROCESSING");

  // §26 decision detection
  eq("isDecision: APPROVED", isDecisionStatus("APPROVED"), true);
  eq("isDecision: PROCESSING not a decision", isDecisionStatus("PROCESSING"), false);

  return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}