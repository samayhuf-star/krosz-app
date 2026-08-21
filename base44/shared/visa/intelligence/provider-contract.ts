// Worldz Visa (Phase 22) — Visa Intelligence PROVIDER contract tests (Pipeworx).
// Run against a MOCKED MCP responder (no network). Distinct from the Phase 17
// document-intelligence contract (../visa/intelligence/contract.ts).

import { createPipeworxProvider } from "./pipeworx.ts";
import { VISA_STATUS, CONFIDENCE } from "./types.ts";

function makeMockFetch(responder: (url: string, init: any) => any): any {
  return async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => responder(url, body) } as any;
  };
}

export async function runProviderContractTests(): Promise<{ passed: number; failed: number; results: any[] }> {
  let passed = 0, failed = 0;
  const results: any[] = [];
  const ok = (name: string, cond: boolean, detail?: string) => {
    if (cond) { passed++; results.push({ name, pass: true }); }
    else { failed++; results.push({ name, pass: false, detail }); }
  };

  // 1. valid response normalizes
  {
    const fetchImpl = makeMockFetch((_u, b) => ({
      jsonrpc: "2.0", id: b.id, result: {
        structuredContent: { passport: { code: "IN", name: "India" }, destination: { code: "TH", name: "Thailand" }, requirement: "visa_free", requirement_label: "Visa-free entry", allowed_stay_days: 60, source: "Passport Index dataset", dataset_last_updated: "2026-02-18", disclaimer: "snapshot" },
      },
    }));
    const px = createPipeworxProvider({ fetchImpl });
    const r: any = await px.getVisaRequirement("IN", "Thailand");
    ok("1_valid_normalizes", !!r.ok && r.result?.visa_status === VISA_STATUS.VISA_FREE && r.result.stay_duration_days === 60 && r.result.confidence === CONFIDENCE.HIGH_CONFIDENCE, JSON.stringify(r));
  }

  // 2. missing required fields → invalid (non-transient)
  {
    const fetchImpl = makeMockFetch((_u, b) => ({
      jsonrpc: "2.0", id: b.id, result: { isError: true, structuredContent: { error: "invalid_arguments", message: "passport is required", missing: ["passport"], required: ["passport", "destination"] } },
    }));
    const px = createPipeworxProvider({ fetchImpl });
    const r: any = await px.getVisaRequirement("", "TH");
    ok("2_missing_fields_invalid", !r.ok && r.transient === false, JSON.stringify(r));
  }

  // 3. unknown visa type → OTHER + NEEDS_REVIEW
  {
    const fetchImpl = makeMockFetch((_u, b) => ({
      jsonrpc: "2.0", id: b.id, result: { structuredContent: { passport: { code: "IN" }, destination: { code: "XX" }, requirement: "special_diplomatic_pass", allowed_stay_days: null, source: "x", dataset_last_updated: "2026-02-18" } },
    }));
    const px = createPipeworxProvider({ fetchImpl });
    const r: any = await px.getVisaRequirement("IN", "XX");
    ok("3_unknown_type_other_and_needs_review", !!r.ok && r.result?.visa_status === VISA_STATUS.OTHER && r.result.confidence === CONFIDENCE.NEEDS_REVIEW, JSON.stringify(r));
  }

  // 4. timeout → transient failure, never a fabricated answer
  {
    const fetchImpl = async () => { const e: any = new Error("The operation was aborted"); e.name = "AbortError"; throw e; };
    const px = createPipeworxProvider({ fetchImpl, timeoutMs: 50, maxRetries: 0 });
    const r: any = await px.getVisaRequirement("IN", "TH");
    ok("4_timeout_transient_failure", !r.ok && r.transient === true && !r.result, JSON.stringify(r));
  }

  // 5. unavailable (5xx) → transient failure, no answer
  {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) } as any);
    const px = createPipeworxProvider({ fetchImpl, maxRetries: 0 });
    const r: any = await px.getVisaRequirement("IN", "TH");
    ok("5_unavailable_5xx_transient", !r.ok && r.transient === true, JSON.stringify(r));
  }

  // 6. schema change (unexpected shape) → fails safely
  {
    const fetchImpl = makeMockFetch((_u, b) => ({ jsonrpc: "2.0", id: b.id, result: { structuredContent: { totally: "different", no_known_fields: true } } }));
    const px = createPipeworxProvider({ fetchImpl });
    const r: any = await px.getVisaRequirement("IN", "TH");
    ok("6_schema_change_fails_safely", !r.ok && !r.result, JSON.stringify(r));
  }

  // 7. token diagnostics
  {
    const px = createPipeworxProvider({ token: "x", fetchImpl: () => null });
    const d = px.diagnose();
    ok("7_diagnose_detects_token", d.hasToken === true, JSON.stringify(d));
  }

  // 8. passport-compare arg validation (no network)
  {
    const px = createPipeworxProvider({ token: "x", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) } as any) });
    const r: any = await px.comparePassports(["IN"]);
    ok("8_compare_arg_validation", !r.ok, JSON.stringify(r));
  }

  return { passed, failed, results };
}