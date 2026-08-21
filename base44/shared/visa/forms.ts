// Worldz Visa (Phase 7) — Government Application Form Engine.
//
// Invariants (spec §§1-59):
//   - The internal application model is CANONICAL. Government forms are versioned
//     projections. We NEVER mutate canonical ApplicationAnswers to satisfy a form.
//   - Generation is DETERMINISTIC and VERSIONED (form definition + version pinned per
//     snapshot). No LLM decides field values, visibility, or validation.
//   - Missing required government field with no source → FAIL (MISSING_MAPPING /
//     MISSING_SOURCE_DATA); never fill "unknown/N/A/false" unless the form permits it.
//   - Missing internal data creates an ADDITIONAL_INFORMATION_REQUIRED question via the
//     existing Phase 6 question framework (closed loop), not a hand-coded form patch.
//   - Snapshots are IMMUTABLE: regeneration supersedes the old snapshot (STALE/SUPERSEDED),
//     never mutates it. Pinning matches DocumentVersion (Phase 4/5) semantics.
//   - Submission packages are IMMUTABLE once READY; any change creates a new version row.
//   - Phase 7 ends BEFORE any portal login/captcha/payment/automation. The provider
//     adapter contract here only exposes validate/generate/preparePackage.

import { evaluateCondition } from "./rules.ts";
import { normalizeDate, normalizeCountry } from "./intelligence.ts";
import { documentAudit } from "./documents.ts";
import { getApplication } from "./application.ts";
import { QUESTION_VERSION } from "./questions.ts";

export const PHASE7_VERSION_NOTE = "phase7";

// ---------- Canonical application model ----------
export interface CanonicalModel {
  application: Record<string, any>;
  traveler: Record<string, any>;
  passport: Record<string, any>;
  contact: Record<string, any>;
  residence: Record<string, any>;
  travel: Record<string, any>;
  employment: Record<string, any>;
  financial: Record<string, any>;
  sponsorship: Record<string, any>;
  accommodation: Record<string, any>;
  travel_history: Record<string, any>;
  visa_history: Record<string, any>;
  answers: Record<string, string>; // question_code -> normalized_value
}

function answerMap(answers: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of answers || []) if (a.active !== false) out[a.question_code] = a.normalized_value || a.value || "";
  return out;
}

export async function buildCanonicalModel(svc: any, app: any): Promise<CanonicalModel> {
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
  const A = answerMap(answers);
  const traveler: any = await svc.entities.Traveler.get(app.traveler_id).catch(() => ({}));
  const passport: any = {};
  const ads: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
  const passAd = ads.find((a) => a.status !== "detached" && a.document_type === "PASSPORT");
  if (passAd) {
    const exts: any[] = await svc.entities.DocumentExtraction.filter({ document_version_id: passAd.document_version_id }).catch(() => []);
    for (const e of exts) passport[e.field_name] = e.normalized_value || e.field_value || "";
  }
  const byQ = (code: string) => A[code] ?? "";
  return {
    application: { id: app.id, destination: app.destination, purpose: app.purpose, channel: app.channel, visa_type_key: app.visa_type_key, travel_start: app.travel_start, travel_end: app.travel_end },
    traveler,
    passport,
    contact: { email: byQ("contact.email") || traveler.email || "", phone: byQ("contact.phone") || traveler.phone || "" },
    residence: { country: byQ("residence.country") || traveler.residence_country || "", city: byQ("residence.city"), address: byQ("residence.address") },
    travel: { purpose: byQ("travel.purpose") || app.purpose, departure_date: byQ("travel.departure_date") || app.travel_start || "", return_date: byQ("travel.return_date") || app.travel_end || "", sponsor: byQ("travel.sponsor"), accommodation_type: byQ("travel.accommodation_type") },
    employment: { status: byQ("employment.status"), employer: byQ("employment.employer"), job_title: byQ("employment.job_title"), start_date: byQ("employment.start_date"), salary: byQ("employment.salary"), business_name: byQ("self_employment.business_name"), business_registration_number: byQ("self_employment.business_registration_number"), institution: byQ("education.institution"), course: byQ("education.course") },
    financial: { annual_income: byQ("financial.annual_income"), bank_statement_reference: byQ("financial.bank_statement_reference") },
    sponsorship: { sponsor_name: byQ("sponsorship.sponsor_name"), sponsor_relationship: byQ("sponsorship.sponsor_relationship"), sponsor_financial_proof_reference: byQ("sponsorship.sponsor_financial_proof_reference") },
    accommodation: { hotel_check_in: byQ("accommodation.hotel_check_in"), hotel_check_out: byQ("accommodation.hotel_check_out") },
    travel_history: { has_previous_travel: byQ("previous_visits.has_previous_travel"), countries_visited: byQ("previous_visits.countries_visited") },
    visa_history: { has_previous_visa: byQ("previous_visas.has_previous_visa"), last_visa_country: byQ("previous_visas.last_visa_country"), last_visa_date: byQ("previous_visas.last_visa_date"), has_refusal: byQ("previous_refusal.has_refusal"), refusal_country: byQ("previous_refusal.country"), refusal_date: byQ("previous_refusal.date"), refusal_reason: byQ("previous_refusal.reason") },
    answers: A,
  };
}

