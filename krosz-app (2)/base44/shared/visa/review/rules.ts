// Worldz Visa (Phase 13) — Review Engine: deterministic rules (pure functions).
// AI is supplementary and never blocks. A rule receives the assembled ReviewInput
// and returns raw findings; the engine owns persistence, dedupe, and status.
import { nameSimilarity, normalizeCountry, normalizeDate, normalizeName } from "../intelligence.ts";

export type FindingSeverity = "INFO" | "WARNING" | "BLOCKING" | "CRITICAL";
export const RULE_VERSION = "review.rules.v1";
export const REVIEW_ENGINE_VERSION = "13.1";

export interface RawFinding {
  category: string;
  code: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  description_operator: string;
  source: string; // rule_code.version
  field_path?: string;
  entity_type?: string;
  entity_id?: string;
  evidence?: any;
  requires_human_review?: boolean;
}

export interface ReviewInput {
  now: string;
  application: any;
  traveler: any;
  requirementsVersion: string | null;
  requirements: any[];
  progress: { items: any[]; total: number; complete: number; pending: number };
  passportFields: Record<string, string> | null;
  passportVersionId: string | null;
  answers: Record<string, string>;
  answersReady: boolean;
  formSnapshot: any | null;
  formStale: boolean;
  pkg: any | null;
  packageStale: boolean;
  packageIntegrityValid: boolean;
  orders: any[];
  paymentRequired: boolean;
  paymentPaid: boolean;
  appointments: any[];
  appointmentBooked: boolean;
  resolvedProvider: any | null;
  blockingDocumentFindings: any[];
}

export function evaluateRules(input: ReviewInput): RawFinding[] {
  const out: RawFinding[] = [];
  const guard = (f: RawFinding): RawFinding => ({ ...f, source: `${f.source || f.code}_V1`.replace(/_V1_V1/, "_V1") });
  const push = (f: RawFinding) => out.push(f);

  completeness(input, push);
  identity(input, push);
  documentRules(input, push);
  formRules(input, push);
  packageRules(input, push);
  paymentRules(input, push);
  appointmentRules(input, push);
  providerRules(input, push);
  intelligenceRules(input, push);
  travelRules(input, push);
  return out.map(guard);
}

// ---------- Completeness ----------
function completeness(i: ReviewInput, push: (f: RawFinding) => void) {
  if (!i.answersReady) push({ category: "Application", code: "APPLICATION_INFORMATION_INCOMPLETE", severity: "BLOCKING", title: "Application information incomplete", description: "Some required application questions still need answers before review.", description_operator: "checkApplicationReadiness.ready=false", source: "APPLICATION_INFORMATION_INCOMPLETE" });
  if (i.progress.total > 0 && i.progress.pending > 0) push({ category: "Documents", code: "DOCUMENTS_INCOMPLETE", severity: "BLOCKING", title: "Documents incomplete", description: `${i.progress.pending} required document${i.progress.pending === 1 ? "" : "s"} still ${i.progress.pending === 1 ? "needs" : "need"} to be verified.`, description_operator: `progress.pending=${i.progress.pending}/${i.progress.total}`, source: "DOCUMENTS_INCOMPLETE" });
}

// ---------- Identity consistency ----------
function formField(snap: any, ...aliases: string[]): string {
  if (!snap || !snap.fields) return "";
  for (const a of aliases) if (snap.fields[a] != null && snap.fields[a] !== "") return String(snap.fields[a]);
  return "";
}
const NAME_ALIASES = { surname: ["applicant.surname", "app.family_name"], given: ["applicant.given_names", "app.given_name"], dob: ["applicant.date_of_birth", "app.birth_date"], nationality: ["applicant.nationality", "app.nationality"], passportNumber: ["applicant.passport_number", "passport.number"], passportExpiry: ["applicant.passport_expiry", "passport.expiry"] };

