// Worldz Visa (Phase 6) — Dynamic, deterministic, schema-driven application engine.
//
// Invariants (spec §§1-61):
//   - The system asks the MINIMUM necessary questions. Requirements determine what is
//     needed; documents provide evidence; questions collect MISSING structured info.
//   - Question generation is DETERMINISTIC and VERSIONED. AI never decides which
//     questions exist, whether they are required, or eligibility.
//   - Visibility + validation reuse the Phase 2 rule semantics (base44/shared/visa/rules.ts).
//   - Answers are structured + source-aware (USER / PASSPORT / TRAVELER / PREVIOUS_APPLICATION
//     / DOCUMENT_EXTRACTION / DOCUMENT). A user override never mutates the underlying
//     DocumentExtraction — the conflict is surfaced as an APPLICATION_DATA_CONFLICT finding.
//   - Stale answers (hidden question) become inactive, not deleted; restored if the
//     condition returns.
//   - Readiness is deterministic: questions + documents + validation + findings + reviews.

import { evaluateCondition, type Condition } from "./rules.ts";
import { normalizeDate, normalizeName, normalizeCountry } from "./intelligence.ts";
import { computeRequirementProgress, documentAudit, CATEGORY_TO_TYPES } from "./documents.ts";
import { getApplication } from "./application.ts";
import { advanceRun } from "../operations/engine.ts";
import { bus } from "../events/bus.ts";

export const QUESTION_VERSION = "visa.application.questions.v1";

export const SECTIONS = [
  "PERSONAL_INFORMATION", "CONTACT_INFORMATION", "RESIDENCE", "PASSPORT", "TRAVEL",
  "EMPLOYMENT", "FINANCIAL", "ACCOMMODATION", "SPONSORSHIP", "TRAVEL_HISTORY",
  "VISA_HISTORY", "ADDITIONAL_INFORMATION", "REVIEW",
] as const;
export type SectionKey = typeof SECTIONS[number];

export type QuestionType =
  | "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "SELECT" | "MULTI_SELECT" | "BOOLEAN"
  | "COUNTRY" | "CURRENCY" | "PHONE" | "EMAIL" | "ADDRESS" | "DOCUMENT_REFERENCE";

export interface QDef {
  code: string; label: string; description?: string; type: QuestionType; section: SectionKey;
  required?: boolean; order?: number;
  data_source?: { source_type: "PASSPORT" | "TRAVELER"; document_type?: string; field: string };
  visibility_rule?: Condition | null;
  validation_rule?: any;
  options?: { value: string; label: string }[];
  applies_to_purposes?: string[];
  applies_to_destinations?: string[];
  source?: "GOVERNMENT_FORM" | "GOVERNMENT_REQUIREMENT" | "VISA_RULE" | "INTERNAL_OPERATIONAL" | "USER_PROFILE";
  source_reference?: string;
}

const OPT = (value: string, label: string) => ({ value, label });

