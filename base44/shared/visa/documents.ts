// Worldz Visa — Phase 4: Traveler Document Vault service.
// Owns documents (reusable, traveler-scoped), immutable versions, and the pinned
// application→version relationship. Reuses existing private storage (UploadPrivateFile
// returns an opaque file_uri; CreateFileSignedUrl mints a short-lived URL client-side)
// and the AuditLog entity for domain audit. AI extraction/OCR is Phase 5 — NOT here.

import { ensureTravelerForUser } from "./traveler.ts";
import { getApplication } from "./application.ts";
import { resolveRequirements } from "./requirements.ts";
import { advanceRun } from "../operations/engine.ts";
import { setApplicationLifecycle } from "./application/caseStore.ts";

// ---------- CONFIG (single source of truth) ----------
export const MAX_DOCUMENT_SIZE_MB = 10;
export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
export const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png"];
export const EXPIRING_SOON_DAYS = 30;

// ---------- DOCUMENT TYPE CATALOG (configurable; surfaced via list-document-config) ----------
export interface DocumentTypeDef { key: string; label: string; category: string; typically_expires?: boolean; }
export const DOCUMENT_TYPES: DocumentTypeDef[] = [
  { key: "PASSPORT", label: "Passport", category: "passport", typically_expires: true },
  { key: "NATIONAL_ID", label: "National ID", category: "identity" },
  { key: "PHOTO", label: "Photograph", category: "photo" },
  { key: "BANK_STATEMENT", label: "Bank Statement", category: "financial" },
  { key: "BANK_CERTIFICATE", label: "Bank Certificate", category: "financial" },
  { key: "ITR", label: "Income Tax Return", category: "financial" },
  { key: "SALARY_SLIP", label: "Salary Slip", category: "financial" },
  { key: "EMPLOYMENT_LETTER", label: "Employment Letter", category: "employment" },
  { key: "NOC", label: "No Objection Certificate", category: "employment" },
  { key: "BUSINESS_REGISTRATION", label: "Business Registration", category: "employment" },
  { key: "GST_CERTIFICATE", label: "GST Certificate", category: "financial" },
  { key: "EDUCATION_DOCUMENT", label: "Education Document", category: "education" },
  { key: "ADMISSION_LETTER", label: "Admission Letter", category: "education" },
  { key: "TRAVEL_INSURANCE", label: "Travel Insurance", category: "insurance", typically_expires: true },
  { key: "FLIGHT_ITINERARY", label: "Flight Itinerary", category: "travel" },
  { key: "HOTEL_BOOKING", label: "Hotel Booking", category: "accommodation" },
  { key: "INVITATION_LETTER", label: "Invitation Letter", category: "invitation" },
  { key: "SPONSOR_LETTER", label: "Sponsor Letter", category: "invitation" },
  { key: "SPONSOR_FINANCIAL_PROOF", label: "Sponsor Financial Proof", category: "financial" },
  { key: "PREVIOUS_VISA", label: "Previous / Supporting Visa", category: "passport", typically_expires: true },
  { key: "RESIDENCE_PERMIT", label: "Residence Permit", category: "passport", typically_expires: true },
  { key: "REFUSAL_LETTER", label: "Refusal Letter", category: "passport" },
  { key: "POLICE_CLEARANCE", label: "Police Clearance", category: "identity" },
  { key: "OTHER", label: "Other", category: "other" },
  { key: "SUBMISSION_RECEIPT", label: "Submission Receipt", category: "receipt" },
  { key: "APPOINTMENT_CONFIRMATION", label: "Appointment Confirmation", category: "receipt" },
];

export const CATEGORY_TO_TYPES: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const t of DOCUMENT_TYPES) (m[t.category] = m[t.category] || []).push(t.key);
  return m;
})();