function identity(i: ReviewInput, push: (f: RawFinding) => void) {
  const p = i.passportFields || {};
  const a = i.answers || {};
  const snap = i.formSnapshot;
  const trav = i.traveler || {};
  const havePassport = !!i.passportFields;

  const names: { src: string; val: string }[] = [];
  if (havePassport) {
    const pn = [p.surname, p.given_names].filter(Boolean).join(" ").trim();
    if (pn) names.push({ src: "passport", val: pn });
  }
  const an = [a["personal.surname"], a["personal.given_names"]].filter(Boolean).join(" ").trim();
  if (an) names.push({ src: "application", val: an });
  const tn = [trav.first_name, trav.last_name].filter(Boolean).join(" ").trim();
  if (tn) names.push({ src: "traveler", val: tn });
  const fn = [formField(snap, ...NAME_ALIASES.surname), formField(snap, ...NAME_ALIASES.given)].filter(Boolean).join(" ").trim();
  if (fn) names.push({ src: "form", val: fn });

  if (names.length >= 2) {
    let worst = 1;
    const conflicts: string[] = [];
    for (let x = 0; x < names.length; x++) for (let y = x + 1; y < names.length; y++) {
      const sim = nameSimilarity(names[x].val, names[y].val);
      worst = Math.min(worst, sim);
      if (sim < 0.9) conflicts.push(`${names[x].src} "${names[x].val}" vs ${names[y].src} "${names[y].val}"`);
    }
    if (worst < 0.9) push({ category: "Identity", code: "IDENTITY_NAME_MISMATCH", severity: "BLOCKING", title: "Identity mismatch", description: "Your name does not match across your passport, application and government form. Please correct the inconsistency.", description_operator: `nameSimilarity worst=${worst.toFixed(2)}; ${conflicts.join(" | ")}`, source: "IDENTITY_NAME", field_path: "name", entity_type: "Identity", evidence: { sources: names, similarity: worst } });
  }

  // Passport number — exact normalized match.
  const ppNumbers: { src: string; val: string }[] = [];
  if (p.passport_number) ppNumbers.push({ src: "passport", val: normalizeName(p.passport_number) });
  if (a["passport.passport_number"]) ppNumbers.push({ src: "application", val: normalizeName(a["passport.passport_number"]) });
  const fpn = formField(snap, ...NAME_ALIASES.passportNumber);
  if (fpn) ppNumbers.push({ src: "form", val: normalizeName(fpn) });
  if (treallyPassport(trav)) ppNumbers.push({ src: "traveler", val: normalizeName(trav.passport_number || "") });
  if (ppNumbers.length >= 2) {
    const refs = ppNumbers.map((x) => x.val);
    const uniq = Array.from(new Set(refs));
    if (uniq.length > 1) push({ category: "Identity", code: "PASSPORT_NUMBER_MISMATCH", severity: "BLOCKING", title: "Passport number mismatch", description: "The passport number differs between your passport, application and government form.", description_operator: `passport numbers: ${ppNumbers.map((x) => `${x.src}=${x.val}`).join(", ")}`, source: "PASSPORT_NUMBER", field_path: "passport_number", entity_type: "Identity", evidence: { sources: ppNumbers } });
  }

  // Date of birth — CRITICAL mismatch.
  const dobs: { src: string; val: string }[] = [];
  if (p.date_of_birth) dobs.push({ src: "passport", val: normalizeDate(p.date_of_birth) });
  if (a["personal.date_of_birth"]) dobs.push({ src: "application", val: normalizeDate(a["personal.date_of_birth"]) });
  const fd = formField(snap, ...NAME_ALIASES.dob);
  if (fd) dobs.push({ src: "form", val: normalizeDate(fd) });
  if (trav.date_of_birth) dobs.push({ src: "traveler", val: normalizeDate(trav.date_of_birth) });
  if (dobs.length >= 2) {
    const uniq = Array.from(new Set(dobs.map((d) => d.val).filter(Boolean)));
    if (uniq.length > 1) push({ category: "Identity", code: "DATE_OF_BIRTH_MISMATCH", severity: "CRITICAL", title: "Date of birth mismatch", description: "Your date of birth differs between your passport, application and government form. This requires correction.", description_operator: `dob values: ${dobs.map((x) => `${x.src}=${x.val}`).join(", ")}`, source: "DATE_OF_BIRTH", field_path: "date_of_birth", entity_type: "Identity", requires_human_review: true, evidence: { sources: dobs } });
  }

  // Nationality — CRITICAL mismatch. Never infer citizenship from residence.
  const nats: { src: string; val: string }[] = [];
  if (p.nationality) nats.push({ src: "passport", val: normalizeCountry(p.nationality) });
  if (a["personal.nationality"]) nats.push({ src: "application", val: normalizeCountry(a["personal.nationality"]) });
  if (i.application?.nationality) nats.push({ src: "application.nationality", val: normalizeCountry(i.application.nationality) });
  const fnat = formField(snap, ...NAME_ALIASES.nationality);
  if (fnat) nats.push({ src: "form", val: normalizeCountry(fnat) });
  if (trav.nationality) nats.push({ src: "traveler", val: normalizeCountry(trav.nationality) });
  if (nats.length >= 2) {
    const uniq = Array.from(new Set(nats.map((n) => n.val).filter(Boolean)));
    if (uniq.length > 1) push({ category: "Identity", code: "NATIONALITY_MISMATCH", severity: "CRITICAL", title: "Nationality mismatch", description: "Your nationality differs between your passport, application and government form. This requires correction.", description_operator: `nationality values: ${nats.map((x) => `${x.src}=${x.val}`).join(", ")}`, source: "NATIONALITY", field_path: "nationality", entity_type: "Identity", requires_human_review: true, evidence: { sources: nats } });
  }

  // Passport expiry vs route validity threshold (read from requirement title; never hardcode 6 months).
  const passportReq = i.requirements.find((r: any) => String(r.document_category || "").toLowerCase().includes("passport"));
  const months = passportReq ? parseMonths(`${passportReq.title || ""} ${passportReq.description || ""}`) : null;
  const expiry = p.expiry_date || a["passport.expiry_date"] || formField(snap, ...NAME_ALIASES.passportExpiry) || "";
  if (expiry) {
    const expIso = normalizeDate(expiry);
    if (expIso) {
      const travelStart = i.application?.travel_start || a["travel.departure_date"] || "";
      if (months && travelStart) {
        const required = new Date(travelStart); required.setMonth(required.getMonth() + months);
        if (new Date(expIso) < required) push({ category: "Documents", code: "PASSPORT_EXPIRY", severity: "BLOCKING", title: "Passport validity", description: "Your passport may not meet the required validity period for this application.", description_operator: `route requires ${months}+ months beyond ${travelStart}; passport expires ${expIso}`, source: "PASSPORT_EXPIRY", field_path: "expiry_date", entity_type: "Document", evidence: { months_required: months, travel_start: travelStart, passport_expiry: expIso } });
      }
      // Vault-level expiry regardless of route.
      const expMs = new Date(expIso).getTime();
      if (!Number.isNaN(expMs)) {
        const nowMs = new Date(i.now).getTime();
        if (expMs < nowMs) push({ category: "Documents", code: "PASSPORT_EXPIRED", severity: "BLOCKING", title: "Passport expired", description: "Your passport has expired and cannot be used for this application.", description_operator: `passport expired ${expIso}`, source: "PASSPORT_EXPIRED", field_path: "expiry_date", entity_type: "Document", evidence: { passport_expiry: expIso } });
        else if (expMs - nowMs < 30 * 86400000) push({ category: "Documents", code: "PASSPORT_EXPIRING", severity: "WARNING", title: "Passport expiring soon", description: "Your passport expires within 30 days.", description_operator: `passport expires ${expIso}`, source: "PASSPORT_EXPIRING", field_path: "expiry_date", entity_type: "Document", evidence: { passport_expiry: expIso } });
      }
    }
  } else if (havePassport) {
    // No expiry extracted — cannot verify. Warning, never assume expiry months.
    push({ category: "Documents", code: "PASSPORT_EXPIRY_UNKNOWN", severity: "WARNING", title: "Passport expiry not verified", description: "We couldn't read the passport expiry date. A clear scan is required for manual verification.", description_operator: "passport expiry_date not extracted", source: "PASSPORT_EXPIRY", field_path: "expiry_date", entity_type: "Document", requires_human_review: true });
  }
  if (passportReq && !months && !expiry) {
    push({ category: "Documents", code: "PASSPORT_VALIDITY_MANUAL", severity: "WARNING", title: "Passport validity requires manual check", description: "The required passport validity period is not fully configured for this route. Our team will verify it manually.", description_operator: `no months threshold parsed from passport requirement title`, source: "PASSPORT_EXPIRY", field_path: "expiry_date", requires_human_review: true });
  }
}