// ---------- QUESTION CATALOG (single in-memory source; seeded to the entity) ----------
export const QUESTION_CATALOG: QDef[] = [
  // PERSONAL_INFORMATION
  { code: "personal.surname", label: "Surname", type: "TEXT", section: "PERSONAL_INFORMATION", required: true, order: 10, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "surname" }, source: "VISA_RULE", source_reference: "TD3 MRZ" },
  { code: "personal.given_names", label: "Given names", type: "TEXT", section: "PERSONAL_INFORMATION", required: true, order: 20, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "given_names" }, source: "VISA_RULE", source_reference: "TD3 MRZ" },
  { code: "personal.date_of_birth", label: "Date of birth", type: "DATE", section: "PERSONAL_INFORMATION", required: true, order: 30, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "date_of_birth" }, source: "VISA_RULE", source_reference: "TD3 MRZ" },
  { code: "personal.nationality", label: "Nationality", type: "COUNTRY", section: "PERSONAL_INFORMATION", required: true, order: 40, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "nationality" }, source: "VISA_RULE", source_reference: "TD3 MRZ" },
  { code: "personal.sex", label: "Sex", type: "SELECT", section: "PERSONAL_INFORMATION", order: 50, options: [OPT("M", "Male"), OPT("F", "Female"), OPT("X", "Other")], data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "sex" } },
  { code: "personal.place_of_birth", label: "Place of birth", type: "TEXT", section: "PERSONAL_INFORMATION", order: 60, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "place_of_birth" } },
  // CONTACT_INFORMATION
  { code: "contact.email", label: "Email address", type: "EMAIL", section: "CONTACT_INFORMATION", required: true, order: 10, data_source: { source_type: "TRAVELER", field: "email" }, source: "INTERNAL_OPERATIONAL" },
  { code: "contact.phone", label: "Phone number", type: "PHONE", section: "CONTACT_INFORMATION", required: true, order: 20, data_source: { source_type: "TRAVELER", field: "phone" }, source: "INTERNAL_OPERATIONAL" },
  // RESIDENCE
  { code: "residence.country", label: "Country of residence", type: "COUNTRY", section: "RESIDENCE", required: true, order: 10, data_source: { source_type: "TRAVELER", field: "residence_country" } },
  { code: "residence.city", label: "City", type: "TEXT", section: "RESIDENCE", order: 20 },
  { code: "residence.address", label: "Residential address", type: "TEXTAREA", section: "RESIDENCE", order: 30, validation_rule: { max_length: 500 } },
  // PASSPORT
  { code: "passport.passport_number", label: "Passport number", type: "TEXT", section: "PASSPORT", required: true, order: 10, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "passport_number" }, source: "VISA_RULE", source_reference: "TD3 MRZ" },
  { code: "passport.issuing_country", label: "Issuing country", type: "COUNTRY", section: "PASSPORT", order: 20, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "issuing_country" } },
  { code: "passport.issue_date", label: "Issue date", type: "DATE", section: "PASSPORT", order: 30, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "issue_date" } },
  { code: "passport.expiry_date", label: "Expiry date", type: "DATE", section: "PASSPORT", required: true, order: 40, data_source: { source_type: "PASSPORT", document_type: "PASSPORT", field: "expiry_date" }, source: "VISA_RULE", source_reference: "TD3 MRZ" },
  // TRAVEL
  { code: "travel.purpose", label: "Purpose of travel", type: "SELECT", section: "TRAVEL", required: true, order: 10, options: [OPT("tourism", "Tourism"), OPT("business", "Business"), OPT("study", "Study"), OPT("transit", "Transit")] },
  { code: "travel.departure_date", label: "Departure date", type: "DATE", section: "TRAVEL", required: true, order: 20 },
  { code: "travel.return_date", label: "Return date", type: "DATE", section: "TRAVEL", required: true, order: 30 },
  { code: "travel.sponsor", label: "Who is paying for this trip?", type: "SELECT", section: "TRAVEL", required: true, order: 40, options: [OPT("SELF", "Self"), OPT("EMPLOYER", "Employer"), OPT("FAMILY", "Family"), OPT("OTHER", "Other")], source: "VISA_RULE" },
  { code: "travel.accommodation_type", label: "Accommodation type", type: "SELECT", section: "TRAVEL", required: true, order: 50, options: [OPT("HOTEL", "Hotel"), OPT("HOST", "Host / Invitation"), OPT("FAMILY", "Family"), OPT("OTHER", "Other")] },
  // EMPLOYMENT
  { code: "employment.status", label: "Employment status", type: "SELECT", section: "EMPLOYMENT", required: true, order: 10, options: [OPT("EMPLOYED", "Employed"), OPT("SELF_EMPLOYED", "Self-employed"), OPT("STUDENT", "Student"), OPT("UNEMPLOYED", "Unemployed"), OPT("RETIRED", "Retired")], source: "VISA_RULE" },
  { code: "employment.employer", label: "Employer name", type: "TEXT", section: "EMPLOYMENT", order: 20, visibility_rule: { field: "employment.status", operator: "eq", value: "EMPLOYED" } },
  { code: "employment.job_title", label: "Job title", type: "TEXT", section: "EMPLOYMENT", order: 30, visibility_rule: { field: "employment.status", operator: "eq", value: "EMPLOYED" } },
  { code: "employment.start_date", label: "Employment start date", type: "DATE", section: "EMPLOYMENT", order: 40, visibility_rule: { field: "employment.status", operator: "eq", value: "EMPLOYED" } },
  { code: "employment.salary", label: "Annual salary / income", type: "CURRENCY", section: "EMPLOYMENT", order: 50, visibility_rule: { field: "employment.status", operator: "eq", value: "EMPLOYED" } },
  { code: "self_employment.business_name", label: "Business name", type: "TEXT", section: "EMPLOYMENT", order: 60, visibility_rule: { field: "employment.status", operator: "eq", value: "SELF_EMPLOYED" } },
  { code: "self_employment.business_registration_number", label: "Business registration / GST number", type: "TEXT", section: "EMPLOYMENT", order: 70, visibility_rule: { field: "employment.status", operator: "eq", value: "SELF_EMPLOYED" } },
  { code: "education.institution", label: "Institution name", type: "TEXT", section: "EMPLOYMENT", order: 80, visibility_rule: { field: "employment.status", operator: "eq", value: "STUDENT" } },
  { code: "education.course", label: "Course / Program", type: "TEXT", section: "EMPLOYMENT", order: 90, visibility_rule: { field: "employment.status", operator: "eq", value: "STUDENT" } },
  // FINANCIAL
  { code: "financial.annual_income", label: "Annual income", type: "CURRENCY", section: "FINANCIAL", required: true, order: 10 },
  { code: "financial.bank_statement_reference", label: "Which bank statement should we use?", type: "DOCUMENT_REFERENCE", section: "FINANCIAL", required: true, order: 20, applies_to_purposes: ["tourism", "business", "study"] },
  // ACCOMMODATION
  { code: "accommodation.hotel_check_in", label: "Hotel check-in date", type: "DATE", section: "ACCOMMODATION", order: 10, visibility_rule: { field: "travel.accommodation_type", operator: "eq", value: "HOTEL" } },
  { code: "accommodation.hotel_check_out", label: "Hotel check-out date", type: "DATE", section: "ACCOMMODATION", order: 20, visibility_rule: { field: "travel.accommodation_type", operator: "eq", value: "HOTEL" } },
  // SPONSORSHIP
  { code: "sponsorship.sponsor_name", label: "Sponsor full name", type: "TEXT", section: "SPONSORSHIP", order: 10, visibility_rule: { field: "travel.sponsor", operator: "in", value: ["EMPLOYER", "FAMILY", "OTHER"] } },
  { code: "sponsorship.sponsor_relationship", label: "Relationship to sponsor", type: "TEXT", section: "SPONSORSHIP", order: 20, visibility_rule: { field: "travel.sponsor", operator: "in", value: ["FAMILY", "OTHER"] } },
  { code: "sponsorship.sponsor_financial_proof_reference", label: "Sponsor financial proof", type: "DOCUMENT_REFERENCE", section: "SPONSORSHIP", order: 30, visibility_rule: { field: "travel.sponsor", operator: "in", value: ["EMPLOYER", "FAMILY", "OTHER"] } },
  // TRAVEL_HISTORY
  { code: "previous_visits.has_previous_travel", label: "Have you travelled internationally in the last 5 years?", type: "BOOLEAN", section: "TRAVEL_HISTORY", required: true, order: 10 },
  { code: "previous_visits.countries_visited", label: "Countries visited", type: "TEXT", section: "TRAVEL_HISTORY", order: 20, visibility_rule: { field: "previous_visits.has_previous_travel", operator: "eq", value: "true" } },
  // VISA_HISTORY
  { code: "previous_visas.has_previous_visa", label: "Have you held a visa for any country before?", type: "BOOLEAN", section: "VISA_HISTORY", required: true, order: 10 },
  { code: "previous_visas.last_visa_country", label: "Country of last visa", type: "COUNTRY", section: "VISA_HISTORY", order: 20, visibility_rule: { field: "previous_visas.has_previous_visa", operator: "eq", value: "true" } },
  { code: "previous_visas.last_visa_date", label: "Date of last visa", type: "DATE", section: "VISA_HISTORY", order: 30, visibility_rule: { field: "previous_visas.has_previous_visa", operator: "eq", value: "true" } },
  { code: "previous_refusal.has_refusal", label: "Have you ever been refused a visa?", type: "BOOLEAN", section: "VISA_HISTORY", required: true, order: 40 },
  { code: "previous_refusal.country", label: "Which country refused it?", type: "COUNTRY", section: "VISA_HISTORY", order: 50, visibility_rule: { field: "previous_refusal.has_refusal", operator: "eq", value: "true" } },
  { code: "previous_refusal.date", label: "Date of refusal", type: "DATE", section: "VISA_HISTORY", order: 60, visibility_rule: { field: "previous_refusal.has_refusal", operator: "eq", value: "true" } },
  { code: "previous_refusal.reason", label: "Reason given for refusal", type: "TEXTAREA", section: "VISA_HISTORY", order: 70, visibility_rule: { field: "previous_refusal.has_refusal", operator: "eq", value: "true" } },
  { code: "previous_refusal.refusal_letter_reference", label: "Upload refusal letter", type: "DOCUMENT_REFERENCE", section: "VISA_HISTORY", order: 80, visibility_rule: { field: "previous_refusal.has_refusal", operator: "eq", value: "true" } },
  // ADDITIONAL_INFORMATION (route-scoped)
  { code: "invitation.inviting_company", label: "Inviting company / organization", type: "TEXT", section: "ADDITIONAL_INFORMATION", required: true, order: 10, applies_to_purposes: ["business"], source: "VISA_RULE" },
  { code: "invitation.invitation_letter_reference", label: "Invitation letter", type: "DOCUMENT_REFERENCE", section: "ADDITIONAL_INFORMATION", required: true, order: 20, applies_to_purposes: ["business"], source: "VISA_RULE" },
  { code: "study.admission_letter_reference", label: "Admission / enrollment letter", type: "DOCUMENT_REFERENCE", section: "ADDITIONAL_INFORMATION", required: true, order: 30, applies_to_purposes: ["study"], source: "VISA_RULE" },
  { code: "additional.notes", label: "Anything else we should know?", type: "TEXTAREA", section: "ADDITIONAL_INFORMATION", order: 90, validation_rule: { max_length: 1000 } },
];

