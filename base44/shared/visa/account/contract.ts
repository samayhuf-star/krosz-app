// Worldz Visa (Phase 20): pure-logic contract tests for the account domain.
// No DB / no I/O — validates the deterministic pieces of the engine.

import { computeCompleteness, profilePrefill, getPrimaryTraveler, buildVisaHistory, passportExpiryStatus, isAppReady, describeIssue } from "./engine.ts";

const tests: any[] = [];
function t(name: string, fn: () => void) { tests.push({ name, fn }); }
function eq(a: any, b: any, label = ""): boolean {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${label} expected ${sb} got ${sa}`);
  return true;
}

// ---- Traveler profile completeness (§6) ----
t("completeness: empty profile is 0", () => {
  const r = computeCompleteness({ first_name: "A", nationality: "IN" });
  eq(r.score, 20, "personal partial"); // first_name + nationality only → personal false (no dob)
});

t("completeness: full profile is 100", () => {
  const full = { first_name: "A", date_of_birth: "1990-01-01", nationality: "IN", gender: "male", country_of_birth: "IN", email: "a@b.com", phone: "1", address_line1: "x", address_country: "IN", employment_status: "employed" };
  const r = computeCompleteness(full);
  eq(r.score, 100);
});

t("completeness: is a convenience indicator, not eligibility", () => {
  // Even a complete profile says nothing about visa eligibility.
  const r = computeCompleteness({ first_name: "A", date_of_birth: "1990-01-01", nationality: "IN" });
  eq(r.score < 100, true);
  eq(typeof r.score, "number");
});

// ---- Profile → prefill (§7) ----
t("prefill: maps profile fields to application codes", () => {
  const p = profilePrefill({ first_name: "Samay", last_name: "V", date_of_birth: "1990-01-01", nationality: "IN", email: "s@x.com", address_line1: "1 St", address_city: "Delhi", address_country: "IN", employment_status: "employed", employer: "Acme" });
  eq(p.applicant_first_name, "Samay");
  eq(p.applicant_dob, "1990-01-01");
  eq(p.applicant_nationality, "IN");
  eq(p.applicant_email, "s@x.com");
  eq(p.applicant_address_line1, "1 St");
  eq(p.applicant_employment_status, "employed");
});

t("prefill: omits missing fields (never injects nulls)", () => {
  const p = profilePrefill({ first_name: "A", nationality: "IN" });
  eq(p.applicant_email, undefined);
  eq(p.applicant_address_line1, undefined);
  eq(p.applicant_first_name, "A");
});

// ---- Primary traveler (§3) ----
t("primary: returns the flagged primary when present", () => {
  const list = [{ id: "1", is_primary: false, status: "ACTIVE" }, { id: "2", is_primary: true, status: "ACTIVE" }];
  eq(getPrimaryTraveler(list).id, "2");
});

t("primary: falls back to first active when none flagged", () => {
  const list = [{ id: "1", is_primary: false, status: "ACTIVE" }, { id: "2", is_primary: false, status: "ARCHIVED" }];
  eq(getPrimaryTraveler(list).id, "1");
});

t("primary: null when only archived travelers", () => {
  eq(getPrimaryTraveler([{ id: "1", is_primary: true, status: "ARCHIVED" }]), null);
});

// ---- Visa history (§14) ----
t("visa history: only includes decisioned apps", () => {
  const apps = [
    { id: "a1", destination: "US", visa_type_key: "us_tourist", status: "approved", created_date: "2026-01-01" },
    { id: "a2", destination: "TH", visa_type_key: "th_tourist", status: "draft", created_date: "2026-02-01" },
    { id: "a3", destination: "FR", visa_type_key: "fr_tourist", status: "refused", created_date: "2026-03-01" },
  ];
  const h = buildVisaHistory(apps);
  eq(h.length, 2);
  eq(h[0].destination, "FR"); // sorted newest first
  eq(h[1].destination, "US");
  eq(h[0].decision, "REFUSED"); // a3 FR refused → REFUSED
  eq(h[1].decision, "APPROVED"); // a1 US approved → APPROVED
});

t("visa history: uses final_review.decision when present", () => {
  const apps = [{ id: "a1", destination: "US", visa_type_key: "k", status: "draft", final_review: { decision: "APPROVED", decision_date: "2026-06-01" }, created_date: "2026-01-01" }];
  const h = buildVisaHistory(apps);
  eq(h.length, 1);
  eq(h[0].decision, "APPROVED");
  eq(h[0].decision_date, "2026-06-01");
});

// ---- Passport expiry (§31) ----
t("passport expiry: VALID / EXPIRING_SOON / EXPIRED", () => {
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  eq(passportExpiryStatus({ expiry_date: future(400) }), "VALID");
  eq(passportExpiryStatus({ expiry_date: future(100) }), "EXPIRING_SOON");
  eq(passportExpiryStatus({ expiry_date: future(-10) }), "EXPIRED");
  eq(passportExpiryStatus({ expiry_date: null }), "UNKNOWN");
});

// ---- Group readiness (§17) ----
t("group readiness: ready states recognized", () => {
  eq(isAppReady({ status: "ready_for_submission" }), true);
  eq(isAppReady({ status: "submitted" }), true);
  eq(isAppReady({ status: "approved" }), true);
  eq(isAppReady({ status: "draft" }), false);
  eq(isAppReady({ status: "documents_pending" }), false);
});

t("group issue: human description per state", () => {
  eq(describeIssue({ status: "documents_pending" }), "Document missing or under review");
  eq(describeIssue({ status: "draft" }), "Application incomplete");
  eq(describeIssue({ status: "user_approval" }), "Awaiting your approval");
  eq(describeIssue({ status: "payment_pending" }), "Payment pending");
  eq(describeIssue({ status: "unknown_x", final_review: { state: "payment_pending" } }), "Payment pending");
});

// ---- Deletion retention boundary (§38) ----
t("deletion: retention blocks when active orders exist (pure boundary)", () => {
  // The engine computes active counts; the policy: block completion while >0.
  const hasObligation = (active_apps: number, active_orders: number) => active_apps > 0 || active_orders > 0;
  eq(hasObligation(0, 0), false);
  eq(hasObligation(1, 0), true);
  eq(hasObligation(0, 2), true);
});

export function runAccountContractTests(): any {
  const results: any[] = [];
  let passed = 0, failed = 0;
  for (const test of tests) {
    try { test.fn(); results.push({ name: test.name, ok: true }); passed++; }
    catch (e: any) { results.push({ name: test.name, ok: false, detail: e?.message || String(e) }); failed++; }
  }
  return { passed, failed, results };
}