function treallyPassport(t: any): boolean { return !!(t && t.passport_number); }
function parseMonths(text: string): number | null { const m = /(\d+)\s*\+?\s*months?/.exec(String(text || "").toLowerCase()); return m ? parseInt(m[1], 10) : null; }

// ---------- Document rules ----------
function documentRules(i: ReviewInput, push: (f: RawFinding) => void) {
  for (const item of i.progress.items || []) {
    if (item.mandatory_level === "mandatory" && item.state !== "verified") {
      if (item.state === "missing") push({ category: "Documents", code: "DOCUMENT_REQUIRED", severity: "BLOCKING", title: "Document required", description: `A required document is missing: ${item.name}.`, description_operator: `requirement_id=${item.requirement_id} types=${(item.document_types || []).join(",")} state=${item.state}`, source: "DOCUMENT_REQUIRED", field_path: "document", entity_type: "DocumentRequirement", entity_id: item.requirement_id, evidence: { name: item.name, document_type: item.document_type } });
      else push({ category: "Documents", code: "DOCUMENT_NEEDS_REVIEW", severity: "WARNING", title: "Document needs review", description: `${item.name} needs re-review before submission.`, description_operator: `requirement_id=${item.requirement_id} state=${item.state}`, source: "DOCUMENT_NEEDS_REVIEW", field_path: "document", entity_type: "DocumentRequirement", entity_id: item.requirement_id, requires_human_review: true, evidence: { name: item.name, state: item.state } });
    }
    // Type mismatch: attached type not in allowed types for the requirement.
    if (item.application_document && item.document_types && item.document_types.length) {
      const attachedType = item.application_document.document_type;
      if (attachedType && !item.document_types.includes(attachedType)) push({ category: "Documents", code: "DOCUMENT_TYPE_MISMATCH", severity: "BLOCKING", title: "Wrong document type", description: `The attached document does not satisfy the requirement: ${item.name}.`, description_operator: `required types=${item.document_types.join(",")} attached=${attachedType}`, source: "DOCUMENT_TYPE", field_path: "document_type", entity_type: "ApplicationDocument", entity_id: item.application_document.id, evidence: { required: item.document_types, attached: attachedType } });
    }
  }
  // Duplicate documents — INFO only (don't block unless route forbids; not configured).
}