function sourceValue(canonical: CanonicalModel, sourceType: string, sourceField: string, config: any): any {
  if (sourceType === "CONSTANT") return config?.value ?? "";
  if (sourceType === "QUESTION") return canonical.answers[sourceField] ?? "";
  if (sourceType === "APPLICATION") return (canonical.application as any)[sourceField] ?? "";
  if (sourceType === "TRAVELER") return (canonical.traveler as any)[sourceField] ?? "";
  if (sourceType === "PASSPORT") return (canonical.passport as any)[sourceField] ?? "";
  if (sourceType === "DOCUMENT") return canonical.answers[sourceField] ?? "";
  return "";
}

// ---------- Country code mapper (deterministic) ----------
const COUNTRY_ALPHA3: Record<string, string> = { IN: "IND", FR: "FRA", JP: "JPN", US: "USA", GB: "GBR", DE: "DEU", CN: "CHN", AE: "ARE", SG: "SGP", AU: "AUS", CA: "CAN" };
const COUNTRY_NAME: Record<string, string> = { IN: "India", FR: "France", JP: "Japan", US: "United States", GB: "United Kingdom", DE: "Germany", CN: "China", AE: "United Arab Emirates", SG: "Singapore", AU: "Australia", CA: "Canada" };
export function mapCountry(code: string, to: "alpha2" | "alpha3" | "name" = "alpha3"): string {
  const c = normalizeCountry(code).toUpperCase();
  if (to === "alpha2") return c;
  if (to === "alpha3") return COUNTRY_ALPHA3[c] || c;
  return COUNTRY_NAME[c] || c;
}

// ---------- Transformation engine ----------
export type Transformation = "DIRECT" | "RENAME" | "ENUM_MAP" | "DATE_FORMAT" | "COUNTRY_CODE" | "CURRENCY" | "BOOLEAN" | "CONCAT" | "SPLIT" | "NORMALIZE" | "LOOKUP" | "CONDITIONAL";

const DATE_FMT: Record<string, (iso: string) => string> = {
  "DD/MM/YYYY": (iso) => fmt(iso, "DD/MM/YYYY"),
  "DD-MM-YYYY": (iso) => fmt(iso, "DD-MM-YYYY"),
  "YYYY-MM-DD": (iso) => fmt(iso, "YYYY-MM-DD"),
  "MM/DD/YYYY": (iso) => fmt(iso, "MM/DD/YYYY"),
};
function fmt(iso: string, pattern: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), yyyy = String(d.getUTCFullYear());
  return pattern.replace("YYYY", yyyy).replace("MM", mm).replace("DD", dd);
}

export interface TransformResult { value: any; ok: boolean; error?: string; }
export function applyTransformation(t: Transformation, raw: any, config: any, canonical: CanonicalModel): TransformResult {
  if (raw == null || raw === "") return { value: "", ok: true };
  switch (t) {
    case "DIRECT":
    case "RENAME":
      return { value: String(raw), ok: true };
    case "ENUM_MAP": {
      const map = config?.map || {};
      const k = String(raw);
      if (k in map) return { value: map[k], ok: true };
      return { value: "", ok: false, error: "MISSING_MAPPING" };
    }
    case "DATE_FORMAT": {
      const pattern = config?.format || "YYYY-MM-DD";
      const iso = normalizeDate(raw);
      if (!iso) return { value: "", ok: false, error: "INVALID_DATE" };
      return { value: (DATE_FMT[pattern] || ((s: string) => s))(iso), ok: true };
    }
    case "COUNTRY_CODE":
      return { value: mapCountry(String(raw), (config?.to as any) || "alpha3"), ok: true };
    case "CURRENCY": {
      const amount = String(raw).replace(/[^0-9.,]/g, "").replace(/,/g, "");
      const currency = config?.currency || "INR";
      return { value: `${amount} ${currency}`, ok: true };
    }
    case "BOOLEAN": {
      const truthy = raw === true || String(raw).toLowerCase() === "true" || String(raw) === "1" || String(raw).toLowerCase() === "yes";
      const map = config?.map || { true: "Yes", false: "No" };
      return { value: map[String(truthy)], ok: true };
    }
    case "CONCAT": {
      const fields: string[] = config?.fields || [];
      const sep = config?.separator || " ";
      const vals = fields.map((f: string) => sourceValue(canonical, config?.source_type || "QUESTION", f, config)).filter((v) => v !== "" && v != null);
      return { value: vals.join(sep), ok: true };
    }
    case "SPLIT": {
      const sep = config?.separator || " ";
      const idx = Number(config?.index ?? 0);
      const parts = String(raw).split(sep);
      return { value: parts[idx] ?? "", ok: true };
    }
    case "NORMALIZE": {
      let v = String(raw).trim();
      if (config?.case === "upper") v = v.toUpperCase();
      else if (config?.case === "lower") v = v.toLowerCase();
      return { value: v, ok: true };
    }
    case "LOOKUP": {
      const table = config?.table || {};
      const k = String(raw);
      return { value: table[k] ?? "", ok: true };
    }
    case "CONDITIONAL": {
      const conditions: any[] = config?.conditions || [];
      for (const c of conditions) {
        const fact = sourceValue(canonical, c.source_type || "QUESTION", c.field, c);
        if (matchesCondition(fact, c.operator || "eq", c.value)) {
          if (c.transformation) return applyTransformation(c.transformation, raw, c.config, canonical);
          return { value: c.value ?? "", ok: true };
        }
      }
      return { value: "", ok: true };
    }
    default:
      return { value: String(raw), ok: true };
  }
}