// Phase 2 pins document requirements on VisaRequirement.document_category. Those
// strings (pluralized / variant) do not always uppercase to a catalog key, so this
// crosswalk is the single authority for requirement→catalog-type resolution.
export const DOCUMENT_CATEGORY_TO_TYPES: Record<string, string[]> = {
  passport: ["PASSPORT"], national_id: ["NATIONAL_ID"], photograph: ["PHOTO"], photo: ["PHOTO"],
  bank_statement: ["BANK_STATEMENT"], bank_statements: ["BANK_STATEMENT"], bank_certificate: ["BANK_CERTIFICATE"],
  itr: ["ITR"], income_tax_return: ["ITR"], salary_slip: ["SALARY_SLIP"], employment_letter: ["EMPLOYMENT_LETTER"],
  noc: ["NOC"], business_registration: ["BUSINESS_REGISTRATION"], gst_certificate: ["GST_CERTIFICATE"],
  education_document: ["EDUCATION_DOCUMENT"], education_documents: ["EDUCATION_DOCUMENT"], admission_letter: ["ADMISSION_LETTER"],
  travel_insurance: ["TRAVEL_INSURANCE"], insurance: ["TRAVEL_INSURANCE"], flight_itinerary: ["FLIGHT_ITINERARY"], flight: ["FLIGHT_ITINERARY"],
  accommodation: ["HOTEL_BOOKING"], accommodation_proof: ["HOTEL_BOOKING"], hotel_booking: ["HOTEL_BOOKING"],
  invitation_letter: ["INVITATION_LETTER"], sponsor_letter: ["SPONSOR_LETTER"], sponsor_financial_proof: ["SPONSOR_FINANCIAL_PROOF"],
  previous_visa: ["PREVIOUS_VISA"], supporting_visa: ["PREVIOUS_VISA", "RESIDENCE_PERMIT"], residence_permit: ["RESIDENCE_PERMIT"], refusal_letter: ["REFUSAL_LETTER"], police_clearance: ["POLICE_CLEARANCE"], police_clearance_certificate: ["POLICE_CLEARANCE"],
  other: ["OTHER"],
};

export function documentTypeByKey(key: string): DocumentTypeDef | undefined {
  return DOCUMENT_TYPES.find((t) => t.key === key);
}

export function getDocumentConfig() {
  return { max_size_mb: MAX_DOCUMENT_SIZE_MB, allowed_mime: ALLOWED_MIME, allowed_ext: ALLOWED_EXT, expiring_soon_days: EXPIRING_SOON_DAYS, document_types: DOCUMENT_TYPES };
}

// ---------- VALIDATION (file envelope only — NOT content; Phase 5 owns content) ----------
export function validateFileEnvelope(opts: { mime_type: string; file_size: number; ext?: string }): { valid: boolean; findings: { code: string; message: string }[] } {
  const findings: { code: string; message: string }[] = [];
  if (!ALLOWED_MIME.includes((opts.mime_type || "").toLowerCase())) findings.push({ code: "UNSUPPORTED_MIME", message: `MIME type ${opts.mime_type} is not allowed` });
  if (opts.ext && !ALLOWED_EXT.includes(opts.ext.toLowerCase())) findings.push({ code: "UNSUPPORTED_EXT", message: `Extension .${opts.ext} is not allowed` });
  if (!opts.file_size || opts.file_size <= 0) findings.push({ code: "EMPTY_FILE", message: "File is empty" });
  if (opts.file_size > MAX_DOCUMENT_SIZE_MB * 1024 * 1024) findings.push({ code: "FILE_TOO_LARGE", message: `File exceeds ${MAX_DOCUMENT_SIZE_MB}MB` });
  return { valid: !findings.length, findings };
}

// ---------- EXPIRY ----------
export type ExpiryStatus = "valid" | "expiring_soon" | "expired" | "unknown";
export function expiryStatus(doc: any): ExpiryStatus {
  if (!doc || !doc.expires_at) return "unknown";
  const exp = new Date(doc.expires_at).getTime();
  if (Number.isNaN(exp)) return "unknown";
  const now = Date.now();
  if (exp < now) return "expired";
  if (exp - now < EXPIRING_SOON_DAYS * 86400000) return "expiring_soon";
  return "valid";
}

// ---------- AUDIT (domain-level; reuses AuditLog entity; never logs content) ----------
export async function documentAudit(svc: any, user: any, opts: { action: string; entity_type: string; entity_id: string; application_id?: string; detail?: any }): Promise<void> {
  try {
    await svc.entities.AuditLog.create({ tenant_id: "worldz", actor_user_id: user?.id || "system", action: opts.action, entity_type: opts.entity_type, entity_id: opts.entity_id, changes: { application_id: opts.application_id || null, ...(opts.detail || {}) }, occurred_at: new Date().toISOString() });
  } catch (e) { console.error("documentAudit failed", e?.message || e); }
}