// ---------- Form rules ----------
function formRules(i: ReviewInput, push: (f: RawFinding) => void) {
  if (i.formSnapshot && (i.formSnapshot.status === "stale" || i.formStale)) push({ category: "Forms", code: "FORM_STALE", severity: "BLOCKING", title: "Form out of date", description: "Your government form is out of date. Please regenerate it before submitting.", description_operator: "form snapshot stale", source: "FORM_STALE", field_path: "form", entity_type: "ApplicationFormSnapshot", entity_id: i.formSnapshot.id, requires_human_review: true });
}

// ---------- Package rules ----------
function packageRules(i: ReviewInput, push: (f: RawFinding) => void) {
  if (!i.pkg) return;
  if (i.packageStale) push({ category: "Submission", code: "PACKAGE_STALE", severity: "BLOCKING", title: "Submission package out of date", description: "Your submission package changed since it was built. Please regenerate it before submitting.", description_operator: "package stale", source: "PACKAGE_STALE", field_path: "package", entity_type: "SubmissionPackage", entity_id: i.pkg.id, requires_human_review: true });
  if (!i.packageIntegrityValid) push({ category: "Submission", code: "PACKAGE_HASH", severity: "BLOCKING", title: "Submission package integrity", description: "The submission package integrity check failed. Please rebuild the package.", description_operator: "package integrity invalid", source: "PACKAGE_HASH", field_path: "package_hash", entity_type: "SubmissionPackage", entity_id: i.pkg.id });
}