function matchesCondition(fact: any, op: string, value: any): boolean {
  if (op === "eq") return String(fact) === String(value);
  if (op === "neq") return String(fact) !== String(value);
  if (op === "in") return Array.isArray(value) && value.map(String).includes(String(fact));
  if (op === "exists") return fact != null && fact !== "";
  return false;
}

// ---------- Form validation (Layer 3) ----------
export interface ValidationError { field: string; code: string; message: string; }
export function validateGovernmentForm(fields: Record<string, any>, fieldDefs: any[]): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  for (const f of fieldDefs) {
    if (f.status === "archived") continue;
    const v = fields[f.field_code];
    if (f.required && (v == null || v === "")) { errors.push({ field: f.field_code, code: "REQUIRED", message: `${f.label} is required` }); continue; }
    if (v == null || v === "") continue;
    if (f.type === "COUNTRY" && String(v).length < 2) errors.push({ field: f.field_code, code: "INVALID_COUNTRY", message: "Invalid country code" });
    if (f.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) errors.push({ field: f.field_code, code: "INVALID_EMAIL", message: "Invalid email" });
    if (f.type === "DATE" && Number.isNaN(new Date(String(v)).getTime())) errors.push({ field: f.field_code, code: "INVALID_DATE", message: "Invalid date" });
    if (f.type === "SELECT" && f.options?.length && !f.options.some((o: any) => o.value === v)) errors.push({ field: f.field_code, code: "INVALID_OPTION", message: "Invalid option" });
    const rule = f.validation || {};
    if (rule.min_length && String(v).length < rule.min_length) errors.push({ field: f.field_code, code: "MIN_LENGTH", message: `Minimum ${rule.min_length} characters` });
    if (rule.max_length && String(v).length > rule.max_length) errors.push({ field: f.field_code, code: "MAX_LENGTH", message: `Maximum ${rule.max_length} characters` });
    if (rule.pattern && !new RegExp(rule.pattern).test(String(v))) errors.push({ field: f.field_code, code: "PATTERN", message: "Invalid format" });
  }
  return { valid: errors.length === 0, errors };
}

// ---------- Hash ----------
async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Missing-field feedback loop (Section 24/25) ----------
async function ensureFeedbackQuestion(svc: any, app: any, field: any): Promise<any | null> {
  const code = `form.${field.field_code}`;
  const version = app.question_version || QUESTION_VERSION;
  const existing: any[] = await svc.entities.ApplicationQuestionDefinition.filter({ question_code: code, version }).catch(() => []);
  if (existing && existing.length) return existing[0];
  const row = {
    question_code: code, label: field.label, description: `Required by government form field: ${field.field_code}`,
    type: mapFormatTypeToQuestionType(field.type), section: "ADDITIONAL_INFORMATION", required: true, order: 1000 + (field.order || 0),
    data_source: null, visibility_rule: null, validation_rule: field.validation || null, options: field.options || [],
    applies_to_purposes: [], applies_to_destinations: [],
    source: "GOVERNMENT_FORM", source_reference: field.field_code, version, status: "active",
  };
  return await svc.entities.ApplicationQuestionDefinition.create(row).catch(() => null);
}
function mapFormatTypeToQuestionType(t: string): string {
  return ({ TEXT: "TEXT", NUMBER: "NUMBER", DATE: "DATE", BOOLEAN: "BOOLEAN", SELECT: "SELECT", MULTI_SELECT: "MULTI_SELECT", COUNTRY: "COUNTRY", CURRENCY: "CURRENCY", PHONE: "PHONE", EMAIL: "EMAIL", ADDRESS: "ADDRESS", DOCUMENT: "DOCUMENT_REFERENCE" } as any)[t] || "TEXT";
}

// ---------- Form generation ----------
export interface GenerationResult {
  ok: boolean; form_definition_id: string; form_code: string; form_version: string;
  fields: Record<string, any>; trace: any[]; missing: any[];
  validation: { valid: boolean; errors: ValidationError[] };
  snapshot: any | null; errors: string[];
}

