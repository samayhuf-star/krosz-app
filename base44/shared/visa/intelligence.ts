// Worldz Visa (Phase 5) — Document Intelligence Engine.
// Pipeline: UPLOADED → CLASSIFYING → EXTRACTING → VALIDATING → READY | NEEDS_REVIEW | PROCESSING_FAILED
//
// Invariants (see spec §§36-37):
//   - AI EXTRACTS, deterministic validators DECIDE. LLM never decides visa rules or
//     final validity.
//   - Deterministic sources always preferred: MRZ > structured > OCR > LLM > heuristic.
//   - All extractions are versioned (extractor_version + schema_version + model).
//   - Raw OCR / full document text is never stored — only the structured fields needed.
//   - Private file contents are accessed only via short-lived signed URLs created
//     on demand; the signed URL is never persisted.

import { parseMrz, looksLikeMrz, type MrzParseResult } from "./mrz.ts";
import { assertOwner, documentAudit, expiryStatus, documentTypeByKey } from "./documents.ts";

export const INTELLIGENCE_VERSION = "v1";
export const SCHEMA_VERSION = "v1";
export const CLASSIFICATION_VERSION = "v1";
// Confidence below this → NEEDS_REVIEW (configurable, kept as a named constant).
const CLASSIFY_MIN_CONFIDENCE = 0.7;
const EXTRACTION_MIN_CONFIDENCE = 0.6;

export type IntelStatus = "uploaded" | "classifying" | "extracting" | "validating" | "ready" | "needs_review" | "processing_failed";

export type Source = "mrz" | "structured" | "ocr" | "llm" | "heuristic" | "metadata";
export interface ExtractionDef { document_type: string; fields: { name: string; type: "string" | "date" | "number" | "country"; required?: boolean }[]; }

// ---------- TYPE-SPECIFIC EXTRACTION SCHEMAS (versioned) ----------
export const EXTRACTION_SCHEMAS: Record<string, ExtractionDef> = {
  PASSPORT: { document_type: "PASSPORT", fields: [
    { name: "mrz", type: "string" }, { name: "mrz_line_1", type: "string" }, { name: "mrz_line_2", type: "string" }, { name: "surname", type: "string", required: true }, { name: "given_names", type: "string", required: true },
    { name: "passport_number", type: "string", required: true }, { name: "nationality", type: "country", required: true },
    { name: "date_of_birth", type: "date", required: true }, { name: "sex", type: "string" }, { name: "place_of_birth", type: "string" },
    { name: "issue_date", type: "date" }, { name: "expiry_date", type: "date", required: true }, { name: "issuing_country", type: "country" }, { name: "personal_number", type: "string" },
  ] },
  BANK_STATEMENT: { document_type: "BANK_STATEMENT", fields: [
    { name: "account_holder", type: "string", required: true }, { name: "bank_name", type: "string" }, { name: "account_number", type: "string" },
    { name: "statement_period_start", type: "date", required: true }, { name: "statement_period_end", type: "date", required: true },
    { name: "currency", type: "string" }, { name: "closing_balance", type: "number" },
  ] },
  EMPLOYMENT_LETTER: { document_type: "EMPLOYMENT_LETTER", fields: [
    { name: "employee_name", type: "string", required: true }, { name: "employer", type: "string" }, { name: "designation", type: "string" },
    { name: "employment_start_date", type: "date" }, { name: "salary", type: "number" }, { name: "leave_start", type: "date" }, { name: "leave_end", type: "date" }, { name: "issue_date", type: "date" },
  ] },
  TRAVEL_INSURANCE: { document_type: "TRAVEL_INSURANCE", fields: [
    { name: "insured_person", type: "string", required: true }, { name: "policy_number", type: "string" }, { name: "start_date", type: "date", required: true },
    { name: "end_date", type: "date", required: true }, { name: "coverage_amount", type: "number" }, { name: "currency", type: "string" }, { name: "destination", type: "string" },
  ] },
  HOTEL_BOOKING: { document_type: "HOTEL_BOOKING", fields: [
    { name: "guest_name", type: "string", required: true }, { name: "property_name", type: "string" }, { name: "check_in", type: "date", required: true }, { name: "check_out", type: "date", required: true },
  ] },
  FLIGHT_ITINERARY: { document_type: "FLIGHT_ITINERARY", fields: [
    { name: "passenger_name", type: "string", required: true }, { name: "flight_number", type: "string" }, { name: "departure_date", type: "date", required: true },
    { name: "origin", type: "string" }, { name: "destination", type: "string" }, { name: "return_date", type: "date" },
  ] },
  PREVIOUS_VISA: { document_type: "PREVIOUS_VISA", fields: [
    { name: "holder_name", type: "string", required: true }, { name: "issuing_country", type: "country", required: true },
    { name: "visa_number", type: "string" }, { name: "visa_type", type: "string" }, { name: "valid_from", type: "date" }, { name: "expiry_date", type: "date", required: true },
  ] },
  RESIDENCE_PERMIT: { document_type: "RESIDENCE_PERMIT", fields: [
    { name: "holder_name", type: "string", required: true }, { name: "issuing_country", type: "country", required: true },
    { name: "permit_number", type: "string" }, { name: "permit_type", type: "string" }, { name: "valid_from", type: "date" }, { name: "expiry_date", type: "date", required: true },
  ] },
  GENERIC: { document_type: "GENERIC", fields: [
    { name: "title", type: "string" }, { name: "date", type: "date" }, { name: "holder_name", type: "string" },
  ] },
};

function schemaFor(documentType: string): ExtractionDef {
  return EXTRACTION_SCHEMAS[documentType] || EXTRACTION_SCHEMAS.GENERIC;
}

