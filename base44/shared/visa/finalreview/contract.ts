// Worldz Visa (Phase 18) — Final review + commercial domain contract tests (§32).
// Pure: exercises the deterministic helpers without a live DB.

import { classifyGate, computeMaterialHash, paidMutationImpact, declarationTextFor, MATERIAL_QUESTION_CODES } from "./engine.ts";

function eq(name: string, got: any, want: any) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  return { name, ok, detail: { got, want } };
}
function ok(name: string, cond: boolean) { return { name, ok: !!cond }; }

export function runFinalReviewContractTests(): { passed: number; failed: number; results: any[] } {
  const results: any[] = [];

  // --- Final readiness gate classification (§3) ---
  results.push(eq("gate READY", classifyGate(0, 0), "READY"));
  results.push(eq("gate NOT_READY (blocking)", classifyGate(2, 0), "NOT_READY"));
  results.push(eq("gate NEEDS_REVIEW (warnings only)", classifyGate(0, 3), "NEEDS_REVIEW"));
  results.push(eq("gate NOT_READY beats NEEDS_REVIEW", classifyGate(1, 5), "NOT_READY"));

  // --- Material hash determinism (§6) ---
  const baseApp: any = { id: "a1", destination: "FR", purpose: "tourism", visa_type_key: "schengen_short_stay", nationality: "IN", travel_start: "2026-09-12", travel_end: "2026-09-25", channel: "evisa" };
  const answersA = [
    { question_code: "travel.departure_date", normalized_value: "2026-09-12" },
    { question_code: "passport.passport_number", normalized_value: "X1234567" },
  ];
  const answersB = JSON.parse(JSON.stringify(answersA));
  results.push(ok("material hash deterministic", computeMaterialHash(baseApp, answersA) === computeMaterialHash(baseApp, answersB)));
  const answersC = JSON.parse(JSON.stringify(answersA));
  answersC[1] = { question_code: "passport.passport_number", normalized_value: "Y9999999" };
  results.push(ok("material hash changes on material field", computeMaterialHash(baseApp, answersA) !== computeMaterialHash(baseApp, answersC)));
  // Non-material fields do not affect the hash.
  results.push(ok("material hash ignores non-material", computeMaterialHash(baseApp, answersA) === computeMaterialHash(baseApp, [{ question_code: "additional.notes", normalized_value: "hello" }, ...answersA])));

  // --- Paid mutation impact (§30) ---
  const pricedHash = computeMaterialHash(baseApp, answersA);
  results.push(eq("mutation none (no paid order)", paidMutationImpact({ final_review: { material_hash: pricedHash, priced_version: 1 } } as any, pricedHash, false), "none"));
  results.push(eq("mutation none (unchanged)", paidMutationImpact({ final_review: { material_hash: pricedHash, priced_version: 1 } } as any, pricedHash, true), "none"));
  results.push(eq("mutation repricing (material changed)", paidMutationImpact({ final_review: { material_hash: pricedHash, priced_version: 1 } } as any, computeMaterialHash(baseApp, answersC), true), "repricing"));

  // --- Declaration text (§5) configurable per product ---
  results.push(eq("declaration default when unset", declarationTextFor(null as any), declarationTextFor({ declaration_text: "" } as any)));
  results.push(ok("declaration uses product text", declarationTextFor({ declaration_text: "Custom attestation." } as any) === "Custom attestation."));

  // --- Material question code coverage (sanity) ---
  results.push(ok("material codes include passport", MATERIAL_QUESTION_CODES.includes("passport.passport_number")));
  results.push(ok("material codes include travel dates", MATERIAL_QUESTION_CODES.includes("travel.departure_date")));

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}