export async function generateGovernmentForm(svc: any, user: any, application_id: string, form_definition_id: string, opts: { createSnapshot?: boolean } = {}): Promise<GenerationResult> {
  const app = await getApplication(svc, user, application_id);
  const form: any = await svc.entities.GovernmentFormDefinition.get(form_definition_id).catch(() => null);
  if (!form) throw Object.assign(new Error("Form definition not found"), { code: "NOT_FOUND" });
  if (form.status !== "published") throw Object.assign(new Error(`Form not published (status=${form.status})`), { code: "FORM_NOT_PUBLISHED" });
  const fields: any[] = await svc.entities.GovernmentFormField.filter({ form_definition_id }).catch(() => []);
  const mappings: any[] = await svc.entities.GovernmentFieldMapping.filter({ form_definition_id, status: "active" }).catch(() => []);
  const mappingByField: Record<string, any> = {};
  for (const m of mappings) mappingByField[m.field_code] = m;
  const overrides: any[] = await svc.entities.GovernmentFieldOverride.filter({ application_id: app.id, form_definition_id, superseded: false }).catch(() => []);
  const overrideByField: Record<string, any> = {};
  for (const o of overrides) overrideByField[o.field_code] = o;

  const canonical = await buildCanonicalModel(svc, app);
  const facts = { ...canonical.answers, "travel.departure_date": canonical.travel.departure_date, "travel.return_date": canonical.travel.return_date, "travel.purpose": canonical.travel.purpose };

  const generated: Record<string, any> = {};
  const trace: any[] = [];
  const missing: any[] = [];
  const errors: string[] = [];

  for (const f of fields.sort((a, b) => (a.order || 100) - (b.order || 100))) {
    if (f.status === "archived") continue;
    const visible = evaluateCondition(f.visibility_rule || null, facts);
    if (!visible) continue;
    const m = mappingByField[f.field_code];
    if (!m) { missing.push({ field: f.field_code, kind: "MISSING_MAPPING" }); errors.push(`MISSING_MAPPING:${f.field_code}`); continue; }
    let raw = sourceValue(canonical, m.source_type, m.source_field, m.config);
    if ((raw == null || raw === "") && m.fallback) raw = m.fallback;
    const tr = applyTransformation(m.transformation as Transformation, raw, m.config, canonical);
    if (!tr.ok && tr.error === "MISSING_MAPPING") { missing.push({ field: f.field_code, kind: "ENUM_MISS", value: raw }); errors.push(`ENUM_MISS:${f.field_code}`); continue; }
    let value = tr.value ?? "";
    const override = overrideByField[f.field_code];
    if (override) value = override.value;
    if ((value == null || value === "") && f.required) {
      missing.push({ field: f.field_code, kind: "MISSING_SOURCE_DATA", source_type: m.source_type, source_field: m.source_field });
      await ensureFeedbackQuestion(svc, app, f).catch(() => null);
      continue;
    }
    generated[f.field_code] = value;
    trace.push({ government_field: f.field_code, value, source: `${m.source_type}:${m.source_field}`, transformation: m.transformation, source_field: m.source_field, overridden: !!override });
  }

  const validation = validateGovernmentForm(generated, fields);
  const ok = missing.length === 0 && validation.valid && errors.length === 0;
  let snapshot: any | null = null;
  if (ok && (opts.createSnapshot !== false)) snapshot = await createSnapshot(svc, user, app, form, generated, trace, validation, missing, canonical);

  await documentAudit(svc, user, { action: "form.generated", entity_type: "VisaApplication", entity_id: app.id, application_id: app.id, detail: { form_definition_id, form_code: form.form_code, ok, missing_count: missing.length, validation_valid: validation.valid } }).catch(() => {});
  return { ok, form_definition_id: form.id, form_code: form.form_code, form_version: form.version, fields: generated, trace, missing, validation, snapshot, errors };
}

async function createSnapshot(svc: any, user: any, app: any, form: any, fields: Record<string, any>, trace: any[], validation: any, missing: any[], canonical: CanonicalModel): Promise<any> {
  const dep: Record<string, any> = {};
  for (const t of trace) {
    const sources: string[] = [];
    if ((t.source || "").startsWith("QUESTION:")) sources.push(t.source.split(":")[1]);
    if (t.transformation === "CONCAT" && Array.isArray(t.config?.fields)) sources.push(...t.config.fields);
    const values = sources.map((s) => canonical.answers[s] || "").join("|");
    dep[t.government_field] = { sources, hash: await sha256(values) };
  }
  const data_hash = await sha256(JSON.stringify({ form_version: form.version, fields, trace, missing: [] }));
  const prev: any[] = await svc.entities.ApplicationFormSnapshot.filter({ application_id: app.id, form_definition_id: form.id, status: "fresh" }).catch(() => []);
  for (const p of prev) await svc.entities.ApplicationFormSnapshot.update(p.id, { status: "superseded" }).catch(() => {});
  const row = await svc.entities.ApplicationFormSnapshot.create({
    application_id: app.id, traveler_id: app.traveler_id, form_definition_id: form.id, form_code: form.form_code, form_version: form.version,
    generated_at: new Date().toISOString(), data_hash, dependency_fingerprint: dep, fields, trace, validation, missing, status: "fresh",
  }).catch(() => null);
  await documentAudit(svc, user, { action: "form.snapshot_created", entity_type: "ApplicationFormSnapshot", entity_id: row?.id || "(new)", application_id: app.id, detail: { form_code: form.form_code, form_version: form.version, data_hash } }).catch(() => {});
  return row;
}

// ---------- Staleness (Section 41-43) ----------
export async function checkSnapshotStaleness(svc: any, app: any, snapshot: any): Promise<{ stale: boolean; changed_fields: string[] }> {
  if (!snapshot) return { stale: false, changed_fields: [] };
  const canonical = await buildCanonicalModel(svc, app);
  const changed: string[] = [];
  for (const [field, dep] of Object.entries(snapshot.dependency_fingerprint || {})) {
    const drow = dep as any;
    const values = (drow.sources || []).map((s: string) => canonical.answers[s] || "").join("|");
    const cur = await sha256(values);
    if (cur !== drow.hash) changed.push(field);
  }
  const stale = changed.length > 0;
  if (stale && snapshot.status === "fresh") await svc.entities.ApplicationFormSnapshot.update(snapshot.id, { status: "stale" }).catch(() => {});
  if (stale) await documentAudit(svc, { id: "system" } as any, { action: "form.snapshot_invalidated", entity_type: "ApplicationFormSnapshot", entity_id: snapshot.id, application_id: app.id, detail: { changed_fields: changed } }).catch(() => {});
  return { stale, changed_fields: changed };
}