// ---------- CATALOG SEED (idempotent upsert by code+version) ----------
export async function ensureQuestionCatalog(svc: any): Promise<{ seeded: number }> {
  let count = 0;
  const existing: any[] = await svc.entities.ApplicationQuestionDefinition.filter({ version: QUESTION_VERSION }).catch(() => []);
  const byCode: Record<string, any> = {};
  for (const e of existing) byCode[e.question_code] = e;
  for (const q of QUESTION_CATALOG) {
    const row = {
      question_code: q.code, label: q.label, description: q.description || null, type: q.type,
      section: q.section, required: !!q.required, order: q.order ?? 100,
      data_source: q.data_source || null, visibility_rule: q.visibility_rule || null,
      validation_rule: q.validation_rule || null, options: q.options || [],
      applies_to_purposes: q.applies_to_purposes || [], applies_to_destinations: q.applies_to_destinations || [],
      source: q.source || "INTERNAL_OPERATIONAL", source_reference: q.source_reference || null,
      version: QUESTION_VERSION, status: "active",
    };
    const cur = byCode[q.code];
    if (cur) await svc.entities.ApplicationQuestionDefinition.update(cur.id, row).catch(() => {});
    else await svc.entities.ApplicationQuestionDefinition.create(row).catch(() => {});
    count++;
  }
  // Remove duplicate catalog rows (concurrent-seed race): keep newest per code.
  const all: any[] = await svc.entities.ApplicationQuestionDefinition.filter({ version: QUESTION_VERSION }).catch(() => []);
  const keep: Record<string, any> = {};
  for (const e of all) { const k = e.question_code; if (!keep[k] || String(e.updated_date || "") > String(keep[k].updated_date || "")) { if (keep[k]) await svc.entities.ApplicationQuestionDefinition.delete(keep[k].id).catch(() => {}); keep[k] = e; } else await svc.entities.ApplicationQuestionDefinition.delete(e.id).catch(() => {}); }
  return { seeded: count };
}