// ---------- NORMALIZATION ----------
export function normalizeName(s: string): string {
  return String(s || "").toUpperCase().normalize("NFKD").replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
export function normalizeDate(s: any): string {
  if (!s) return "";
  const str = String(s).trim();
  // ISO already?
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // dd/mm/yyyy or dd.mm.yyyy
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(str);
  if (m) {
    let y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? "19" : "20") + y;
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // "12 Mar 2031"
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{2,4})$/.exec(str);
  if (m) {
    const mo = months.indexOf(m[2].slice(0, 3).toUpperCase()); if (mo >= 0) { let y = m[3]; if (y.length === 2) y = "20" + y; return `${y}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  }
  const d = new Date(str); if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}
export function normalizeDateYYMMDD(s: string): string {
  if (!s || s.length < 6) return "";
  return normalizeDate(`${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`);
  // Note: dates from MRZ use 2-digit years; handled by parseDate6 in mrz.ts directly.
}
export function normalizeCountry(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
}
export function normalizeCurrency(s: any): { amount: number | null; currency: string } {
  if (s == null) return { amount: null, currency: "" };
  const cur = /(?:€|EUR|(\$|USD)|₹|INR|£|GBP)/i;
  const num = String(s).replace(/[^0-9.,]/g, "").replace(/,(?=\d{2}\b)/g, "").replace(/,/g, "");
  let amount: number | null = num ? parseFloat(num) : null;
  if (Number.isNaN(amount as number)) amount = null;
  let currency = "";
  const sm = cur.exec(String(s));
  if (sm) currency = ({ "€": "EUR", "$": "USD", "₹": "INR", "£": "GBP" } as any)[sm[0].toUpperCase()] || sm[1] || "EUR";
  return { amount, currency };
}

// Levenshtein for cross-document name comparison.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length) || 1;
  return 1 - dist / maxLen;
}

// ---------- FINDINGS ----------
export type FindingType = "MISSING_FIELD" | "INVALID_VALUE" | "EXPIRED" | "EXPIRING" | "TYPE_MISMATCH" | "OCR_CONFLICT" | "MRZ_CONFLICT" | "IDENTITY_MISMATCH" | "QUALITY_ISSUE" | "ROUTE_REQUIREMENT_FAILURE";
export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export interface FindingSeed {
  type: FindingType; severity: Severity; blocking?: boolean; field?: string; message: string; code: string; source: string; application_id?: string; metadata?: any;
}
export async function writeFindings(svc: any, user: any, versionId: string, docId: string, intelId: string, seeds: FindingSeed[]): Promise<any[]> {
  const out: any[] = [];
  for (const s of seeds) {
    try {
      const f = await svc.entities.DocumentFinding.create({
        document_version_id: versionId, document_id: docId, intelligence_id: intelId, application_id: s.application_id || null,
        type: s.type, severity: s.severity, blocking: s.blocking ?? false, field: s.field || null, message: s.message, code: s.code, source: s.source, resolved: false, metadata: s.metadata || {},
      });
      out.push(f);
    } catch (e) { console.error("writeFindings", e?.message || e); }
  }
  if (out.length) await documentAudit(svc, user, { action: "document.finding_created", entity_type: "DocumentVersion", entity_id: versionId, detail: { count: out.length } });
  return out;
}

// ---------- AI EXTRACTION (InvokeLLM vision + response_json_schema) ----------
function buildJsonSchema(def: ExtractionDef): any {
  const props: any = {};
  for (const f of def.fields) {
    props[f.name] = f.type === "number" ? { type: "number" } : { type: "string" };
  }
  return { type: "object", properties: props, additionalProperties: true };
}

async function signedFileUrl(base44: any, storageUri: string): Promise<string | null> {
  try {
    const r = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: storageUri });
    return r?.signed_url || r?.data?.signed_url || null;
  } catch { return null; }
}

export interface DocumentExtractionAdapter {
  key: string;
  configured(base44: any): boolean;
  extract(base44: any, signedUrl: string, def: ExtractionDef, documentType: string): Promise<AiExtractResult>;
}
interface AiExtractResult {
  fields: Record<string, any>;
  model: string;
  provider: string;
  error?: string;
}
async function aiExtractFields(base44: any, signedUrl: string, def: ExtractionDef, documentType: string): Promise<AiExtractResult> {
  const schema = buildJsonSchema(def);
  const fieldList = def.fields.map((f) => `${f.name} (${f.type}${f.required ? ", required" : ""})`).join(", ");
  const prompt = `You are a document intelligence extractor for visa processing. Analyze the provided ${documentType} document image. Extract ONLY the following fields in JSON. For dates use ISO format YYYY-MM-DD. For country codes use ISO 3166-1 alpha-2/3 uppercase. If a field is not present on the document, return null for it — do not guess. Return ONLY the JSON object.\nFields: ${fieldList}\nAdditionally, if the document is a passport and a Machine Readable Zone (MRZ) is visible at the bottom, copy the exact two 44-character MRZ lines into the "mrz" field with a "|" separator between line 1 and line 2.`;
  try {
    const r = await base44.integrations.Core.InvokeLLM({
      prompt, file_urls: [signedUrl], response_json_schema: schema,
      // Vision-capable model selection is automatic via file_urls; do not pin a model.
    });
    const data = r?.data || r;
    return { fields: (data || {}) as Record<string, any>, model: r?.model || "core-vision", provider: "base44-core" };
  } catch (e: any) {
    return { fields: {}, model: "", provider: "", error: e?.message || String(e) };
  }
}

export const base44VisionExtractionAdapter: DocumentExtractionAdapter = {
  key: "base44-core-vision",
  configured: (base44: any) => typeof base44?.integrations?.Core?.InvokeLLM === "function",
  extract: (base44, signedUrl, def, documentType) => aiExtractFields(base44, signedUrl, def, documentType),
};

// ---------- PIPELINE ----------
export async function getOrCreateIntelligence(svc: any, user: any, versionId: string, doc: any): Promise<any> {
  const existing: any[] = await svc.entities.DocumentIntelligence.filter({ document_version_id: versionId }).catch(() => []);
  if (existing && existing.length) return existing[0];
  const now = new Date().toISOString();
  const intel = await svc.entities.DocumentIntelligence.create({
    document_version_id: versionId, document_id: doc.id, traveler_id: doc.traveler_id,
    document_type: doc.document_type, status: "uploaded",
    classifier_confidence: 0, extraction_confidence: 0,
    extractor_version: INTELLIGENCE_VERSION, classification_version: CLASSIFICATION_VERSION, schema_version: SCHEMA_VERSION,
    started_at: now, needs_review: false, metadata: {},
  });
  return intel;
}

export async function processDocumentVersion(base44: any, svc: any, user: any, versionId: string): Promise<any> {
  const version: any = await svc.entities.DocumentVersion.get(versionId).catch(() => null);
  if (!version) throw Object.assign(new Error("Version not found"), { code: "NOT_FOUND" });
  const doc: any = await svc.entities.Document.get(version.document_id).catch(() => null);
  if (!doc) throw Object.assign(new Error("Document not found"), { code: "NOT_FOUND" });
  assertOwner(doc, user);

  const intel = await getOrCreateIntelligence(svc, user, versionId, doc);
  // Idempotency: if already ready/needs_review and extractor unchanged, return it.
  if ((intel.status === "ready" || intel.status === "needs_review") && intel.extractor_version === INTELLIGENCE_VERSION) {
    return intel;
  }

  const def = schemaFor(doc.document_type);
  const findingSeeds: FindingSeed[] = [];

  // --- CLASSIFY (layered) ---
  await svc.entities.DocumentIntelligence.update(intel.id, {
    status: "classifying",
    document_type: doc.document_type,
    model: intel.model || null, provider: intel.provider || null,
  });
  await documentAudit(svc, user, { action: "document.classified", entity_type: "DocumentVersion", entity_id: versionId, detail: { document_type: doc.document_type } });
  // The declared upload type is metadata-highest-confidence. UNKNOWN/OTHER triggers
  // an AI classifier; otherwise we trust metadata (confidence by catalog presence).
  const knownType = !!documentTypeByKey(doc.document_type);
  let classifierConfidence = knownType ? 0.95 : 0.0;
  if (!knownType) {
    const url = await signedFileUrl(base44, version.storage_uri);
    if (url) {
      const r = await base44.integrations.Core.InvokeLLM({
        prompt: "Classify this visa document into one of: PASSPORT, PHOTO, BANK_STATEMENT, EMPLOYMENT_LETTER, TRAVEL_INSURANCE, HOTEL_BOOKING, FLIGHT_ITINERARY, PREVIOUS_VISA, RESIDENCE_PERMIT, GENERIC. Reply with ONLY the type.",
        file_urls: [url],
      }).catch(() => null);
      const t = String(r?.data || r || "").toUpperCase().trim();
      if (documentTypeByKey(t)) { await svc.entities.Document.update(doc.id, { document_type: t }).catch(() => {}); doc.document_type = t; classifierConfidence = 0.8; }
    }
  }
  if (classifierConfidence < CLASSIFY_MIN_CONFIDENCE && doc.document_type !== "OTHER") classifierConfidence = Math.max(classifierConfidence, 0.95);
  if (classifierConfidence < CLASSIFY_MIN_CONFIDENCE) {
    findingSeeds.push({ type: "QUALITY_ISSUE", severity: "MEDIUM", blocking: true, message: "Classification confidence below threshold", code: "LOW_CLASSIFY_CONFIDENCE", source: "classifier" });
  }

  // --- EXTRACT ---
  await svc.entities.DocumentIntelligence.update(intel.id, { status: "extracting" });
  await documentAudit(svc, user, { action: "document.extraction_started", entity_type: "DocumentVersion", entity_id: versionId });

  let extractions: { name: string; value: any; normalized: string; confidence: number; source: Source; page?: number }[] = [];
  let model = "", provider = "";
  let mrzResult: MrzParseResult | null = null;

  if (doc.document_type === "PASSPORT") {
    // Vision extraction to fetch fields + the MRZ string; then parse MRZ deterministically.
    const url = await signedFileUrl(base44, version.storage_uri);
    if (url) {
      const ai = base44VisionExtractionAdapter.configured(base44)
        ? await base44VisionExtractionAdapter.extract(base44, url, def, "PASSPORT")
        : { fields: {}, model: "", provider: "", error: "OCR_PROVIDER_NOT_CONFIGURED" };
      model = ai.model; provider = ai.provider;
      if (ai.error) findingSeeds.push({ type: "QUALITY_ISSUE", severity: "HIGH", blocking: true, message: ai.error === "OCR_PROVIDER_NOT_CONFIGURED" ? "Passport extraction provider is not configured; manual verification is required" : `Passport extraction failed: ${ai.error}`, code: ai.error === "OCR_PROVIDER_NOT_CONFIGURED" ? "OCR_PROVIDER_NOT_CONFIGURED" : "AI_EXTRACTION_FAILED", source: "adapter" });
      const fields = ai.fields || {};
      // MRZ first — deterministic, highest confidence.
      const mrzRaw = String(fields.mrz || "").replace(/\|/g, "\n");
      if (looksLikeMrz(mrzRaw)) {
        const mrzLines = mrzRaw.split(/\r?\n/).map((x: string) => x.trim()).filter(Boolean);
        if (mrzLines[0]) extractions.push({ name: "mrz_line_1", value: mrzLines[0], normalized: mrzLines[0], confidence: 0.99, source: "mrz", page: 1 });
        if (mrzLines[1]) extractions.push({ name: "mrz_line_2", value: mrzLines[1], normalized: mrzLines[1], confidence: 0.99, source: "mrz", page: 1 });
        mrzResult = parseMrz(mrzRaw);
        if (mrzResult) {
          const pushMrz = (n: string, v: any, norm: string, conf = 0.99, page = 1) => extractions.push({ name: n, value: v, normalized: norm, confidence: conf, source: "mrz", page });
          if (mrzResult.surname) pushMrz("surname", mrzResult.surname, normalizeName(mrzResult.surname));
          if (mrzResult.given_names) pushMrz("given_names", mrzResult.given_names, normalizeName(mrzResult.given_names));
          if (mrzResult.passport_number) pushMrz("passport_number", mrzResult.passport_number, mrzResult.passport_number);
          if (mrzResult.nationality) pushMrz("nationality", mrzResult.nationality, normalizeCountry(mrzResult.nationality));
          if (mrzResult.date_of_birth) pushMrz("date_of_birth", mrzResult.date_of_birth, normalizeDate(mrzResult.date_of_birth));
          if (mrzResult.sex) pushMrz("sex", mrzResult.sex, mrzResult.sex, 0.99);
          if (mrzResult.expiry_date) pushMrz("expiry_date", mrzResult.expiry_date, normalizeDate(mrzResult.expiry_date));
          if (mrzResult.issuing_country) pushMrz("issuing_country", mrzResult.issuing_country, normalizeCountry(mrzResult.issuing_country));
          if (mrzResult.personal_number) pushMrz("personal_number", mrzResult.personal_number, mrzResult.personal_number);
          // Validate MRZ check digits → findings.
          if (!mrzResult.valid) {
            findingSeeds.push({ type: "MRZ_CONFLICT", severity: "HIGH", blocking: true, message: `MRZ check-digit validation failed: ${mrzResult.errors.join(", ")}`, code: "MRZ_CHECK_FAILED", source: "mrz" });
          }
          // OCR vs MRZ conflict detection — never choose one silently.
          const ocrField = (n: string): string => String(fields[n] || "").trim();
          const conflicts: string[] = [];
          for (const n of ["passport_number", "nationality", "surname", "given_names", "date_of_birth", "expiry_date"]) {
            const m = extractions.find((e) => e.name === n); if (!m) continue;
            const o = ocrField(n);
            if (o) { const norm = n.includes("name") || n === "nationality" ? normalizeName(o) : normalizeDate(o) || normalizeCountry(o); if (norm && norm !== m.normalized) conflicts.push(n); }
          }
          if (conflicts.length) findingSeeds.push({ type: "OCR_CONFLICT", severity: "HIGH", blocking: true, field: conflicts[0], message: `OCR/MRZ disagreement on: ${conflicts.join(", ")}`, code: "OCR_MRZ_CONFLICT", source: "mrz" });
        }
      }
      // Fields only OCR/LLM can read (place_of_birth, issue_date) — filled where MRZ silent.
      const fillFromAi = (n: string, conf = 0.75) => {
        if (extractions.find((e) => e.name === n)) return;
        const v = fields[n];
        if (v == null || v === "") return;
        extractions.push({ name: n, value: String(v), normalized: def.fields.find((field) => field.name === n)?.type === "date" ? normalizeDate(v) : (n.includes("name") ? normalizeName(v) : String(v)), confidence: conf, source: "llm", page: 1 });
      };
      fillFromAi("place_of_birth"); fillFromAi("issue_date");
    } else {
      findingSeeds.push({ type: "QUALITY_ISSUE", severity: "MEDIUM", blocking: true, message: "Unable to obtain a secure file URL for extraction", code: "NO_SIGNED_URL", source: "storage" });
    }
  } else {
    // Non-passport: vision extraction with the type schema.
    const url = await signedFileUrl(base44, version.storage_uri);
    if (url) {
      const ai = base44VisionExtractionAdapter.configured(base44)
        ? await base44VisionExtractionAdapter.extract(base44, url, def, doc.document_type)
        : { fields: {}, model: "", provider: "", error: "OCR_PROVIDER_NOT_CONFIGURED" };
      model = ai.model; provider = ai.provider;
      if (ai.error) findingSeeds.push({ type: "QUALITY_ISSUE", severity: "HIGH", blocking: true, message: `AI extraction failed: ${ai.error}`, code: "AI_EXTRACTION_FAILED", source: "llm" });
      for (const f of def.fields) {
        const v = ai.fields?.[f.name];
        if (v == null || v === "") continue;
        const norm = f.type === "date" ? normalizeDate(v) : (f.name.includes("name") || f.name.includes("holder") || f.name.includes("insured") || f.name.includes("guest") || f.name.includes("passenger") || f.name.includes("employee") || f.name.includes("account_holder") ? normalizeName(v) : (f.name === "currency" ? String(v).toUpperCase() : String(v)));
        extractions.push({ name: f.name, value: String(v), normalized: norm, confidence: 0.8, source: "llm", page: 1 });
      }
    } else {
      findingSeeds.push({ type: "QUALITY_ISSUE", severity: "MEDIUM", blocking: true, message: "Unable to obtain a secure file URL for extraction", code: "NO_SIGNED_URL", source: "storage" });
    }
  }

  // --- VALIDATE (deterministic) ---
  await svc.entities.DocumentIntelligence.update(intel.id, { status: "validating", model: model || null, provider: provider || null });
  await documentAudit(svc, user, { action: "document.validation_started", entity_type: "DocumentVersion", entity_id: versionId });

  const byField: Record<string, any> = {};
  for (const e of extractions) byField[e.name] = { value: e.value, normalized: e.normalized };

  // Required fields.
  for (const f of def.fields) {
    if (f.required && !byField[f.name]?.normalized) findingSeeds.push({ type: "MISSING_FIELD", severity: "HIGH", blocking: true, field: f.name, message: `Required field "${f.name}" was not extracted`, code: "MISSING_REQUIRED", source: "field" });
  }
  // Date ordering for passports: issue_date <= expiry_date.
  if (doc.document_type === "PASSPORT") {
    const iss = byField.issue_date?.normalized, exp = byField.expiry_date?.normalized;
    if (iss && exp && iss > exp) findingSeeds.push({ type: "INVALID_VALUE", severity: "HIGH", blocking: true, field: "issue_date", message: "Issue date is after expiry date", code: "DATE_ORDER", source: "date" });
  }
  // Bank statement period ordering.
  if (doc.document_type === "BANK_STATEMENT") {
    const s = byField.statement_period_start?.normalized, eEnd = byField.statement_period_end?.normalized;
    if (s && eEnd && s > eEnd) findingSeeds.push({ type: "INVALID_VALUE", severity: "HIGH", blocking: true, field: "statement_period_start", message: "Statement start is after end", code: "DATE_ORDER", source: "date" });
  }
  // Hotel check-in/out ordering.
  if (doc.document_type === "HOTEL_BOOKING") {
    const ci = byField.check_in?.normalized, co = byField.check_out?.normalized;
    if (ci && co && ci >= co) findingSeeds.push({ type: "INVALID_VALUE", severity: "HIGH", blocking: true, field: "check_in", message: "Check-out must be after check-in", code: "DATE_ORDER", source: "date" });
  }
  // Insurance period ordering.
  if (doc.document_type === "TRAVEL_INSURANCE") {
    const sd = byField.start_date?.normalized, ed = byField.end_date?.normalized;
    if (sd && ed && sd > ed) findingSeeds.push({ type: "INVALID_VALUE", severity: "HIGH", blocking: true, field: "start_date", message: "Insurance start is after end", code: "DATE_ORDER", source: "date" });
  }
  // Country code sanity.
  for (const n of ["nationality", "issuing_country"]) {
    const v = byField[n]?.normalized;
    if (v && (v.length < 2 || v.length > 3)) findingSeeds.push({ type: "INVALID_VALUE", severity: "LOW", field: n, message: `Country code looks invalid: ${v}`, code: "BAD_COUNTRY", source: "field" });
  }
  // Quality: file too small to be readable.
  if (version.file_size && version.file_size < 20 * 1024) findingSeeds.push({ type: "QUALITY_ISSUE", severity: "MEDIUM", blocking: true, message: "File is very small and may be unreadable", code: "LOW_RESOLUTION", source: "quality" });

  // Expiry findings (vault-level doc.expires_at OR extracted expiry_date).
  const expiryRef = byField.expiry_date?.normalized || byField.end_date?.normalized;
  const docExpiry = doc.expires_at || expiryRef;
  if (docExpiry) {
    const exp = new Date(docExpiry).getTime();
    if (!Number.isNaN(exp)) {
      const now = Date.now();
      if (exp < now) findingSeeds.push({ type: "EXPIRED", severity: "CRITICAL", blocking: true, field: "expiry_date", message: "Document is expired", code: "DOC_EXPIRED", source: "expiry" });
      else if (exp - now < 30 * 86400000) findingSeeds.push({ type: "EXPIRING", severity: "LOW", field: "expiry_date", message: "Document expires within 30 days", code: "DOC_EXPIRING", source: "expiry" });
    }
  }

  // --- WRITE EXTRACTIONS & FINDINGS ---
  // Replace prior extractions for this version (reprocessing case) — idempotent.
  await svc.entities.DocumentExtraction.deleteMany({ intelligence_id: intel.id }).catch(() => {});
  let extractionConfidence = 0;
  for (const e of extractions) {
    const f = def.fields.find((x) => x.name === e.name);
    const norm = e.normalized || (f?.type === "date" ? normalizeDate(e.value) : String(e.value));
    await svc.entities.DocumentExtraction.create({
      document_version_id: versionId, intelligence_id: intel.id, document_id: doc.id, document_type: doc.document_type,
      field_name: e.name, field_value: String(e.value ?? ""), normalized_value: norm,
      confidence: e.confidence, source: e.source, source_page: e.page || 1,
      extractor_version: INTELLIGENCE_VERSION, schema_version: SCHEMA_VERSION,
    }).catch(() => {});
    extractionConfidence = Math.max(extractionConfidence, e.confidence);
  }
  // Replace prior standalone (non-application) findings for clean idempotency.
  await svc.entities.DocumentFinding.deleteMany({ document_version_id: versionId, application_id: null }).catch(() => {});
  const writtenFindings = await writeFindings(svc, user, versionId, doc.id, intel.id, findingSeeds);

  const blocking = writtenFindings.filter((f: any) => f.blocking && !f.resolved);
  const needsReview = classifierConfidence < CLASSIFY_MIN_CONFIDENCE || extractionConfidence < EXTRACTION_MIN_CONFIDENCE || blocking.length > 0 || writtenFindings.some((f: any) => f.type === "OCR_CONFLICT" || f.type === "MRZ_CONFLICT");
  const status: IntelStatus = blocking.length ? "needs_review" : (needsReview ? "needs_review" : "ready");
  const summary = { critical: writtenFindings.filter((f:any)=>f.severity==="CRITICAL").length, high: writtenFindings.filter((f:any)=>f.severity==="HIGH").length, medium: writtenFindings.filter((f:any)=>f.severity==="MEDIUM").length, low: writtenFindings.filter((f:any)=>f.severity==="LOW").length, info: writtenFindings.filter((f:any)=>f.severity==="INFO").length, blocking: blocking.length };
  const finalIntel = await svc.entities.DocumentIntelligence.update(intel.id, {
    status, classifier_confidence: classifierConfidence, extraction_confidence: extractionConfidence,
    model: model || null, provider: provider || null, needs_review: status === "needs_review",
    review_reason: status === "needs_review" ? (blocking.length ? "blocking_findings" : "low_confidence") : null,
    findings_summary: summary, completed_at: new Date().toISOString(), error_code: null,
  });
  await documentAudit(svc, user, { action: status === "ready" ? "document.extracted" : "document.review_requested", entity_type: "DocumentVersion", entity_id: versionId, detail: { status, model, provider, extraction_confidence: extractionConfidence, findings: writtenFindings.length } });
  if (status === "ready") await documentAudit(svc, user, { action: "document.validation_completed", entity_type: "DocumentVersion", entity_id: versionId, detail: { status: "verified" } });
  return finalIntel;
}

// ---------- READ ----------
export async function getDocumentIntelligence(svc: any, user: any, versionId: string): Promise<any> {
  const version: any = await svc.entities.DocumentVersion.get(versionId).catch(() => null);
  if (!version) throw Object.assign(new Error("Version not found"), { code: "NOT_FOUND" });
  const doc: any = await svc.entities.Document.get(version.document_id).catch(() => null);
  if (doc) assertOwner(doc, user);
  const intel: any = (await svc.entities.DocumentIntelligence.filter({ document_version_id: versionId }).catch(() => []))[0] || null;
  if (!intel) return { intelligence: null, extractions: [], findings: [] };
  const [extractions, findings] = await Promise.all([
    svc.entities.DocumentExtraction.filter({ intelligence_id: intel.id }).catch(() => []),
    svc.entities.DocumentFinding.filter({ document_version_id: versionId }).catch(() => []),
  ]);
  // Redact sensitive fields in the API response (masked_pii handled in UI; here we
  // return the structured values the UI owns already — the UI decides masking).
  return {
    intelligence: { ...intel, document_type: intel.document_type, status: intel.status, needs_review: intel.needs_review, findings_summary: intel.findings_summary },
    extractions: (extractions || []).map((e: any) => ({ id: e.id, field_name: e.field_name, field_value: e.field_value, normalized_value: e.normalized_value, confidence: e.confidence, source: e.source, source_page: e.source_page, extractor_version: e.extractor_version })),
    findings: (findings || []).map((f: any) => ({ id: f.id, type: f.type, severity: f.severity, blocking: f.blocking, field: f.field, message: f.message, code: f.code, source: f.source, application_id: f.application_id, resolved: f.resolved })),
  };
}

// ---------- ROUTE-SPECIFIC VALIDATION ----------
// Parse the visa requirement title/body for explicit numeric thresholds. The
// document engine never hard-codes "France = 6 months" — it reads the pinned
// requirement text the Phase 2 graph supplied for this application.
export function parseMonthsThreshold(text: string): number | null {
  const m = /(\d+)\s*\+?\s*months?/.exec(String(text || "").toLowerCase());
  return m ? parseInt(m[1], 10) : null;
}
export function parseAmountThreshold(text: string): { amount: number; currency: string } | null {
  const m = /(?:€|EUR|euro[s]?)\s*([\d, .]+)|(?:\$|USD|usd)\s*([\d, .]+)|(?:₹|INR|inr)\s*([\d, .]+)/i.exec(String(text || ""));
  if (!m) return null;
  const raw = m[2] || m[3] || m[1];
  const amount = parseFloat(raw.replace(/[,\s]/g, ""));
  if (Number.isNaN(amount)) return null;
  const currency = m[2] ? "USD" : m[3] ? "INR" : "EUR";
  return { amount, currency };
}

export async function validateVersionForApplication(svc: any, user: any, versionId: string, app: any): Promise<any> {
  const version: any = await svc.entities.DocumentVersion.get(versionId).catch(() => null);
  if (!version) return { valid: false, findings: [] };
  const doc: any = await svc.entities.Document.get(version.document_id).catch(() => null);
  if (doc) assertOwner(doc, user);
  // Load pinned requirements graph for the application.
  const { resolveRequirements } = await import("./requirements.ts");
  const graph = await resolveRequirements(svc, app.destination, app.purpose).catch(() => null);
  const reqs: any[] = ((graph?.requirements) || []).filter((r: any) => r.document_category);
  const extractions: any[] = await svc.entities.DocumentExtraction.filter({ document_version_id: versionId }).catch(() => []);
  const byField: Record<string, any> = {};
  const fieldNames = Array.from(new Set(extractions.map((e: any) => e.field_name)));
  for (const fn of fieldNames) { const e = bestExtraction(extractions, fn); byField[fn] = e?.normalized_value || e?.field_value || ""; }
  const seeds: FindingSeed[] = [];

  for (const r of reqs) {
    const title = `${r.title || ""} ${r.description || ""}`;
    const cat = String(r.document_category).toLowerCase();
    // Passport validity rule: "X+ months from travel date".
    if (cat === "passport" || cat.includes("passport")) {
      const months = parseMonthsThreshold(title);
      if (months && app.travel_start) {
        const exp = byField.expiry_date || doc?.expires_at;
        if (exp) {
          const required = new Date(app.travel_start); required.setMonth(required.getMonth() + months);
          if (new Date(exp) < required) seeds.push({ type: "ROUTE_REQUIREMENT_FAILURE", severity: "HIGH", blocking: true, field: "expiry_date", message: `Passport must be valid ${months}+ months beyond travel date (${app.travel_start})`, code: "PASSPORT_VALIDITY", source: "route", application_id: app.id });
        }
      }
    }
    // Insurance coverage rule: "≥ €30,000".
    if (cat === "travel_insurance" || cat === "insurance") {
      const th = parseAmountThreshold(title);
      if (th && byField.coverage_amount) {
        const amt = parseFloat(String(byField.coverage_amount).replace(/[^0-9.]/g, ""));
        if (!Number.isNaN(amt) && amt < th.amount) seeds.push({ type: "ROUTE_REQUIREMENT_FAILURE", severity: "HIGH", blocking: true, field: "coverage_amount", message: `Insurance coverage below required ${th.amount} ${th.currency}`, code: "INSURANCE_COVERAGE", source: "route", application_id: app.id });
      }
      // Insurance must cover the travel period.
      if (byField.start_date && byField.end_date && app.travel_start && app.travel_end) {
        if (byField.start_date > app.travel_start || byField.end_date < app.travel_end) seeds.push({ type: "ROUTE_REQUIREMENT_FAILURE", severity: "HIGH", blocking: true, field: "end_date", message: "Insurance does not cover the full travel period", code: "INSURANCE_PERIOD", source: "route", application_id: app.id });
      }
    }
    // Bank statements: "3-6 months" → statement should start ~6 months before travel.
    if (cat === "bank_statements" || cat === "bank_statement") {
      const m = /(\d+)\s*-\s*(\d+)\s*months?/.exec(title) || /last\s+(\d+)\s*-\s*(\d+)\s*months?/.exec(title);
      if (m && app.travel_start) {
        const months = parseInt(m[2], 10);
        const neededFrom = new Date(app.travel_start); neededFrom.setMonth(neededFrom.getMonth() - months);
        if (byField.statement_period_start && new Date(byField.statement_period_start) > neededFrom) seeds.push({ type: "ROUTE_REQUIREMENT_FAILURE", severity: "MEDIUM", blocking: false, field: "statement_period_start", message: `Bank statement should cover at least the last ${months} months`, code: "BANK_PERIOD", source: "route", application_id: app.id });
      }
    }
    // Accommodation "entire stay": hotel dates must contain travel period.
    if (cat === "accommodation_proof" || cat === "accommodation") {
      if (byField.check_in && byField.check_out && app.travel_start && app.travel_end) {
        if (byField.check_in > app.travel_start || byField.check_out < app.travel_end) seeds.push({ type: "ROUTE_REQUIREMENT_FAILURE", severity: "MEDIUM", blocking: true, field: "check_in", message: "Accommodation does not cover the full stay", code: "ACCOMMODATION_PERIOD", source: "route", application_id: app.id });
      }
    }
    // Return flight: must match destination.
    if (cat === "return_ticket" || cat === "flight_itinerary") {
      if (byField.destination && app.destination && normalizeCountry(byField.destination) !== normalizeCountry(app.destination)) seeds.push({ type: "ROUTE_REQUIREMENT_FAILURE", severity: "MEDIUM", blocking: false, field: "destination", message: "Flight itinerary destination does not match the application destination", code: "FLIGHT_DESTINATION", source: "route", application_id: app.id });
    }
  }

  // Remove old route-specific findings for this app+version, then write new.
  await svc.entities.DocumentFinding.deleteMany({ document_version_id: versionId, application_id: app.id }).catch(() => {});
  const written = await writeFindings(svc, user, versionId, doc?.id || null, null, seeds);
  const blocking = (written as any[]).filter((f: any) => f.blocking && !f.resolved);
  return { valid: blocking.length === 0, findings: written, blocking_count: blocking.length };
}

// ---------- CROSS-DOCUMENT (per application) ----------
export async function analyzeApplicationDocuments(base44: any, svc: any, user: any, app: any): Promise<any> {
  const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
  const active = attachments.filter((a: any) => a.status !== "detached");
  const versions: any[] = [];
  for (const a of active) {
    const v = await svc.entities.DocumentExtraction.filter({ document_version_id: a.document_version_id }).catch(() => []);
    const doc: any = await svc.entities.Document.get(a.document_id).catch(() => null);
    versions.push({ application_document: a, document: doc, extractions: v });
  }
  const get = (ex: any[], docType: string, field: string): string => {
    const e = bestExtraction(ex, field); return e?.normalized_value || e?.field_value || "";
  };
  const passport = versions.find((v) => v.document?.document_type === "PASSPORT");
  const passportName = passport ? `${get(passport.extractions, "PASSPORT", "surname")} ${get(passport.extractions, "PASSPORT", "given_names")}`.trim() : "";
  const seeds: FindingSeed[] = [];

  // Identity consistency across name-bearing documents.
  const nameBearing: { type: string; field: string }[] = [
    { type: "BANK_STATEMENT", field: "account_holder" }, { type: "EMPLOYMENT_LETTER", field: "employee_name" },
    { type: "TRAVEL_INSURANCE", field: "insured_person" }, { type: "HOTEL_BOOKING", field: "guest_name" }, { type: "FLIGHT_ITINERARY", field: "passenger_name" },
  ];
  if (passportName) {
    for (const nb of nameBearing) {
      const rec = versions.find((v) => v.document?.document_type === nb.type);
      const otherName = rec ? get(rec.extractions, nb.type, nb.field) : "";
      if (otherName) {
        const sim = nameSimilarity(passportName, otherName);
        if (sim < 0.85) seeds.push({ type: "IDENTITY_MISMATCH", severity: "MEDIUM", blocking: false, field: nb.field, message: `Name mismatch: passport "${passportName}" vs ${nb.type} "${otherName}"`, code: "IDENTITY_MISMATCH", source: "cross_document", application_id: app.id, metadata: { similarity: sim } });
      }
    }
  }

  // Travel-date consistency.
  const flight = versions.find((v) => v.document?.document_type === "FLIGHT_ITINERARY");
  const hotel = versions.find((v) => v.document?.document_type === "HOTEL_BOOKING");
  const insurance = versions.find((v) => v.document?.document_type === "TRAVEL_INSURANCE");
  if (flight && app.travel_start) {
    const dep = get(flight.extractions, "FLIGHT_ITINERARY", "departure_date");
    if (dep && Math.abs(new Date(dep).getTime() - new Date(app.travel_start).getTime()) > 3 * 86400000) seeds.push({ type: "INVALID_VALUE", severity: "MEDIUM", blocking: false, field: "departure_date", message: "Flight departure is not within 3 days of travel start", code: "FLIGHT_DATE", source: "cross_document", application_id: app.id });
  }
  if (hotel && flight) {
    const ci = get(hotel.extractions, "HOTEL_BOOKING", "check_in");
    const dep = get(flight.extractions, "FLIGHT_ITINERARY", "departure_date");
    if (ci && dep && Math.abs(new Date(ci).getTime() - new Date(dep).getTime()) > 2 * 86400000) seeds.push({ type: "INVALID_VALUE", severity: "LOW", blocking: false, field: "check_in", message: "Hotel check-in does not align with flight departure", code: "HOTEL_DATE", source: "cross_document", application_id: app.id });
  }
  if (insurance && app.travel_start && app.travel_end) {
    const sd = get(insurance.extractions, "TRAVEL_INSURANCE", "start_date");
    const ed = get(insurance.extractions, "TRAVEL_INSURANCE", "end_date");
    if (sd && ed && (sd > app.travel_start || ed < app.travel_end)) seeds.push({ type: "ROUTE_REQUIREMENT_FAILURE", severity: "HIGH", blocking: true, field: "end_date", message: "Insurance coverage gap relative to travel dates", code: "INSURANCE_GAP", source: "cross_document", application_id: app.id });
  }

  // Write cross-document findings (clean prior cross-doc findings for this app).
  await svc.entities.DocumentFinding.deleteMany({ source: "cross_document", application_id: app.id }).catch(() => {});
  const written: any[] = [];
  for (const s of seeds) {
    const ver = versions.find((v) => v.document?.document_type === findsDocType(s.field));
    const versionId = ver?.application_document?.document_version_id || versions[0]?.application_document?.document_version_id || null;
    if (!versionId) continue;
    try {
      const f = await svc.entities.DocumentFinding.create({
        document_version_id: versionId, document_id: ver?.document?.id || null, intelligence_id: null, application_id: app.id,
        type: s.type, severity: s.severity, blocking: s.blocking ?? false, field: s.field || null, message: s.message, code: s.code, source: s.source, resolved: false, metadata: s.metadata || {},
      });
      written.push(f);
    } catch {}
  }
  await documentAudit(svc, user, { action: "document.validation_completed", entity_type: "VisaApplication", entity_id: app.id, detail: { cross_document_findings: written.length } });
  return { findings: written };
}
function findsDocType(field: string): string {
  if (["account_holder", "employee_name", "insured_person", "guest_name", "passenger_name"].includes(field)) {
    return ({ account_holder: "BANK_STATEMENT", employee_name: "EMPLOYMENT_LETTER", insured_person: "TRAVEL_INSURANCE", guest_name: "HOTEL_BOOKING", passenger_name: "FLIGHT_ITINERARY" } as any)[field];
  }
  if (["check_in", "check_out"].includes(field)) return "HOTEL_BOOKING";
  if (["departure_date", "return_date"].includes(field)) return "FLIGHT_ITINERARY";
  if (["start_date", "end_date"].includes(field)) return "TRAVEL_INSURANCE";
  return "";
}

// ---------- REQUIREMENT-ITEM ACCEPTANCE STATE ----------
// A requirement is "verified" only when its pinned version has a READY
// intelligence AND no blocking findings for this application.
export function requirementItemState(item: any, applicationDocumentsExtractionsByType: Record<string, any>): "missing" | "uploaded" | "processing" | "needs_review" | "verified" {
  const ad: any = applicationDocumentsExtractionsByType?.[item.document_type] || item.application_document;
  if (!ad) return "missing";
  const intel = ad._intelligence;
  const blocking = ad._blocking_findings_for_app;
  if (intel?.status === "needs_review" || intel?.status === "processing_failed") return "needs_review";
  if (intel?.status === "ready") return blocking ? "needs_review" : "verified";
  if (intel?.status === "classifying" || intel?.status === "extracting" || intel?.status === "validating" || intel?.status === "uploaded") return "processing";
  return "uploaded";
}

// ---------- PHASE 17: BEST-SOURCE READ ----------
// Source priority so a USER_CONFIRMED value always wins over auto-extraction,
// and MRZ wins over LLM. Used by every read site so confirmation actually takes
// effect without mutating the original extraction rows.
export const SOURCE_PRIORITY: Record<string, number> = {
  user_confirmed: 100, mrz: 90, structured: 80, ocr: 70, llm: 60, heuristic: 50, metadata: 40,
};
export function bestExtraction(extractions: any[], fieldName: string): any {
  const matches = (extractions || []).filter((e) => e.field_name === fieldName);
  if (!matches.length) return undefined;
  matches.sort((a, b) => (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0));
  return matches[0];
}
export function readField(extractions: any[], fieldName: string): string {
  const e = bestExtraction(extractions, fieldName);
  return e?.normalized_value || e?.field_value || "";
}

// ---------- PHASE 17 §17: DUPLICATE DETECTION ----------
// Identity key for a document version. Passports key on number+expiry; others
// on the version checksum. Two documents sharing a key are likely duplicates.
export function duplicateIdentityKey(documentType: string, extractions: any[], checksum?: string): string {
  if (documentType === "PASSPORT") {
    const num = readField(extractions, "passport_number").toUpperCase().replace(/\s/g, "");
    const exp = readField(extractions, "expiry_date");
    if (num && exp) return `PASSPORT|${num}|${exp}`;
  }
  if (checksum) return `CHECKSUM|${checksum}`;
  return "";
}
export async function detectDuplicates(svc: any, user: any, travelerId: string): Promise<any> {
  const docs: any[] = await svc.entities.Document.filter({ traveler_id: travelerId, status: "active" }).catch(() => []);
  const enriched: any[] = [];
  for (const d of docs) {
    const cur = d.current_version_id ? await svc.entities.DocumentVersion.get(d.current_version_id).catch(() => null) : null;
    const ex: any[] = cur ? await svc.entities.DocumentExtraction.filter({ document_version_id: cur.id }).catch(() => []) : [];
    const key = duplicateIdentityKey(d.document_type, ex, cur?.checksum);
    enriched.push({ doc: d, version: cur, key, created: cur?.created_date || d.created_date });
  }
  const groups: Record<string, any[]> = {};
  for (const e of enriched) { if (e.key) (groups[e.key] = groups[e.key] || []).push(e); }
  const duplicates: any[] = [];
  for (const key of Object.keys(groups)) {
    const g = groups[key].sort((a, b) => String(a.created).localeCompare(String(b.created))); // oldest first
    if (g.length < 2) continue;
    const [current, ...older] = g; // newest-by-created is last; current = keep
    // Mark older versions as duplicates (never delete).
    for (const o of older) {
      if (!o.version) continue;
      const existing: any[] = await svc.entities.DocumentFinding.filter({ document_version_id: o.version.id, code: "DUPLICATE_DOCUMENT", resolved: false }).catch(() => []);
      if (!existing.length) {
        await svc.entities.DocumentFinding.create({
          document_version_id: o.version.id, document_id: o.doc.id, intelligence_id: null, application_id: null,
          type: "QUALITY_ISSUE", severity: "LOW", blocking: false, field: null,
          message: "Possible duplicate document detected (same identifying fields as a newer version)",
          code: "DUPLICATE_DOCUMENT", source: "duplicate_detection", resolved: false,
          metadata: { duplicate_of_version_id: current.version?.id, duplicate_of_document_id: current.doc?.id },
        }).catch(() => {});
      }
      duplicates.push({ document_id: o.doc.id, version_id: o.version.id, display_name: o.doc.display_name, duplicate_of_document_id: current.doc.id });
    }
  }
  await documentAudit(svc, user, { action: "document.duplicate_scan", entity_type: "Traveler", entity_id: travelerId, detail: { duplicates: duplicates.length } });
  return { duplicates, groups: Object.keys(groups).map((k) => ({ key: k, count: groups[k].length })) };
}

// ---------- PHASE 17 §20: USER CONFIRMATION ----------
// The traveler reviews extracted fields and confirms/corrects them. Confirmed
// values are written as USER_CONFIRMED extraction rows (never mutating the
// originals) and MISSING_FIELD findings for confirmed fields auto-resolve.
export async function confirmExtraction(svc: any, user: any, versionId: string, confirmed: Record<string, any>): Promise<any> {
  const version: any = await svc.entities.DocumentVersion.get(versionId).catch(() => null);
  if (!version) throw Object.assign(new Error("Version not found"), { code: "NOT_FOUND" });
  const doc: any = await svc.entities.Document.get(version.document_id).catch(() => null);
  if (!doc) throw Object.assign(new Error("Document not found"), { code: "NOT_FOUND" });
  assertOwner(doc, user);
  const intel = await getOrCreateIntelligence(svc, user, versionId, doc);
  const def = schemaFor(doc.document_type);
  const now = new Date().toISOString();
  const fields = Object.keys(confirmed || {});
  if (!fields.length) throw Object.assign(new Error("No fields supplied"), { code: "BAD_INPUT" });

  // Replace prior USER_CONFIRMED rows for the fields being confirmed (latest wins).
  const prior: any[] = await svc.entities.DocumentExtraction.filter({ document_version_id: versionId, source: "user_confirmed" }).catch(() => []);
  for (const p of prior) if (fields.includes(p.field_name)) await svc.entities.DocumentExtraction.delete(p.id).catch(() => {});

  for (const name of fields) {
    const fdef = def.fields.find((f) => f.name === name);
    const raw = confirmed[name];
    if (raw == null || raw === "") continue;
    const norm = !fdef ? String(raw) : (fdef.type === "date" ? normalizeDate(raw) : (fdef.type === "country" ? normalizeCountry(raw) : (name.includes("name") ? normalizeName(raw) : String(raw))));
    await svc.entities.DocumentExtraction.create({
      document_version_id: versionId, intelligence_id: intel.id, document_id: doc.id, document_type: doc.document_type,
      field_name: name, field_value: String(raw), normalized_value: norm, confidence: 1.0, source: "user_confirmed", source_page: 1,
      extractor_version: INTELLIGENCE_VERSION, schema_version: SCHEMA_VERSION,
    }).catch(() => {});
  }

  // Auto-resolve MISSING_FIELD findings for confirmed fields (cause remediated, never deleted).
  const missings: any[] = await svc.entities.DocumentFinding.filter({ document_version_id: versionId, type: "MISSING_FIELD", resolved: false }).catch(() => []);
  for (const m of missings) {
    if (fields.includes(m.field)) await svc.entities.DocumentFinding.update(m.id, { resolved: true, metadata: { ...(m.metadata || {}), resolved_by: "user_confirm", resolved_at: now } }).catch(() => {});
  }

  // Re-evaluate field-specific blocking findings against the user-confirmed
  // values: the traveler's corrections are authoritative, so EXPIRED / DATE_ORDER
  // / OCR_CONFLICT findings that the confirmation has remediated are auto-resolved
  // (never deleted). Findings with no field (QUALITY_ISSUE, MRZ_CONFLICT from a
  // failed check digit) are never auto-cleared — they need a re-upload or MRZ
  // correction, not a value edit.
  const allExtractions: any[] = await svc.entities.DocumentExtraction.filter({ document_version_id: versionId }).catch(() => []);
  const valOf = (name: string): string => {
    const e = bestExtraction(allExtractions, name);
    return e?.normalized_value || e?.field_value || "";
  };
  const openBlocking: any[] = await svc.entities.DocumentFinding.filter({ document_version_id: versionId, resolved: false, blocking: true }).catch(() => []);
  for (const f of openBlocking) {
    let remediated = false;
    if (f.type === "EXPIRED" && f.field === "expiry_date") {
      const v = valOf("expiry_date");
      const t = v ? new Date(v).getTime() : NaN;
      remediated = !Number.isNaN(t) && t > Date.now();
    } else if (f.type === "INVALID_VALUE" && f.code === "DATE_ORDER") {
      if (doc.document_type === "PASSPORT") {
        const iss = valOf("issue_date"), exp = valOf("expiry_date");
        remediated = !!iss && !!exp && iss <= exp;
      } else if (doc.document_type === "BANK_STATEMENT") {
        const s = valOf("statement_period_start"), e = valOf("statement_period_end");
        remediated = !!s && !!e && s <= e;
      } else if (doc.document_type === "HOTEL_BOOKING") {
        const ci = valOf("check_in"), co = valOf("check_out");
        remediated = !!ci && !!co && ci < co;
      } else if (doc.document_type === "TRAVEL_INSURANCE") {
        const sd = valOf("start_date"), ed = valOf("end_date");
        remediated = !!sd && !!ed && sd <= ed;
      }
    } else if (f.type === "OCR_CONFLICT" && f.field && fields.includes(f.field)) {
      // Traveler explicitly chose a value for the conflicting field.
      remediated = true;
    }
    if (remediated) await svc.entities.DocumentFinding.update(f.id, { resolved: true, metadata: { ...(f.metadata || {}), resolved_by: "user_confirm", resolved_at: now } }).catch(() => {});
  }

  // Re-evaluate intelligence status: ready only if no unresolved blocking findings remain.
  const blocking: any[] = await svc.entities.DocumentFinding.filter({ document_version_id: versionId, resolved: false, blocking: true }).catch(() => []);
  const updated = await svc.entities.DocumentIntelligence.update(intel.id, {
    status: blocking.length ? "needs_review" : "ready",
    needs_review: blocking.length > 0,
    metadata: { ...(intel.metadata || {}), user_confirmed: true, confirmed_at: now, confirmed_by: user?.id || user?.email || "traveler" },
  }).catch(async () => intel);
  await documentAudit(svc, user, { action: "document.user_confirmed", entity_type: "DocumentVersion", entity_id: versionId, detail: { fields: fields.length } });
  return { intelligence: updated, confirmed_fields: fields };
}

// ---------- PHASE 17 §27: RETRY PROCESSING ----------
export async function retryProcessing(base44: any, svc: any, user: any, versionId: string): Promise<any> {
  const version: any = await svc.entities.DocumentVersion.get(versionId).catch(() => null);
  if (!version) throw Object.assign(new Error("Version not found"), { code: "NOT_FOUND" });
  const doc: any = await svc.entities.Document.get(version.document_id).catch(() => null);
  if (!doc) throw Object.assign(new Error("Document not found"), { code: "NOT_FOUND" });
  assertOwner(doc, user);
  const intelRows: any[] = await svc.entities.DocumentIntelligence.filter({ document_version_id: versionId }).catch(() => []);
  const intel = intelRows[0];
  const attempts = (intel?.metadata?.attempts || 0) + 1;
  if (intel) {
    await svc.entities.DocumentIntelligence.update(intel.id, {
      status: "uploaded", error_code: null, started_at: new Date().toISOString(), completed_at: null,
      metadata: { ...(intel.metadata || {}), attempts, retrying: true },
    }).catch(() => {});
  }
  await documentAudit(svc, user, { action: "document.retry_processing", entity_type: "DocumentVersion", entity_id: versionId, detail: { attempt: attempts } });
  return await processDocumentVersion(base44, svc, user, versionId);
}

// ---------- PHASE 17 §21: PREFILL FROM DOCUMENTS ----------
// Map a document version's (best-source) extractions to application questions
// via ApplicationQuestionDefinition.data_source. Proposes only — never writes.
export async function proposePrefill(svc: any, app: any, versionId: string): Promise<any> {
  const version: any = await svc.entities.DocumentVersion.get(versionId).catch(() => null);
  if (!version) throw Object.assign(new Error("Version not found"), { code: "NOT_FOUND" });
  const doc: any = await svc.entities.Document.get(version.document_id).catch(() => null);
  if (!doc) throw Object.assign(new Error("Document not found"), { code: "NOT_FOUND" });
  const extractions: any[] = await svc.entities.DocumentExtraction.filter({ document_version_id: versionId }).catch(() => []);
  const questions: any[] = await svc.entities.ApplicationQuestionDefinition.filter({ version: app.question_version || "visa.application.questions.v1", status: "active" }).catch(() => []);
  const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);
  const answersByCode: Record<string, any> = {};
  for (const a of answers) answersByCode[a.question_code] = a;
  const proposals: any[] = [];
  const conflicts: any[] = [];
  for (const q of questions) {
    const ds = q.data_source || {};
    if (!ds.field || !ds.document_type || ds.document_type !== doc.document_type) continue;
    const ex = bestExtraction(extractions, ds.field);
    if (!ex) continue;
    const proposed = ex.normalized_value || ex.field_value || "";
    const existing = answersByCode[q.question_code];
    const proposal = {
      question_code: q.question_code, label: q.label, field: ds.field,
      proposed_value: proposed, display_value: ex.field_value, confidence: ex.confidence,
      source_type: "DOCUMENT_EXTRACTION", document_id: doc.id, document_version_id: versionId,
      confirmed: ex.source === "user_confirmed",
      existing: existing ? { value: existing.value, source_type: existing.source_type } : null,
    };
    proposals.push(proposal);
    if (existing && existing.normalized_value && proposed && existing.normalized_value !== proposed) {
      conflicts.push({ ...proposal, existing_value: existing.value, existing_source: existing.source_type, user_sourced: existing.source_type === "USER" });
    }
  }
  return { proposals, conflicts, has_user_conflicts: conflicts.some((c) => c.user_sourced) };
}

// Apply prefill: writes answers ONLY where none exist, or where the existing
// answer is non-USER (traveler/previous) and overwrite_non_user is true. A USER
// answer is never overwritten (the traveler must resolve the conflict manually).
export async function applyPrefill(svc: any, user: any, app: any, versionId: string, opts: { question_codes?: string[]; overwrite_non_user?: boolean } = {}): Promise<any> {
  const { proposals } = await proposePrefill(svc, app, versionId);
  const wanted = opts.question_codes && opts.question_codes.length ? new Set(opts.question_codes) : null;
  const applied: any[] = [];
  const skipped: any[] = [];
  const conflicts: any[] = [];
  const now = new Date().toISOString();
  for (const p of proposals) {
    if (wanted && !wanted.has(p.question_code)) continue;
    const existing = p.existing;
    const writeNew = (normVal: string) => svc.entities.ApplicationAnswer.create({
      application_id: app.id, traveler_id: app.traveler_id, question_code: p.question_code,
      value: p.display_value || normVal, normalized_value: normVal, source_type: "DOCUMENT_EXTRACTION",
      source_id: versionId, confidence: p.confidence || 0, verified: false, active: true,
      metadata: { document_id: p.document_id, document_version_id: versionId, extracted_value: p.display_value, confirmed: p.confirmed },
    });
    const updateExisting = (row: any, normVal: string) => svc.entities.ApplicationAnswer.update(row.id, {
      value: p.display_value || normVal, normalized_value: normVal, source_type: "DOCUMENT_EXTRACTION", source_id: versionId,
      confidence: p.confidence || 0, metadata: { ...(row.metadata || {}), document_id: p.document_id, document_version_id: versionId, extracted_value: p.display_value, previous_value: row.value, conflict_flagged: true, confirmed: p.confirmed },
    });
    try {
      if (!existing) {
        await writeNew(p.proposed_value); applied.push(p.question_code);
      } else if (existing.source_type === "USER") {
        conflicts.push({ question_code: p.question_code, existing_value: existing.value, proposed_value: p.proposed_value });
      } else if (opts.overwrite_non_user) {
        await updateExisting(existing, p.proposed_value); applied.push(p.question_code);
      } else {
        skipped.push(p.question_code);
      }
    } catch (e: any) { skipped.push(p.question_code); }
  }
  await documentAudit(svc, user, { action: "document.prefill_applied", entity_type: "VisaApplication", entity_id: app.id, detail: { applied: applied.length, conflicts: conflicts.length, version_id: versionId } });
  return { applied, skipped, conflicts };
}

// ---------- PHASE 17 §24: RESOLUTION CENTER BUNDLE ----------
// One prioritized list of everything needing the traveler's attention for an app.
export async function getResolutionCenter(svc: any, user: any, app: any): Promise<any> {
  const { computeRequirementProgress } = await import("./documents.ts");
  const progress = await computeRequirementProgress(svc, app);
  const items: any[] = [];
  const link = `/applications/${app.id}/workspace`;
  for (const it of progress.items || []) {
    if (it.state === "missing") items.push({ kind: "MISSING_REQUIREMENT", severity: "HIGH", title: `${it.name} missing`, document_type: it.document_type, cta_link: `${link}?section=documents`, requirement_id: it.requirement_id });
    else if (it.state === "needs_review") items.push({ kind: "NEEDS_REVIEW", severity: "MEDIUM", title: `${it.name} needs review`, document_type: it.document_type, cta_link: `${link}?section=documents`, requirement_id: it.requirement_id });
  }
  const findings: any[] = await svc.entities.DocumentFinding.filter({ application_id: app.id, resolved: false }).catch(() => []);
  for (const f of findings) {
    if (f.blocking) items.push({ kind: "BLOCKING_FINDING", severity: f.severity, title: f.message, field: f.field, finding_id: f.id, cta_link: `${link}?section=documents` });
    else if (f.severity === "HIGH" || f.severity === "MEDIUM") items.push({ kind: "WARNING", severity: f.severity, title: f.message, field: f.field, finding_id: f.id, cta_link: `${link}?section=documents` });
  }
  const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  items.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  const counts = { total: items.length, blocking: items.filter((i) => i.kind === "BLOCKING_FINDING" || i.kind === "MISSING_REQUIREMENT").length, warnings: items.filter((i) => i.kind === "NEEDS_REVIEW" || i.kind === "WARNING").length };
  await documentAudit(svc, user, { action: "document.resolution_center_viewed", entity_type: "VisaApplication", entity_id: app.id, detail: { items: items.length } });
  return { items, counts, progress: { total: progress.total, complete: progress.complete, pending: progress.pending } };
}