export async function getLatestSnapshot(svc: any, app: any, form_definition_id: string): Promise<any | null> {
  const rows: any[] = await svc.entities.ApplicationFormSnapshot.filter({ application_id: app.id, form_definition_id }).catch(() => []);
  if (!rows.length) return null;
  rows.sort((a, b) => String(b.generated_at || "").localeCompare(String(a.generated_at || "")));
  return rows.find((r) => r.status === "fresh") || rows[0];
}

// ---------- Submission package (Section 28-31) ----------
export async function buildSubmissionPackage(svc: any, user: any, application_id: string, form_definition_id: string): Promise<{ package: any; items: any[]; errors: string[] }> {
  const app = await getApplication(svc, user, application_id);
  let snapshot = await getLatestSnapshot(svc, app, form_definition_id);
  if (!snapshot || snapshot.status !== "fresh") {
    const gen = await generateGovernmentForm(svc, user, application_id, form_definition_id);
    if (!gen.ok) return { package: null, items: [], errors: ["FORM_NOT_GENERATABLE", ...gen.errors] };
    snapshot = await getLatestSnapshot(svc, app, form_definition_id);
    if (!snapshot) return { package: null, items: [], errors: ["SNAPSHOT_MISSING"] };
  }
  const { checkApplicationReadiness } = await import("./questions.ts");
  const readiness = await checkApplicationReadiness(svc, app);
  const errors: string[] = [];
  if (!readiness.ready) errors.push("APPLICATION_NOT_READY");
  if (!snapshot.validation?.valid) errors.push("FORM_VALIDATION_FAILED");
  const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
  const items: any[] = [];
  for (const a of attachments) {
    if (a.status === "detached") continue;
    const intel: any = (await svc.entities.DocumentIntelligence.filter({ document_version_id: a.document_version_id }).catch(() => []))[0] || null;
    if (intel?.status !== "ready") errors.push(`DOCUMENT_NOT_VERIFIED:${a.document_type}`);
    items.push({ package_id: null, application_id: app.id, type: a.document_type === "PHOTO" ? "PHOTO" : "DOCUMENT", form_snapshot_id: null, document_id: a.document_id, document_version_id: a.document_version_id, document_type: a.document_type, label: a.metadata?.display_name || a.document_type, metadata: { is_required: a.is_required } });
  }
  items.unshift({ package_id: null, application_id: app.id, type: "FORM", form_snapshot_id: snapshot.id, document_id: null, document_version_id: null, document_type: null, label: `${snapshot.form_code} v${snapshot.form_version}`, metadata: { data_hash: snapshot.data_hash } });

  const loadable = errors.length === 0;
  const pkgVersion = (await svc.entities.SubmissionPackage.filter({ application_id: app.id, form_snapshot_id: snapshot.id }).catch(() => [])).length + 1;
  const package_hash = await sha256(JSON.stringify({ form_version: snapshot.form_version, form_data_hash: snapshot.data_hash, document_version_ids: items.filter((i) => i.document_version_id).map((i) => i.document_version_id), version: pkgVersion }));
  const status = loadable ? "ready" : "draft";
  const pkg = await svc.entities.SubmissionPackage.create({
    application_id: app.id, traveler_id: app.traveler_id, form_snapshot_id: snapshot.id, form_code: snapshot.form_code, form_version: snapshot.form_version,
    version: pkgVersion, status, package_hash, items_summary: { form: 1, documents: items.filter((i) => i.type !== "FORM").length }, metadata: { readiness: readiness.ready, errors },
  }).catch(() => null);
  if (pkg) for (const it of items) it.package_id = pkg.id;
  const created = [];
  for (const it of items) { const r = await svc.entities.SubmissionPackageItem.create(it).catch(() => null); if (r) created.push(r); }
  await documentAudit(svc, user, { action: "submission_package.created", entity_type: "SubmissionPackage", entity_id: pkg?.id || "(new)", application_id: app.id, detail: { status, package_hash, item_count: created.length } }).catch(() => {});
  return { package: pkg, items: created, errors };
}

export async function listSubmissionPackages(svc: any, user: any, application_id: string): Promise<any> {
  const app = await getApplication(svc, user, application_id);
  const packages: any[] = await svc.entities.SubmissionPackage.filter({ application_id: app.id }).catch(() => []);
  const out: any[] = [];
  for (const p of packages) {
    const items: any[] = await svc.entities.SubmissionPackageItem.filter({ package_id: p.id }).catch(() => []);
    out.push({ ...p, items });
  }
  return out;
}

export async function getOrphanedPackages(svc: any, app: any): Promise<any[]> {
  return await svc.entities.SubmissionPackage.filter({ application_id: app.id, status: { $in: ["draft", "validated", "ready"] } }).catch(() => []);
}

// ---------- Provider adapter contract (Section 37) ----------
export interface GovernmentFormProvider { validate(args: any): Promise<any>; generate(args: any): Promise<any>; preparePackage(args: any): Promise<any>; }
export const GovernmentFormService: GovernmentFormProvider = {
  validate: async (args) => validateGovernmentForm(args.fields, args.fieldDefs),
  generate: async (args) => args,
  preparePackage: async (args) => args,
};