// ---------- QUESTION RESOLUTION (deterministic) ----------
function factsFromAnswers(answers: any[]): Record<string, any> {
  const f: Record<string, any> = {};
  for (const a of answers) {
    if (a.active === false) continue;
    f[a.question_code] = a.value != null ? a.value : "";
  }
  return f;
}

export interface ResolvedQuestion {
  code: string; label: string; description?: string; type: QuestionType; section: SectionKey;
  required: boolean; order: number; options: { value: string; label: string }[];
  data_source: any; validation_rule: any; source: string; source_reference?: string;
  visible: boolean;
}
export interface ResolvedSection {
  key: SectionKey; label: string; questions: ResolvedQuestion[];
}

const SECTION_LABELS: Record<SectionKey, string> = {
  PERSONAL_INFORMATION: "Personal information", CONTACT_INFORMATION: "Contact", RESIDENCE: "Residence",
  PASSPORT: "Passport", TRAVEL: "Travel", EMPLOYMENT: "Employment", FINANCIAL: "Financial",
  ACCOMMODATION: "Accommodation", SPONSORSHIP: "Sponsorship", TRAVEL_HISTORY: "Travel history",
  VISA_HISTORY: "Visa history", ADDITIONAL_INFORMATION: "Additional information", REVIEW: "Review",
};

export async function resolveQuestionSet(svc: any, app: any, answers: any[] = []): Promise<{ version: string; sections: ResolvedSection[]; questions: ResolvedQuestion[] }> {
  await ensureQuestionCatalog(svc).catch(() => {});
  const defs: any[] = await svc.entities.ApplicationQuestionDefinition.filter({ version: app.question_version || QUESTION_VERSION, status: "active" }).catch(() => []);
  const purpose = String(app.purpose || "tourism").toLowerCase();
  const destination = String(app.destination || "").toUpperCase();
  const facts = factsFromAnswers(answers);
  // App-level facts (travel dates) feed cross-field evaluation.
  facts["travel.departure_date"] = facts["travel.departure_date"] || app.travel_start || "";
  facts["travel.return_date"] = facts["travel.return_date"] || app.travel_end || "";
  facts["travel.purpose"] = facts["travel.purpose"] || purpose;

  // Dedupe by question_code (guard against concurrent ensureQuestionCatalog races).
  const seen = new Set<string>();
  const visible: ResolvedQuestion[] = [];
  for (const d of defs) {
    if (seen.has(d.question_code)) continue;
    seen.add(d.question_code);
    if (d.applies_to_purposes?.length && !d.applies_to_purposes.includes(purpose)) continue;
    if (d.applies_to_destinations?.length && !d.applies_to_destinations.includes(destination)) continue;
    const cond = d.visibility_rule || null;
    const isVisible = evaluateCondition(cond, facts);
    visible.push({
      code: d.question_code, label: d.label, description: d.description || undefined, type: d.type,
      section: d.section, required: !!d.required, order: d.order ?? 100,
      options: d.options || [], data_source: d.data_source || null, validation_rule: d.validation_rule || null,
      source: d.source, source_reference: d.source_reference || undefined, visible: isVisible,
    });
  }
  visible.sort((a, b) => a.order - b.order);
  const grouped: ResolvedSection[] = [];
  for (const s of SECTIONS) {
    if (s === "REVIEW") continue;
    const qs = visible.filter((q) => q.section === s && q.visible);
    if (qs.length) grouped.push({ key: s, label: SECTION_LABELS[s], questions: qs });
  }
  return { version: app.question_version || QUESTION_VERSION, sections: grouped, questions: visible };
}

// ---------- ANSWER NORMALIZATION ----------
function normNumber(v: any): string { const n = Number(v); return Number.isNaN(n) ? String(v ?? "") : String(n); }
function normBool(v: any): string {
  if (v === true || v === "true" || v === "yes" || v === "Yes" || v === 1) return "true";
  if (v === false || v === "false" || v === "no" || v === "No" || v === 0) return "false";
  return v ? "true" : "false";
}
export function normalizeAnswer(qType: QuestionType, raw: any): { value: string; normalized_value: string } {
  if (raw == null) return { value: "", normalized_value: "" };
  if (Array.isArray(raw)) return { value: JSON.stringify(raw), normalized_value: JSON.stringify(raw) };
  if (qType === "DATE") { const n = normalizeDate(raw); return { value: String(raw), normalized_value: n }; }
  if (qType === "COUNTRY") { const n = normalizeCountry(raw); return { value: String(raw), normalized_value: n }; }
  if (qType === "TEXT" && /name|sponsor/.test("")) { return { value: String(raw), normalized_value: normalizeName(raw) }; }
  if (qType === "EMAIL") return { value: String(raw).trim(), normalized_value: String(raw).trim().toLowerCase() };
  if (qType === "PHONE") return { value: String(raw).replace(/[^\d+]/g, ""), normalized_value: String(raw).replace(/[^\d+]/g, "") };
  if (qType === "NUMBER") return { value: String(raw), normalized_value: normNumber(raw) };
  if (qType === "CURRENCY") { const s = String(raw).replace(/[^0-9.,]/g, "").replace(/,/g, ""); return { value: String(raw), normalized_value: s }; }
  if (qType === "BOOLEAN") return { value: normBool(raw), normalized_value: normBool(raw) };
  if (qType === "ADDRESS") return { value: String(raw), normalized_value: String(raw).trim() };
  return { value: String(raw), normalized_value: String(raw).trim() };
}