// ---------- Payment rules ----------
function paymentRules(i: ReviewInput, push: (f: RawFinding) => void) {
  if (i.paymentRequired && !i.paymentPaid) push({ category: "Payment", code: "PAYMENT_REQUIRED", severity: "BLOCKING", title: "Payment required", description: "Payment is required before you can submit this application.", description_operator: "canExecutePaidService gate=PAYMENT unpaid", source: "PAYMENT_REQUIRED", field_path: "payment", entity_type: "Order" });
}

// ---------- Appointment rules ----------
function appointmentRules(i: ReviewInput, push: (f: RawFinding) => void) {
  if (!i.application?.appointment_required) return;
  if (!i.appointmentBooked) { push({ category: "Appointments", code: "APPOINTMENT_REQUIRED", severity: "BLOCKING", title: "Appointment required", description: "You need to book an appointment before submitting.", description_operator: "appointment_required=true, no booked appointment", source: "APPOINTMENT_REQUIRED", field_path: "appointment", entity_type: "Appointment" }); return; }
  for (const appt of i.appointments || []) {
    if (appt.scheduled_at) {
      const t = new Date(appt.scheduled_at).getTime();
      if (!Number.isNaN(t) && t < new Date(i.now).getTime()) push({ category: "Appointments", code: "APPOINTMENT_PAST", severity: "WARNING", title: "Appointment in the past", description: "Your appointment date has passed. Please reschedule if needed.", description_operator: `appointment ${appt.scheduled_at} is in the past`, source: "APPOINTMENT_PAST", field_path: "scheduled_at", entity_type: "Appointment", entity_id: appt.id, evidence: { scheduled_at: appt.scheduled_at } });
    }
  }
}

// ---------- Provider readiness ----------
function providerRules(i: ReviewInput, push: (f: RawFinding) => void) {
  if (!i.pkg) return;
  if (!i.resolvedProvider) push({ category: "Submission", code: "SUBMISSION_PROVIDER", severity: "BLOCKING", title: "No submission provider available", description: "We could not resolve a submission provider for this route. Our team will action this.", description_operator: "resolveProviderForApplication returned none", source: "SUBMISSION_PROVIDER", field_path: "provider", entity_type: "Provider" });
}

// ---------- Reuse Document Intelligence findings (route/cross-document) ----------
function intelligenceRules(i: ReviewInput, push: (f: RawFinding) => void) {
  for (const f of i.blockingDocumentFindings || []) {
    if (f.resolved) continue;
    const sev: FindingSeverity = f.severity === "CRITICAL" ? "CRITICAL" : f.blocking ? "BLOCKING" : "WARNING";
    push({ category: "Documents", code: f.code || "DOCUMENT_FINDING", severity: sev, title: "Document issue", description: f.message || "A document issue was detected.", description_operator: `source=${f.source} code=${f.code} field=${f.field || ""}`, source: "DOCUMENT_INTELLIGENCE", field_path: f.field || "document", entity_type: "DocumentVersion", entity_id: f.document_version_id, evidence: { message: f.message, source: f.source }, requires_human_review: sev === "CRITICAL" });
  }
}

// ---------- Travel date consistency (basic) ----------
function travelRules(i: ReviewInput, push: (f: RawFinding) => void) {
  const s = i.application?.travel_start, e = i.application?.travel_end;
  if (s && e && normalizeDate(e) && normalizeDate(s) && normalizeDate(e) < normalizeDate(s)) push({ category: "Travel", code: "TRAVEL_DATE_ORDER", severity: "BLOCKING", title: "Travel dates inconsistent", description: "Your return date is before your departure date.", description_operator: `travel_start=${s} travel_end=${e}`, source: "TRAVEL_DATE", field_path: "travel_dates", entity_type: "VisaApplication", evidence: { travel_start: s, travel_end: e } });
}