// ---------- ACCESS ----------
export function assertOwner(obj: any, user: any): void {
  if (user?.role === "admin") return;
  if (!obj || obj.created_by_id !== user?.id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
}
// Travelers are created via the service role, so created_by_id is the service
// account — ownership is the traveler's user_id, not created_by_id.
export function assertTravelerOwner(tr: any, user: any): void {
  if (user?.role === "admin") return;
  if (!tr || (tr.user_id && tr.user_id !== user?.id)) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
}

// ---------- DOCUMENT CRUD ----------
async function nextVersionNumber(svc: any, documentId: string): Promise<number> {
  const rows: any[] = await svc.entities.DocumentVersion.filter({ document_id: documentId }).catch(() => []);
  return (rows || []).reduce((m, r) => Math.max(m, r.version_number || 0), 0) + 1;
}

export async function createDocument(svc: any, user: any, opts: {
  traveler_id: string; document_type: string; display_name: string; storage_uri: string; mime_type: string; file_size: number; checksum?: string; issued_at?: string; expires_at?: string; organization_id?: string; metadata?: Record<string, any>;
}): Promise<{ document: any; version: any }> {
  if (!documentTypeByKey(opts.document_type)) throw Object.assign(new Error("Unsupported document_type"), { code: "BAD_TYPE" });
  if (opts.traveler_id) {
    const tr: any = await svc.entities.Traveler.get(opts.traveler_id).catch(() => null);
    if (!tr) throw Object.assign(new Error("Traveler not found"), { code: "NOT_FOUND" });
    assertTravelerOwner(tr, user);
  }
  const v = validateFileEnvelope({ mime_type: opts.mime_type, file_size: opts.file_size });
  if (!v.valid) throw Object.assign(new Error(v.findings[0].message), { code: v.findings[0].code });

  const doc: any = await svc.entities.Document.create({
    traveler_id: opts.traveler_id, organization_id: opts.organization_id || null,
    document_type: opts.document_type, display_name: opts.display_name,
    status: "active", issued_at: opts.issued_at || null, expires_at: opts.expires_at || null, metadata: opts.metadata || {},
  });
  const versionNumber = await nextVersionNumber(svc, doc.id);
  const ver: any = await svc.entities.DocumentVersion.create({
    document_id: doc.id, traveler_id: opts.traveler_id, version_number: versionNumber,
    storage_uri: opts.storage_uri, mime_type: opts.mime_type, file_size: opts.file_size,
    checksum: opts.checksum || null, status: "available", uploaded_by: user?.id || "system", metadata: opts.metadata || {},
  });
  await svc.entities.Document.update(doc.id, { current_version_id: ver.id });
  await documentAudit(svc, user, { action: "document.created", entity_type: "Document", entity_id: doc.id, detail: { document_type: opts.document_type } });
  await documentAudit(svc, user, { action: "document.version_created", entity_type: "DocumentVersion", entity_id: ver.id, detail: { document_id: doc.id, version_number: versionNumber, file_size: opts.file_size } });
  return { document: { ...doc, current_version_id: ver.id }, version: ver };
}

export async function replaceDocument(svc: any, user: any, opts: {
  document_id: string; storage_uri: string; mime_type: string; file_size: number; checksum?: string; expires_at?: string;
  source_version_id?: string; derivative_kind?: "ENHANCED_SCAN"; transformation?: Record<string, any>;
}): Promise<{ document: any; version: any }> {
  const doc: any = await svc.entities.Document.get(opts.document_id).catch(() => null);
  if (!doc) throw Object.assign(new Error("Document not found"), { code: "NOT_FOUND" });
  assertOwner(doc, user);
  const v = validateFileEnvelope({ mime_type: opts.mime_type, file_size: opts.file_size });
  if (!v.valid) throw Object.assign(new Error(v.findings[0].message), { code: v.findings[0].code });
  const versionNumber = await nextVersionNumber(svc, doc.id);
  const ver: any = await svc.entities.DocumentVersion.create({
    document_id: doc.id, traveler_id: doc.traveler_id, version_number: versionNumber,
    storage_uri: opts.storage_uri, mime_type: opts.mime_type, file_size: opts.file_size,
    checksum: opts.checksum || null, status: "available", uploaded_by: user?.id || "system",
    source_version_id: opts.source_version_id || null, derivative_kind: opts.derivative_kind || null,
    transformation: opts.transformation || null,
    metadata: opts.source_version_id ? { provenance: { source_version_id: opts.source_version_id, derivative_kind: opts.derivative_kind || "ENHANCED_SCAN", transformation: opts.transformation || {}, created_at: new Date().toISOString() } } : {},
  });
  // SUPERSEDE the previous current version — never mutate content, only status.
  if (doc.current_version_id) await svc.entities.DocumentVersion.update(doc.current_version_id, { status: "superseded" }).catch(() => {});
  await svc.entities.Document.update(doc.id, { current_version_id: ver.id, expires_at: opts.expires_at || doc.expires_at });
  await documentAudit(svc, user, { action: opts.source_version_id ? "document.derivative_created" : "document.version_created", entity_type: "DocumentVersion", entity_id: ver.id, detail: { document_id: doc.id, version_number: versionNumber, source_version_id: opts.source_version_id || null, derivative_kind: opts.derivative_kind || null, transformation: opts.transformation || null } });
  await documentAudit(svc, user, { action: "document.replaced", entity_type: "Document", entity_id: doc.id, detail: { new_version_id: ver.id } });
  return { document: await svc.entities.Document.get(doc.id), version: ver };
}

export async function listTravelerDocuments(svc: any, user: any, travelerId?: string): Promise<any[]> {
  let traveler_id = travelerId;
  if (!traveler_id) {
    const tr = await ensureTravelerForUser(svc, user);
    traveler_id = tr.id;
  } else {
    const tr: any = await svc.entities.Traveler.get(traveler_id).catch(() => null);
    if (tr) assertTravelerOwner(tr, user);
  }
  const docs: any[] = await svc.entities.Document.filter({ traveler_id }).catch(() => []);
  const out: any[] = [];
  for (const d of docs) {
    if (d.status === "deleted") continue;
    let current: any = null;
    if (d.current_version_id) current = await svc.entities.DocumentVersion.get(d.current_version_id).catch(() => null);
    const usage = await svc.entities.ApplicationDocument.filter({ document_id: d.id }).catch(() => []);
    out.push({
      id: d.id, document_type: d.document_type, display_name: d.display_name, status: d.status,
      issued_at: d.issued_at, expires_at: d.expires_at, current_version_id: d.current_version_id,
      current_version: current ? { id: current.id, version_number: current.version_number, mime_type: current.mime_type, file_size: current.file_size, status: current.status, storage_uri: current.storage_uri, created_date: current.created_date } : null,
      expiry_status: expiryStatus(d), usage_count: (usage || []).length,
    });
  }
  return out.sort((a, b) => String(b.current_version?.created_date || "").localeCompare(String(a.current_version?.created_date || "")));
}

export async function getDocument(svc: any, user: any, documentId: string): Promise<any> {
  const doc: any = await svc.entities.Document.get(documentId).catch(() => null);
  if (!doc) throw Object.assign(new Error("Document not found"), { code: "NOT_FOUND" });
  assertOwner(doc, user);
  const versions: any[] = await svc.entities.DocumentVersion.filter({ document_id: documentId }).catch(() => []);
  versions.sort((a, b) => (b.version_number || 0) - (a.version_number || 0));
  await documentAudit(svc, user, { action: "document.viewed", entity_type: "Document", entity_id: doc.id });
  return {
    id: doc.id, traveler_id: doc.traveler_id, document_type: doc.document_type, display_name: doc.display_name,
    status: doc.status, issued_at: doc.issued_at, expires_at: doc.expires_at, current_version_id: doc.current_version_id,
    expiry_status: expiryStatus(doc),
    versions: versions.map((v) => ({ id: v.id, version_number: v.version_number, mime_type: v.mime_type, file_size: v.file_size, status: v.status, checksum: v.checksum, storage_uri: v.storage_uri, created_date: v.created_date })),
  };
}

// Soft delete: if referenced by an active application, archive (never break audit). Else archive + mark version deleted.
export async function deleteDocument(svc: any, user: any, documentId: string): Promise<any> {
  const doc: any = await svc.entities.Document.get(documentId).catch(() => null);
  if (!doc) throw Object.assign(new Error("Document not found"), { code: "NOT_FOUND" });
  assertOwner(doc, user);
  const refs: any[] = await svc.entities.ApplicationDocument.filter({ document_id: documentId, status: "attached" }).catch(() => []);
  if (refs.length) {
    await svc.entities.Document.update(documentId, { status: "archived", metadata: { ...(doc.metadata || {}), marked_for_deletion_at: new Date().toISOString() } });
    await documentAudit(svc, user, { action: "document.deleted", entity_type: "Document", entity_id: documentId, detail: { soft: true, active_references: refs.length } });
    return { id: documentId, status: "archived", soft: true };
  }
  await svc.entities.Document.update(documentId, { status: "deleted" });
  if (doc.current_version_id) await svc.entities.DocumentVersion.update(doc.current_version_id, { status: "deleted" }).catch(() => {});
  await documentAudit(svc, user, { action: "document.deleted", entity_type: "Document", entity_id: documentId, detail: { soft: false } });
  return { id: documentId, status: "deleted", soft: false };
}

// ---------- REUSE MATCHING ----------
export async function findReusableDocuments(svc: any, user: any, opts: { traveler_id: string; document_type?: string; category?: string }): Promise<any[]> {
  const list = await listTravelerDocuments(svc, user, opts.traveler_id);
  const wanted = new Set<string>(opts.document_type ? [opts.document_type] : (opts.category ? (CATEGORY_TO_TYPES[opts.category] || []) : []));
  return list.filter((d) => {
    if (d.status !== "active") return false;
    if (wanted.size && !wanted.has(d.document_type)) return false;
    return true;
  });
}

// ---------- REQUIREMENT PROGRESS ----------
export async function computeRequirementProgress(svc: any, app: any): Promise<any> {
  const graph = await resolveRequirements(svc, app.destination, app.purpose).catch(() => null);
  // Document requirements are the VisaRequirement rows that carry a document_category
  // (Phase 2 pins them per route). Skip non-document rows (biometrics: document_category=null).
  const reqs = ((graph?.requirements) || []).filter((r: any) => r.document_category && (r.mandatory_level === "mandatory" || r.mandatory_level === "conditional"));
  const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
  const byType: Record<string, any> = {};
  for (const a of attachments) if (a.status !== "detached") byType[a.document_type] = a;
  const items = await Promise.all(reqs.map(async (r: any) => {
    const types = DOCUMENT_CATEGORY_TO_TYPES[String(r.document_category).toLowerCase()] || [String(r.document_category).toUpperCase()];
    const matched = types.map((t: string) => byType[t]).filter(Boolean)[0] || null;
    // Phase 5: resolve the pinned version's intelligence state + blocking findings
    // for this application, so the UI distinguishes missing/uploaded/processing/
    // needs_review/verified. A requirement is "satisfied" only at verified.
    let intelligence: any = null;
    let state: "missing" | "uploaded" | "processing" | "needs_review" | "verified" = matched ? "uploaded" : "missing";
    let blockingForApp = 0;
    if (matched && matched.document_version_id) {
      const intelRows: any[] = await svc.entities.DocumentIntelligence.filter({ document_version_id: matched.document_version_id }).catch(() => []);
      intelligence = intelRows[0] || null;
      const appFindings: any[] = await svc.entities.DocumentFinding.filter({ document_version_id: matched.document_version_id, application_id: app.id, resolved: false, blocking: true }).catch(() => []);
      blockingForApp = appFindings.length;
      if (intelligence) {
        if (intelligence.status === "ready") state = blockingForApp ? "needs_review" : "verified";
        else if (intelligence.status === "needs_review" || intelligence.status === "processing_failed") state = "needs_review";
        else if (intelligence.status === "classifying" || intelligence.status === "extracting" || intelligence.status === "validating" || intelligence.status === "uploaded") state = "processing";
        else state = "uploaded";
      }
    }
    return { requirement_id: r.id, name: r.title, document_type: types[0], document_category: r.document_category, mandatory_level: r.mandatory_level, document_types: types, matched: !!matched, state, verified: state === "verified", application_document: matched, _intelligence: intelligence, _blocking_findings_for_app: blockingForApp };
  }));
  const complete = items.filter((i) => i.state === "verified").length;
  const total = items.length || 0;
  return { total, complete, pending: total - complete, progress: total ? Math.round((complete / total) * 100) : 0, items, attachments_by_type: byType };
}

// ---------- VALIDATE FOR APPLICATION (basic envelope; Phase 5 enriches) ----------
export async function validateDocumentForApplication(svc: any, user: any, opts: { application_id: string; document_id: string; document_version_id?: string }): Promise<{ valid: boolean; findings: any[] }> {
  const findings: any[] = [];
  const app = await getApplication(svc, user, opts.application_id).catch(() => null);
  if (!app) findings.push({ code: "APP_NOT_FOUND", message: "Application not found" });
  const doc: any = await svc.entities.Document.get(opts.document_id).catch(() => null);
  if (!doc) findings.push({ code: "DOC_NOT_FOUND", message: "Document not found" });
  else {
    assertOwner(doc, user);
    if (doc.status === "deleted") findings.push({ code: "DOC_DELETED", message: "Document is deleted" });
    if (doc.status === "archived") findings.push({ code: "DOC_ARCHIVED", message: "Document is archived" });
  }
  let versionId = opts.document_version_id || doc?.current_version_id;
  let version: any = null;
  if (versionId) {
    version = await svc.entities.DocumentVersion.get(versionId).catch(() => null);
    if (!version || version.document_id !== opts.document_id) findings.push({ code: "VERSION_MISMATCH", message: "Version does not belong to document" });
    else if (version.status !== "available") findings.push({ code: "VERSION_UNAVAILABLE", message: `Version is ${version.status}` });
  } else findings.push({ code: "NO_VERSION", message: "No version available" });
  // Basic expiry (vault-level) — NOT route-specific (Phase 5 owns route validity).
  if (doc && expiryStatus(doc) === "expired") findings.push({ code: "EXPIRED", message: "Document is expired" });
  return { valid: !findings.length, findings, document: doc, version, application: app };
}

// ---------- ATTACH (pin exact version) + completion signal ----------
export async function attachDocumentToApplication(svc: any, user: any, opts: {
  application_id: string; document_id: string; document_version_id?: string; requirement_id?: string;
}): Promise<any> {
  const validation = await validateDocumentForApplication(svc, user, opts);
  if (!validation.valid) throw Object.assign(new Error(validation.findings[0].message), { code: validation.findings[0].code });

  const doc = validation.document, version = validation.version, app = validation.application;
  const types = CATEGORY_TO_TYPES[(requirementCategoryFromApp(svc, app))?.[0]] || [];
  // If a requirement_id is given, confirm the document_type matches that VisaRequirement's
  // document_category (uppercased). The requirement is the Phase 2 VisaRequirement row.
  if (opts.requirement_id) {
    const req: any = await svc.entities.VisaRequirement.get(opts.requirement_id).catch(() => null);
    if (req && req.document_category) {
      const expected = DOCUMENT_CATEGORY_TO_TYPES[String(req.document_category).toLowerCase()] || [String(req.document_category).toUpperCase()];
      if (expected.length && !expected.includes(doc.document_type)) throw Object.assign(new Error(`Document type ${doc.document_type} does not satisfy requirement ${req.document_category}`), { code: "TYPE_MISMATCH" });
    }
  }

  // Upsert: one ApplicationDocument per (application, requirement or document_type).
  const query = opts.requirement_id ? { application_id: app.id, requirement_id: opts.requirement_id } : { application_id: app.id, document_type: doc.document_type };
  const existing: any[] = await svc.entities.ApplicationDocument.filter(query).catch(() => []);
  const now = new Date().toISOString();
  const payload: any = {
    application_id: app.id, document_id: doc.id, document_version_id: version.id,
    requirement_id: opts.requirement_id || null, document_type: doc.document_type,
    status: "attached", is_required: true, submitted_at: now, verified_at: null,
    metadata: { version_number: version.version_number, display_name: doc.display_name },
  };
  let applicationDocument: any;
  if (existing.length) {
    applicationDocument = await svc.entities.ApplicationDocument.update(existing[0].id, { ...payload, detached_at: null }).catch(async () => { return await svc.entities.ApplicationDocument.create(payload); });
    await documentAudit(svc, user, { action: "document.replaced", entity_type: "ApplicationDocument", entity_id: existing[0].id, application_id: app.id, detail: { pinned_version: version.id } });
  } else {
    applicationDocument = await svc.entities.ApplicationDocument.create(payload);
    await documentAudit(svc, user, { action: "document.attached", entity_type: "ApplicationDocument", entity_id: applicationDocument.id, application_id: app.id, detail: { document_type: doc.document_type, pinned_version_id: version.id, version_number: version.version_number } });
  }
  await documentAudit(svc, user, { action: "document.version_pinned", entity_type: "DocumentVersion", entity_id: version.id, application_id: app.id, detail: { document_id: doc.id } });

  const progress = await computeRequirementProgress(svc, app);
  // When all mandatory requirements are verified, move only to document review.
  // READY_FOR_SUBMISSION is reserved for the explicit final-review transition after
  // traveler confirmation; document completion must never bypass that boundary.
  if (progress.total > 0 && progress.pending === 0) {
    // Phase 31 \u00a73/\u00a75: route through the case engine \u2014 status is derived from case_state.
    await setApplicationLifecycle(svc, app, "document_review", { source: "document_vault", actor_id: user?.id || "system" }).catch(() => {});
    await completeDocumentRequirementSignal(svc, user, app);
  }
  return { application_document: applicationDocument, progress };
}

// Best-effort orchestrator unlock: if the bound run still has a collect_documents
// task pending/awaiting/blocked, mark it completed and advance. No-op when already
// done — the orchestrator remains the sole owner of task state.
async function completeDocumentRequirementSignal(svc: any, user: any, app: any): Promise<void> {
  if (!app.run_id) return;
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: app.run_id }).catch(() => []);
  const collect = tasks.find((t) => t.task_key === "collect_documents");
  if (collect && ["pending", "ready", "awaiting_approval", "blocked", "retrying"].includes(collect.status)) {
    await svc.entities.LaunchTask.update(collect.id, { status: "completed", output: { via: "document_vault", completed_at: new Date().toISOString() }, completed_at: new Date().toISOString() }).catch(() => {});
    const actor = (user && (user.full_name || user.email)) || (user && user.id) || "system";
    await advanceRun(svc, { runId: app.run_id, actor }).catch(() => {});
  }
}