// ---------- VALIDATION (per-question) ----------
export function validateQuestion(q: ResolvedQuestion, norm: { value: string; normalized_value: string }, allAnswers: Record<string, any>): { valid: boolean; error?: string } {
  if (q.required && !norm.normalized_value) return { valid: false, error: "This field is required" };
  if (!norm.normalized_value) return { valid: true };
  const r = q.validation_rule || {};
  if (r.min_length && norm.value.length < r.min_length) return { valid: false, error: `Minimum ${r.min_length} characters` };
  if (r.max_length && norm.value.length > r.max_length) return { valid: false, error: `Maximum ${r.max_length} characters` };
  if (r.pattern && !new RegExp(r.pattern).test(norm.value)) return { valid: false, error: "Invalid format" };
  if (q.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm.normalized_value)) return { valid: false, error: "Invalid email" };
  if (q.type === "PHONE" && norm.normalized_value.length < 7) return { valid: false, error: "Invalid phone number" };
  if (q.type === "DATE") { const d = new Date(norm.normalized_value); if (Number.isNaN(d.getTime())) return { valid: false, error: "Invalid date" }; }
  if (q.type === "COUNTRY" && norm.normalized_value.length < 2) return { valid: false, error: "Invalid country code" };
  if (q.type === "SELECT" && q.options.length) {
    if (!q.options.some((o) => o.value === norm.value || o.value === norm.normalized_value)) return { valid: false, error: "Select a valid option" };
  }
  if (q.type === "DOCUMENT_REFERENCE") {
    if (!norm.value) return { valid: true };
    try { const o = JSON.parse(norm.value); if (!o?.document_id) return { valid: false, error: "Pick a document" }; } catch { return { valid: false, error: "Invalid document reference" }; }
  }
  return { valid: true };
}

// ---------- CROSS-FIELD VALIDATION (route rule based, deterministic) ----------
export interface CrossFieldError { code: string; message: string; severity: "HIGH" | "MEDIUM"; blocking: boolean; fields: string[]; }
export function validateCrossField(answers: Record<string, any>, app: any): CrossFieldError[] {
  const errs: CrossFieldError[] = [];
  const dep = answers["travel.departure_date"] || app.travel_start;
  const ret = answers["travel.return_date"] || app.travel_end;
  if (dep && ret && new Date(ret) < new Date(dep)) errs.push({ code: "TRAVEL_DATE_ORDER", message: "Return date must be after departure date", severity: "HIGH", blocking: true, fields: ["travel.departure_date", "travel.return_date"] });
  const exp = answers["passport.expiry_date"];
  if (exp && ret && new Date(exp) <= new Date(ret)) errs.push({ code: "PASSPORT_EXPIRY_BEFORE_RETURN", message: "Passport must be valid beyond the return date", severity: "HIGH", blocking: true, fields: ["passport.expiry_date", "travel.return_date"] });
  const ci = answers["accommodation.hotel_check_in"], co = answers["accommodation.hotel_check_out"];
  if (ci && co && new Date(co) <= new Date(ci)) errs.push({ code: "HOTEL_DATE_ORDER", message: "Hotel check-out must be after check-in", severity: "MEDIUM", blocking: true, fields: ["accommodation.hotel_check_in", "accommodation.hotel_check_out"] });
  const start = answers["employment.start_date"];
  if (start && new Date(start) > new Date()) errs.push({ code: "EMPLOYMENT_FUTURE_START", message: "Employment start date cannot be in the future", severity: "LOW", blocking: false, fields: ["employment.start_date"] });
  return errs;
}

// ---------- PREPOPULATION ----------
// Priority: Verified DocumentExtraction → Verified Traveler → Previous verified app.
// Never overwrites an existing active answer.
async function passportExtractionsForApp(svc: any, app: any): Promise<Record<string, { value: string; extraction_id: string; version_id: string; confidence: number; verified: boolean }>> {
  const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
  const passportAd = attachments.find((a) => a.status !== "detached" && a.document_type === "PASSPORT");
  if (!passportAd) return {};
  const versionId = passportAd.document_version_id;
  const intel: any = (await svc.entities.DocumentIntelligence.filter({ document_version_id: versionId }).catch(() => []))[0] || null;
  const extractions: any[] = await svc.entities.DocumentExtraction.filter({ document_version_id: versionId }).catch(() => []);
  const out: Record<string, any> = {};
  for (const e of extractions) {
    out[e.field_name] = {
      value: e.normalized_value || e.field_value || "",
      extraction_id: e.id, version_id: versionId, confidence: e.confidence || 0,
      verified: intel?.status === "ready",
    };
  }
  return out;
}

async function travelerForApp(svc: any, app: any): Promise<any> {
  return await svc.entities.Traveler.get(app.traveler_id).catch(() => null);
}