// ---------- Dev fixtures (Section 48) ----------
export const FORM_FIXTURES: any[] = [
  {
    definition: { form_code: "FRANCE_SCHENGEN_SHORT_STAY", form_name: "France Schengen Short Stay (tourism)", country: "FR", visa_type_key: "FR-tourism", purpose: "tourism", provider: "government", version: "v1", status: "published", effective_from: "2026-01-01", source: { source_type: "dev_seed", source_name: "Worldz Visa dev fixture" }, metadata: { unverified: true } },
    fields: [
      { field_code: "applicant.surname", label: "Surname", type: "TEXT", required: true, section: "applicant", order: 10 },
      { field_code: "applicant.given_names", label: "Given names", type: "TEXT", required: true, section: "applicant", order: 20 },
      { field_code: "applicant.date_of_birth", label: "Date of birth", type: "DATE", required: true, section: "applicant", order: 30, validation: { pattern: "^[0-9]{2}/[0-9]{2}/[0-9]{4}$" } },
      { field_code: "applicant.nationality", label: "Nationality", type: "COUNTRY", required: true, section: "applicant", order: 40 },
      { field_code: "applicant.passport_number", label: "Passport number", type: "TEXT", required: true, section: "travel_document", order: 10 },
      { field_code: "applicant.passport_expiry", label: "Passport expiry date", type: "DATE", required: true, section: "travel_document", order: 20 },
      { field_code: "travel.arrival_date", label: "Date of arrival", type: "DATE", required: true, section: "travel", order: 10 },
      { field_code: "travel.departure_date", label: "Date of departure", type: "DATE", required: true, section: "travel", order: 20 },
      { field_code: "financial.means_of_support", label: "Means of support", type: "SELECT", required: true, section: "financial", order: 10, options: [{ value: "PERSONAL_FUNDS", label: "Personal funds" }, { value: "EMPLOYER", label: "Employer" }, { value: "FAMILY_SUPPORT", label: "Family support" }] },
      { field_code: "contact.email", label: "Email", type: "EMAIL", required: true, section: "contact", order: 10 },
      { field_code: "residence.country", label: "Country of residence", type: "COUNTRY", required: true, section: "residence", order: 10 },
      { field_code: "refusal.has_refusal", label: "Have you ever been refused a visa?", type: "BOOLEAN", required: true, section: "visa_history", order: 10 },
      { field_code: "refusal.country", label: "Country that refused the visa", type: "COUNTRY", required: false, section: "visa_history", order: 20, visibility_rule: { field: "refusal.has_refusal", operator: "eq", value: "Yes" } },
      { field_code: "refusal.date", label: "Date of refusal", type: "DATE", required: false, section: "visa_history", order: 30, visibility_rule: { field: "refusal.has_refusal", operator: "eq", value: "Yes" } },
    ],
    mappings: [
      { field_code: "applicant.surname", source_type: "QUESTION", source_field: "personal.surname", transformation: "DIRECT" },
      { field_code: "applicant.given_names", source_type: "QUESTION", source_field: "personal.given_names", transformation: "DIRECT" },
      { field_code: "applicant.date_of_birth", source_type: "QUESTION", source_field: "personal.date_of_birth", transformation: "DATE_FORMAT", config: { format: "DD/MM/YYYY" } },
      { field_code: "applicant.nationality", source_type: "QUESTION", source_field: "personal.nationality", transformation: "COUNTRY_CODE", config: { to: "alpha3" } },
      { field_code: "applicant.passport_number", source_type: "QUESTION", source_field: "passport.passport_number", transformation: "DIRECT" },
      { field_code: "applicant.passport_expiry", source_type: "QUESTION", source_field: "passport.expiry_date", transformation: "DATE_FORMAT", config: { format: "DD/MM/YYYY" } },
      { field_code: "travel.arrival_date", source_type: "QUESTION", source_field: "travel.departure_date", transformation: "DATE_FORMAT", config: { format: "DD/MM/YYYY" } },
      { field_code: "travel.departure_date", source_type: "QUESTION", source_field: "travel.return_date", transformation: "DATE_FORMAT", config: { format: "DD/MM/YYYY" } },
      { field_code: "financial.means_of_support", source_type: "QUESTION", source_field: "travel.sponsor", transformation: "ENUM_MAP", config: { map: { SELF: "PERSONAL_FUNDS", EMPLOYER: "EMPLOYER", FAMILY: "FAMILY_SUPPORT", OTHER: "" } } },
      { field_code: "contact.email", source_type: "QUESTION", source_field: "contact.email", transformation: "DIRECT" },
      { field_code: "residence.country", source_type: "QUESTION", source_field: "residence.country", transformation: "COUNTRY_CODE", config: { to: "alpha3" } },
      { field_code: "refusal.has_refusal", source_type: "QUESTION", source_field: "previous_refusal.has_refusal", transformation: "BOOLEAN", config: { map: { true: "Yes", false: "No" } } },
      { field_code: "refusal.country", source_type: "QUESTION", source_field: "previous_refusal.country", transformation: "COUNTRY_CODE", config: { to: "alpha3" } },
      { field_code: "refusal.date", source_type: "QUESTION", source_field: "previous_refusal.date", transformation: "DATE_FORMAT", config: { format: "DD/MM/YYYY" } },
    ],
  },
  {
    definition: { form_code: "FRANCE_SCHENGEN_BUSINESS", form_name: "France Schengen Short Stay (business)", country: "FR", visa_type_key: "FR-business", purpose: "business", provider: "government", version: "v1", status: "published", effective_from: "2026-01-01", source: { source_type: "dev_seed", source_name: "Worldz Visa dev fixture" }, metadata: { unverified: true } },
    fields: [
      { field_code: "applicant.surname", label: "Surname", type: "TEXT", required: true, section: "applicant", order: 10 },
      { field_code: "applicant.given_names", label: "Given names", type: "TEXT", required: true, section: "applicant", order: 20 },
      { field_code: "applicant.nationality", label: "Nationality", type: "COUNTRY", required: true, section: "applicant", order: 40 },
      { field_code: "invitation.inviting_company", label: "Inviting organization", type: "TEXT", required: true, section: "invitation", order: 10 },
      { field_code: "financial.means_of_support", label: "Means of support", type: "SELECT", required: true, section: "financial", order: 10, options: [{ value: "PERSONAL_FUNDS", label: "Personal funds" }, { value: "EMPLOYER", label: "Employer" }] },
      { field_code: "travel.arrival_date", label: "Date of arrival", type: "DATE", required: true, section: "travel", order: 10 },
    ],
    mappings: [
      { field_code: "applicant.surname", source_type: "QUESTION", source_field: "personal.surname", transformation: "DIRECT" },
      { field_code: "applicant.given_names", source_type: "QUESTION", source_field: "personal.given_names", transformation: "DIRECT" },
      { field_code: "applicant.nationality", source_type: "QUESTION", source_field: "personal.nationality", transformation: "COUNTRY_CODE", config: { to: "alpha3" } },
      { field_code: "invitation.inviting_company", source_type: "QUESTION", source_field: "invitation.inviting_company", transformation: "DIRECT" },
      { field_code: "financial.means_of_support", source_type: "QUESTION", source_field: "travel.sponsor", transformation: "ENUM_MAP", config: { map: { SELF: "PERSONAL_FUNDS", EMPLOYER: "EMPLOYER", FAMILY: "", OTHER: "" } } },
      { field_code: "travel.arrival_date", source_type: "QUESTION", source_field: "travel.departure_date", transformation: "DATE_FORMAT", config: { format: "DD/MM/YYYY" } },
    ],
  },
  {
    definition: { form_code: "JAPAN_EVISA", form_name: "Japan eVisa (tourism)", country: "JP", visa_type_key: "JP-tourism", purpose: "tourism", provider: "government", version: "v1", status: "published", effective_from: "2026-01-01", source: { source_type: "dev_seed", source_name: "Worldz Visa dev fixture" }, metadata: { unverified: true } },
    fields: [
      { field_code: "app.family_name", label: "Family name", type: "TEXT", required: true, section: "applicant", order: 10 },
      { field_code: "app.given_name", label: "Given name", type: "TEXT", required: true, section: "applicant", order: 20 },
      { field_code: "app.birth_date", label: "Date of birth (YYYY-MM-DD)", type: "DATE", required: true, section: "applicant", order: 30, validation: { pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" } },
      { field_code: "app.nationality", label: "Nationality (ISO alpha-3)", type: "COUNTRY", required: true, section: "applicant", order: 40 },
      { field_code: "passport.number", label: "Passport number", type: "TEXT", required: true, section: "passport", order: 10 },
      { field_code: "passport.expiry", label: "Passport expiry (YYYY-MM-DD)", type: "DATE", required: true, section: "passport", order: 20 },
      { field_code: "stay.intended_date_of_entry", label: "Intended date of entry", type: "DATE", required: true, section: "stay", order: 10 },
      { field_code: "stay.intended_date_of_departure", label: "Intended date of departure", type: "DATE", required: true, section: "stay", order: 20 },
      { field_code: "fund.type", label: "Means to defray expenses", type: "SELECT", required: true, section: "financial", order: 10, options: [{ value: "APPLICANT", label: "By applicant" }, { value: "OTHERS", label: "By others" }] },
    ],
    mappings: [
      { field_code: "app.family_name", source_type: "QUESTION", source_field: "personal.surname", transformation: "DIRECT" },
      { field_code: "app.given_name", source_type: "QUESTION", source_field: "personal.given_names", transformation: "DIRECT" },
      { field_code: "app.birth_date", source_type: "QUESTION", source_field: "personal.date_of_birth", transformation: "DATE_FORMAT", config: { format: "YYYY-MM-DD" } },
      { field_code: "app.nationality", source_type: "QUESTION", source_field: "personal.nationality", transformation: "COUNTRY_CODE", config: { to: "alpha3" } },
      { field_code: "passport.number", source_type: "QUESTION", source_field: "passport.passport_number", transformation: "DIRECT" },
      { field_code: "passport.expiry", source_type: "QUESTION", source_field: "passport.expiry_date", transformation: "DATE_FORMAT", config: { format: "YYYY-MM-DD" } },
      { field_code: "stay.intended_date_of_entry", source_type: "QUESTION", source_field: "travel.departure_date", transformation: "DATE_FORMAT", config: { format: "YYYY-MM-DD" } },
      { field_code: "stay.intended_date_of_departure", source_type: "QUESTION", source_field: "travel.return_date", transformation: "DATE_FORMAT", config: { format: "YYYY-MM-DD" } },
      { field_code: "fund.type", source_type: "CONSTANT", source_field: "", transformation: "DIRECT", config: { value: "APPLICANT" } },
    ],
  },
];

// ---------- Catalog seed (idempotent upsert by form_code + version) ----------
export async function ensureFormCatalog(svc: any): Promise<{ forms: number; fields: number; mappings: number }> {
  let forms = 0, fieldsCount = 0, mappingsCount = 0;
  for (const fx of FORM_FIXTURES) {
    const d = fx.definition;
    let def: any = (await svc.entities.GovernmentFormDefinition.filter({ form_code: d.form_code, version: d.version }).catch(() => []))[0];
    if (!def) def = await svc.entities.GovernmentFormDefinition.create(d).catch(() => null);
    else def = await svc.entities.GovernmentFormDefinition.update(def.id, d).catch(() => def);
    if (!def) continue;
    forms++;
    const existingFields: any[] = await svc.entities.GovernmentFormField.filter({ form_definition_id: def.id }).catch(() => []);
    const byCode: Record<string, any> = {};
    for (const e of existingFields) byCode[e.field_code] = e;
    for (const f of fx.fields as any[]) {
      const fr = { ...f, form_definition_id: def.id };
      if (byCode[f.field_code]) await svc.entities.GovernmentFormField.update(byCode[f.field_code].id, fr).catch(() => {});
      else await svc.entities.GovernmentFormField.create(fr).catch(() => {});
      fieldsCount++;
    }
    const existingMaps: any[] = await svc.entities.GovernmentFieldMapping.filter({ form_definition_id: def.id, status: "active" }).catch(() => []);
    const mapByField: Record<string, any> = {};
    for (const e of existingMaps) mapByField[e.field_code] = e;
    for (const m of fx.mappings as any[]) {
      const mr = { ...m, form_definition_id: def.id, status: "active" };
      if (mapByField[m.field_code]) await svc.entities.GovernmentFieldMapping.update(mapByField[m.field_code].id, mr).catch(() => {});
      else await svc.entities.GovernmentFieldMapping.create(mr).catch(() => {});
      mappingsCount++;
    }
  }
  return { forms, fields: fieldsCount, mappings: mappingsCount };
}

// ---------- Form listing + resolution helpers ----------
export async function listFormDefinitions(svc: any, filter: { country?: string; visa_type_key?: string; purpose?: string; status?: string } = {}): Promise<any[]> {
  const q: any = { status: filter.status || "published" };
  if (filter.country) q.country = filter.country.toUpperCase();
  if (filter.visa_type_key) q.visa_type_key = filter.visa_type_key;
  if (filter.purpose) q.purpose = filter.purpose;
  return await svc.entities.GovernmentFormDefinition.filter(q).catch(() => []);
}

export async function resolveFormForApplication(svc: any, app: any): Promise<any | null> {
  await ensureFormCatalog(svc).catch(() => {});
  const list = await listFormDefinitions(svc, { country: app.destination, visa_type_key: app.visa_type_key, purpose: app.purpose, status: "published" });
  if (list.length) return list[0];
  return (await listFormDefinitions(svc, { country: app.destination, purpose: app.purpose, status: "published" }))[0] || null;
}

export async function getFormFields(svc: any, form_definition_id: string): Promise<any[]> {
  return await svc.entities.GovernmentFormField.filter({ form_definition_id }).catch(() => []);
}
export async function getFormMappings(svc: any, form_definition_id: string): Promise<any[]> {
  return await svc.entities.GovernmentFieldMapping.filter({ form_definition_id, status: "active" }).catch(() => []);
}

// ---------- Publish validation (Section 45) ----------
export async function validateFormForPublish(svc: any, form_definition_id: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const fields: any[] = await svc.entities.GovernmentFormField.filter({ form_definition_id }).catch(() => []);
  const mappings: any[] = await svc.entities.GovernmentFieldMapping.filter({ form_definition_id, status: "active" }).catch(() => []);
  const codes = fields.map((f) => f.field_code);
  const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dup.length) errors.push("DUPLICATE_FIELD_CODES:" + dup.join(","));
  for (const f of fields) {
    if (f.required) {
      const hasMap = mappings.some((m) => m.field_code === f.field_code);
      if (!hasMap) errors.push("MISSING_REQUIRED_MAPPING:" + f.field_code);
    }
    const validTrans = ["DIRECT", "RENAME", "ENUM_MAP", "DATE_FORMAT", "COUNTRY_CODE", "CURRENCY", "BOOLEAN", "CONCAT", "SPLIT", "NORMALIZE", "LOOKUP", "CONDITIONAL"];
    const m = mappings.find((mm) => mm.field_code === f.field_code);
    if (m && !validTrans.includes(m.transformation)) errors.push("INVALID_TRANSFORMATION:" + f.field_code);
    if (m && m.transformation === "ENUM_MAP" && (!m.config?.map || typeof m.config.map !== "object")) errors.push("INVALID_ENUM_MAP:" + f.field_code);
  }
  const form: any = await svc.entities.GovernmentFormDefinition.get(form_definition_id).catch(() => null);
  if (form) {
    const same: any[] = await svc.entities.GovernmentFormDefinition.filter({ form_code: form.form_code, status: "published" }).catch(() => []);
    for (const s of same) if (s.id !== form.id && s.version === form.version) errors.push("OVERLAPPING_VERSION:" + form.version);
  }
  return { valid: errors.length === 0, errors };
}

// ---------- Export (Section 36) ----------
export function exportSnapshot(snapshot: any, format: "json" | "csv" = "json"): any {
  if (format === "csv") {
    const rows = [["field_code", "value", "source", "transformation"]];
    for (const t of snapshot.trace || []) rows.push([t.government_field, t.value, t.source, t.transformation]);
    return rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  }
  return { form_code: snapshot.form_code, form_version: snapshot.form_version, data_hash: snapshot.data_hash, fields: snapshot.fields, trace: snapshot.trace, validation: snapshot.validation };
}