// Helper: requirement categories available for an application (from its pinned graph).
function requirementCategoryFromApp(_svc: any, app: any): string[] | null {
  // Not used for validation directly; kept for future per-requirement UI.
  return null;
}

export async function detachDocument(svc: any, user: any, opts: { application_id: string; application_document_id: string }): Promise<any> {
  const app = await getApplication(svc, user, opts.application_id).catch(() => null);
  if (!app) throw Object.assign(new Error("Application not found"), { code: "NOT_FOUND" });
  const ad: any = await svc.entities.ApplicationDocument.get(opts.application_document_id).catch(() => null);
  if (!ad || ad.application_id !== app.id) throw Object.assign(new Error("ApplicationDocument not found"), { code: "NOT_FOUND" });
  await svc.entities.ApplicationDocument.update(ad.id, { status: "detached", detached_at: new Date().toISOString() });
  await documentAudit(svc, user, { action: "document.detached", entity_type: "ApplicationDocument", entity_id: ad.id, application_id: app.id });
  const progress = await computeRequirementProgress(svc, app);
  return { progress };
}

export async function listApplicationDocuments(svc: any, user: any, applicationId: string): Promise<any> {
  const app = await getApplication(svc, user, applicationId).catch(() => null);
  if (!app) throw Object.assign(new Error("Application not found"), { code: "NOT_FOUND" });
  const progress = await computeRequirementProgress(svc, app);
  const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: applicationId }).catch(() => []);
  const enriched = [];
  for (const a of attachments) {
    if (a.status === "detached") continue;
    const doc: any = await svc.entities.Document.get(a.document_id).catch(() => null);
    const ver: any = await svc.entities.DocumentVersion.get(a.document_version_id).catch(() => null);
    enriched.push({ ...a, document: doc ? { display_name: doc.display_name, document_type: doc.document_type, expires_at: doc.expires_at, expiry_status: expiryStatus(doc) } : null, version: ver ? { version_number: ver.version_number, mime_type: ver.mime_type, file_size: ver.file_size, storage_uri: ver.storage_uri } : null });
  }
  return { application: { id: app.id, status: app.status, current_step: app.current_step, traveler_id: app.traveler_id, destination: app.destination, purpose: app.purpose }, progress, attachments: enriched };
}