async function previousVerifiedAnswers(svc: any, app: any): Promise<Record<string, any>> {
  const apps: any[] = await svc.entities.VisaApplication.filter({ traveler_id: app.traveler_id }).catch(() => []);
  const prev = apps
    .filter((a) => a.id !== app.id && ["approved", "completed", "submitted", "application_ready"].includes(a.status))
    .sort((a, b) => String(b.updated_date || "").localeCompare(String(a.updated_date || "")))[0];
  if (!prev) return {};
  const ans: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: prev.id, active: true }).catch(() => []);
  // Restrict reuse to USER-sourced verified answers (trusted) and document-verified answers.
  const out: Record<string, any> = {};
  for (const a of ans) if (a.verified && a.normalized_value) out[a.question_code] = { value: a.value, normalized_value: a.normalized_value, source_application_id: prev.id, confidence: 0.8 };
  return out;
}

async function documentReferenceCandidates(svc: any, app: any, documentTypes: string[]): Promise<any | null> {
  const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
  const ad = attachments.find((a) => a.status !== "detached" && documentTypes.includes(a.document_type));
  if (!ad) return null;
  return { document_id: ad.document_id, document_version_id: ad.document_version_id, display_name: ad.metadata?.display_name || ad.document_type };
}

/** Auto-fill answers that have a trusted source and no existing active user answer. */
export async function prepopulateAnswers(svc: any, app: any, questionSet: { questions: ResolvedQuestion[] }): Promise<{ answers: any[]; filled: number }> {
  const existing: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
  const existingByCode: Record<string, any> = {};
  for (const a of existing) existingByCode[a.question_code] = a;
  const passport = await passportExtractionsForApp(svc, app);
  const traveler = await travelerForApp(svc, app);
  const prev = await previousVerifiedAnswers(svc, app);
  let filled = 0;
  const created: any[] = [];
  const createdCodes = new Set<string>();
  for (const q of questionSet.questions) {
    if (!q.data_source && q.type !== "DOCUMENT_REFERENCE") continue;
    if (existingByCode[q.code] || createdCodes.has(q.code)) continue;
    createdCodes.add(q.code);
    let value = "", sourceType: any = null, sourceId: any = null, confidence = 0, verified = false, meta: any = {};
    if (q.data_source.source_type === "PASSPORT") {
      const ex = passport[q.data_source.field];
      if (ex && ex.value) { value = ex.value; sourceType = "PASSPORT"; sourceId = ex.extraction_id; confidence = ex.confidence; verified = ex.verified; meta = { document_version_id: ex.version_id, extracted_value: ex.value }; }
    } else if (q.data_source.source_type === "TRAVELER" && traveler) {
      const tv = traveler[q.data_source.field];
      if (tv) { value = String(tv); sourceType = "TRAVELER"; sourceId = traveler.id; confidence = 0.9; verified = true; }
    }
    // Previous verified app reuse (USER/verified answers only).
    if (!value && prev[q.code]) {
      value = prev[q.code].normalized_value; sourceType = "PREVIOUS_APPLICATION"; sourceId = prev[q.code].source_application_id; confidence = 0.8; verified = true;
    }
    // DOCUMENT_REFERENCE prefill from an attached matching document.
    if (q.type === "DOCUMENT_REFERENCE" && !value) {
      let types: string[] = [];
      if (q.code === "financial.bank_statement_reference") types = CATEGORY_TO_TYPES["bank_statement"] || ["BANK_STATEMENT"];
      else if (q.code.includes("invitation_letter_reference")) types = ["INVITATION_LETTER"];
      else if (q.code.includes("admission_letter_reference")) types = ["ADMISSION_LETTER"];
      else if (q.code.includes("refusal_letter_reference")) types = ["REFUSAL_LETTER"];
      else if (q.code.includes("sponsor_financial_proof_reference")) types = ["SPONSOR_FINANCIAL_PROOF"];
      if (types.length) {
        const ref = await documentReferenceCandidates(svc, app, types);
        if (ref) { value = JSON.stringify(ref); sourceType = "DOCUMENT"; sourceId = ref.document_version_id; confidence = 0.9; verified = true; meta = ref; }
      }
    }
    if (!value) continue;
    const norm = normalizeAnswer(q.type, value);
    const row = await svc.entities.ApplicationAnswer.create({
      application_id: app.id, traveler_id: app.traveler_id, question_code: q.code,
      value: norm.value, normalized_value: norm.normalized_value,
      source_type: sourceType, source_id: sourceId, confidence, verified, active: true, metadata: meta,
    }).catch(() => null);
    if (row) { created.push(row); filled++; }
  }
  if (filled) await documentAudit(svc, { id: "system" } as any, { action: "application.answers_prepopulated", entity_type: "VisaApplication", entity_id: app.id, application_id: app.id, detail: { count: filled } });
  return { answers: created, filled };
}

// ---------- ANSWER READ ----------
export async function listAnswers(svc: any, user: any, appId: string): Promise<{ application: any; question_set: any; answers: any[]; conflict_findings: any[] }> {
  const app = await getApplication(svc, user, appId);
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);
  const qs = await resolveQuestionSet(svc, app, answers);
  // Auto-populate missing answers from trusted sources on first read (idempotent).
  await prepopulateAnswers(svc, app, qs).catch(() => {});
  const refreshed: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);
  const conflictFindings: any[] = await svc.entities.DocumentFinding.filter({ application_id: app.id, type: "APPLICATION_DATA_CONFLICT" }).catch(() => []);
  return { application: app, question_set: qs, answers: refreshed, conflict_findings: conflictFindings };
}

// ---------- ANSWER UPSERT (idempotent, source-aware, conflict-detecting) ----------
export async function upsertAnswer(svc: any, user: any, app: any, code: string, rawValue: any, opts: { confirm?: boolean } = {}): Promise<{ answer: any; errors: string[]; conflict?: any }> {
  const q = (await ensureQuestionCatalog(svc), (await svc.entities.ApplicationQuestionDefinition.filter({ question_code: code, version: app.question_version || QUESTION_VERSION, status: "active" }).catch(() => []))[0]);
  if (!q) throw Object.assign(new Error("Unknown question: " + code), { code: "UNKNOWN_QUESTION" });
  const existing: any[] = (await svc.entities.ApplicationAnswer.filter({ application_id: app.id, question_code: code }).catch(() => []));
  const cur = existing.find((a) => a.active !== false) || existing[0] || null;

  const actor = (user && (user.full_name || user.email)) || (user && user.id) || "system";
  const errors: string[] = [];
  let conflict: any = null;

  // Confirm path: mark the existing document-derived answer verified=true (user said "Yes").
  if (opts.confirm && cur) {
    if (cur.verified) return { answer: cur, errors: [] };
    const ans = await svc.entities.ApplicationAnswer.update(cur.id, { verified: true, updated_at: new Date().toISOString() }).catch(() => cur);
    await documentAudit(svc, user as any, { action: "application.answer_verified", entity_type: "ApplicationAnswer", entity_id: ans.id, application_id: app.id, detail: { question_code: code } });
    return { answer: ans, errors: [] };
  }

  const norm = normalizeAnswer(q.type, rawValue);
  const allAnswers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
  const facts = factsFromAnswers(allAnswers);
  facts[code] = norm.normalized_value;
  const v = validateQuestion(q as any, norm, facts);
  if (!v.valid && v.error) errors.push(v.error);

  // Conflict detection: overriding a document-derived value with a different one.
  const prevValue = cur?.value;
  const wasDocDerived = cur && cur.source_type && ["PASSPORT", "TRAVELER", "DOCUMENT", "DOCUMENT_EXTRACTION", "PREVIOUS_APPLICATION"].includes(cur.source_type);
  const valueChanged = !!cur && !!prevValue && prevValue !== norm.value && norm.value !== "";
  if (wasDocDerived && valueChanged) {
    const versionId = cur?.metadata?.document_version_id || null;
    conflict = await svc.entities.DocumentFinding.create({
      document_version_id: versionId || "(none)", document_id: null, intelligence_id: null, application_id: app.id,
      type: "APPLICATION_DATA_CONFLICT", severity: "MEDIUM", blocking: false,
      field: code, message: `User overrode extracted "${code}" (was "${prevValue}", now "${norm.value}")`,
      code: "APPLICATION_DATA_CONFLICT", source: "application_data", resolved: false,
      metadata: { question_code: code, extracted_value: prevValue, user_value: norm.value },
    }).catch(() => null);
    await documentAudit(svc, user as any, { action: "application.answer_overridden", entity_type: "ApplicationAnswer", entity_id: cur.id, application_id: app.id, detail: { question_code: code, from: prevValue, to: norm.value } });
  } else if (valueChanged) {
    await documentAudit(svc, user as any, { action: "application.answer_changed", entity_type: "ApplicationAnswer", entity_id: cur.id, application_id: app.id, detail: { question_code: code, from: prevValue, to: norm.value } });
  } else if (!cur) {
    await documentAudit(svc, user as any, { action: "application.question_answered", entity_type: "ApplicationAnswer", entity_id: "(new)", application_id: app.id, detail: { question_code: code, source_type: "USER" } });
  }

  const meta = { ...(cur?.metadata || {}), extracted_value: wasDocDerived ? prevValue : (cur?.metadata?.extracted_value || null), previous_value: prevValue || null };
  const payload: any = {
    application_id: app.id, traveler_id: app.traveler_id, question_code: code,
    value: norm.value, normalized_value: norm.normalized_value,
    source_type: "USER", source_id: null, confidence: 1, verified: true, active: true, metadata: meta,
  };
  let answer: any;
  if (cur) answer = await svc.entities.ApplicationAnswer.update(cur.id, payload).catch(() => cur);
  else answer = await svc.entities.ApplicationAnswer.create(payload).catch(() => null);

  // Stale-answer handling: questions whose visibility rule no longer matches → mark inactive (restorable).
  await reconcileStaleAnswers(svc, app).catch(() => {});
  return { answer, errors, conflict };
}

export async function bulkUpsertAnswers(svc: any, user: any, app: any, payload: Record<string, any>): Promise<{ saved: number; errors: any[] }> {
  let saved = 0;
  const errors: any[] = [];
  for (const [code, value] of Object.entries(payload || {})) {
    try { await upsertAnswer(svc, user, app, code, value); saved++; } catch (e: any) { errors.push({ code, error: e?.message || String(e) }); }
  }
  return { saved, errors };
}

/** Mark answers to now-hidden questions as inactive (restorable). */
async function reconcileStaleAnswers(svc: any, app: any): Promise<void> {
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
  if (!answers.length) return;
  const qs = await resolveQuestionSet(svc, app, answers);
  const visibleCodes = new Set(qs.questions.filter((q) => q.visible).map((q) => q.code));
  for (const a of answers) {
    if (!visibleCodes.has(a.question_code)) {
      await svc.entities.ApplicationAnswer.update(a.id, { active: false }).catch(() => {});
    }
  }
}

// ---------- READINESS (deterministic) ----------
export interface BlockingItem { type: "QUESTION" | "DOCUMENT" | "FINDING" | "REVIEW"; code: string; message?: string }
// The confirmation readiness gate blocks only on the MATERIAL field set
// (passport + personal identity, travel purpose) plus the cross-field,
// document, finding and review checks below. Travel dates, employment and
// income are collected later and are optional in the combined MVP wizard, so
// they never block the review/confirmation gate.
const MATERIAL_GATE_CODES = new Set<string>([
  "personal.surname", "personal.given_names", "personal.date_of_birth", "personal.nationality",
  "passport.passport_number", "passport.expiry_date",
  "travel.purpose",
]);

export async function checkApplicationReadiness(svc: any, app: any): Promise<{ ready: boolean; blocking_items: BlockingItem[]; progress: any }> {
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
  const qs = await resolveQuestionSet(svc, app, answers);
  const facts = factsFromAnswers(answers);
  const crossErrs = validateCrossField(facts, app);
  const blocking: BlockingItem[] = [];
  // Questions: only MATERIAL fields gate confirmation. Non-material required
  // questions remain part of the progress snapshot but never block here.
  for (const q of qs.questions) {
    if (!q.visible || !q.required || !MATERIAL_GATE_CODES.has(q.code)) continue;
    const a = answers.find((x) => x.question_code === q.code && x.active !== false);
    if (!a || !a.normalized_value || !a.verified) blocking.push({ type: "QUESTION", code: q.code, message: q.label });
  }
  // Cross-field errors.
  for (const e of crossErrs) if (e.blocking) blocking.push({ type: "QUESTION", code: e.code, message: e.message });
  // Documents: requirement progress (mandatory → verified).
  const progress = await computeRequirementProgress(svc, app);
  for (const it of progress.items || []) {
    if (it.mandatory_level === "mandatory" && it.state !== "verified") blocking.push({ type: "DOCUMENT", code: it.document_type, message: it.name });
  }
  // Blocking document findings.
  const findings: any[] = await svc.entities.DocumentFinding.filter({ application_id: app.id, resolved: false, blocking: true }).catch(() => []);
  for (const f of findings) blocking.push({ type: "FINDING", code: f.code, message: f.message });
  // Pending human reviews.
  const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
  for (const a of attachments) {
    if (a.status === "detached") continue;
    const intel: any = (await svc.entities.DocumentIntelligence.filter({ document_version_id: a.document_version_id }).catch(() => []))[0] || null;
    if (intel?.status === "needs_review") blocking.push({ type: "REVIEW", code: a.document_version_id, message: `Document needs review: ${a.document_type}` });
  }
  const ready = blocking.length === 0;
  const questionTotal = qs.questions.filter((q) => q.visible && q.required).length;
  const questionComplete = qs.questions.filter((q) => q.visible && q.required).every((q) => { const a = answers.find((x) => x.question_code === q.code && x.active !== false); return a && a.normalized_value && a.verified; });
  // Emit readiness-changed event (best-effort, in-process bus).
  try { await bus.dispatch("ApplicationReadinessChanged" as any, { payload: { application_id: app.id, ready, blocking_count: blocking.length }, actor: "system" }); } catch {}
  return { ready, blocking_items: blocking, progress: { ...progress, question_total: questionTotal, question_complete: questionComplete ? 1 : 0 } };
}

// ---------- ORCHESTRATOR COMPLETION ----------
// When readiness is true, mark the Phase-6 application tasks completed + advance the
// orchestrator. Idempotent — no-op if already done. The orchestrator is the sole owner
// of task state; this only signals completion (mirror of completeDocumentRequirementSignal).
export async function completeApplicationInformationSignal(svc: any, user: any, app: any): Promise<{ ready: boolean; advanced: boolean }> {
  const readiness = await checkApplicationReadiness(svc, app);
  if (!readiness.ready) return { ready: false, advanced: false };
  if (!app.run_id) return { ready: true, advanced: false };
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: app.run_id }).catch(() => []);
  const targets = tasks.filter((t) => ["collect_application_information", "validate_application_information"].includes(t.task_key) && !["completed", "skipped"].includes(t.status));
  for (const t of targets) {
    await svc.entities.LaunchTask.update(t.id, { status: "completed", output: { via: "question_engine", completed_at: new Date().toISOString() }, completed_at: new Date().toISOString() }).catch(() => {});
  }
  if (targets.length) {
    const actor = (user && (user.full_name || user.email)) || (user && user.id) || "system";
    await advanceRun(svc, { runId: app.run_id, actor }).catch(() => {});
    await documentAudit(svc, user as any, { action: "application.information_completed", entity_type: "VisaApplication", entity_id: app.id, application_id: app.id, detail: {} });
    return { ready: true, advanced: true };
  }
  return { ready: true, advanced: false };
}