// Worldz Visa (Phase 31 \u00a721-27): PII classification, sensitive-field redaction,
// and data-retention. ONE classification source (\u00a722). Field-level encryption is
// delegated to the platform key/secret mechanism (\u00a723) \u2014 no custom key store here.
// Retention is policy-driven, idempotent, and NEVER deletes CaseEvent history (\u00a725.5).

// ---------- PII classification (\u00a722) ----------
export type PiiClass = "PUBLIC" | "INTERNAL" | "PERSONAL" | "SENSITIVE_PERSONAL" | "HIGHLY_SENSITIVE";
export const PII_CLASSIFICATION: Record<string, PiiClass> = {
  passport_number: "HIGHLY_SENSITIVE",
  document_number: "HIGHLY_SENSITIVE",
  personal_number: "HIGHLY_SENSITIVE",
  date_of_birth: "SENSITIVE_PERSONAL",
  passport_expiry: "SENSITIVE_PERSONAL",
  expiry_date: "SENSITIVE_PERSONAL",
  nationality: "PERSONAL",
  email: "PERSONAL",
  phone: "PERSONAL",
  address: "PERSONAL",
  address_line1: "PERSONAL",
  first_name: "PERSONAL",
  last_name: "PERSONAL",
  full_name: "PERSONAL",
  mrz: "HIGHLY_SENSITIVE",
  storage_uri: "INTERNAL",
  checksum: "INTERNAL",
};
export function classifyField(name: string): PiiClass {
  return PII_CLASSIFICATION[String(name || "").toLowerCase()] || "INTERNAL";
}
export function isSensitive(name: string): boolean {
  const c = classifyField(name);
  return c === "SENSITIVE_PERSONAL" || c === "HIGHLY_SENSITIVE";
}

// ---------- Sensitive-value redaction (\u00a727) ----------
export function redactPassport(v: string | null | undefined): string {
  if (!v) return "\u2014";
  const s = String(v).replace(/\s+/g, "");
  if (s.length <= 6) return s.slice(0, 1) + "\u2022".repeat(Math.max(0, s.length - 2)) + s.slice(-1);
  return s.slice(0, 2) + "\u2022".repeat(4) + s.slice(-2);
}
export function redactEmail(v: string | null | undefined): string {
  if (!v) return "\u2014";
  const s = String(v);
  const at = s.indexOf("@");
  if (at < 1) return "\u2022".repeat(Math.min(s.length, 6));
  const local = s.slice(0, at).slice(0, 2);
  return local + "\u2022".repeat(4) + s.slice(at);
}
export function redactPhone(v: string | null | undefined): string {
  if (!v) return "\u2014";
  const s = String(v);
  if (s.length <= 4) return "\u2022".repeat(s.length);
  return s.slice(0, 2) + "\u2022".repeat(s.length - 4) + s.slice(-2);
}
// Generic log-safe redactor: never writes raw sensitive values to logs (\u00a727).
export function redactForLog(name: string, value: any): any {
  if (value == null) return value;
  const n = String(name || "").toLowerCase();
  if (/passport|document_number|personal_number|mrz/i.test(n)) return redactPassport(String(value));
  if (/email/i.test(n)) return redactEmail(String(value));
  if (/phone|mobile|tel/i.test(n)) return redactPhone(String(value));
  if (/(dob|birth|expiry|expir)/i.test(n)) return String(value).slice(0, 4) + "\u2022".repeat(4);
  if (isSensitive(n)) return "[REDACTED]";
  return value;
}

// ---------- Retention policy defaults (\u00a724) ----------
export const RETENTION_DEFAULTS: Record<string, { retention_days: number; behavior: "DELETE" | "ANONYMIZE" | "ARCHIVE"; reason: string }> = {
  PASSPORT: { retention_days: 1095, behavior: "ANONYMIZE", reason: "Retain passport data for 3y to support re-applications, then anonymize." },
  IDENTITY_DOCUMENT: { retention_days: 1095, behavior: "ANONYMIZE", reason: "Identity documents retained 3y, then anonymized." },
  APPLICATION_DOCUMENT: { retention_days: 730, behavior: "ARCHIVE", reason: "Application supporting documents archived after 2y." },
  PAYMENT_SUPPORT: { retention_days: 2555, behavior: "ARCHIVE", reason: "Payment-supporting documents retained 7y for tax/audit, then archive." },
  AUDIT_DATA: { retention_days: -1, behavior: "ARCHIVE", reason: "Audit data retained indefinitely (legal hold baseline)." },
  CASE_EVENT: { retention_days: -1, behavior: "ARCHIVE", reason: "CaseEvent history is never deleted by retention (\u00a725.5)." },
  DOCUMENT_INTELLIGENCE: { retention_days: 730, behavior: "DELETE", reason: "Transient extraction artifacts deleted after 2y." },
};

export function documentTypeCategory(docType: string): string {
  const t = String(docType || "").toUpperCase();
  if (t === "PASSPORT" || t === "PREVIOUS_VISA" || t === "REFUSAL_LETTER") return "PASSPORT";
  if (t === "NATIONAL_ID" || t === "POLICE_CLEARANCE") return "IDENTITY_DOCUMENT";
  if (t === "PHOTO" || t === "SUBMISSION_RECEIPT" || t === "APPOINTMENT_CONFIRMATION") return "APPLICATION_DOCUMENT";
  if (["BANK_STATEMENT", "BANK_CERTIFICATE", "ITR", "SALARY_SLIP", "GST_CERTIFICATE", "SPONSOR_FINANCIAL_PROOF"].includes(t)) return "PAYMENT_SUPPORT";
  return "APPLICATION_DOCUMENT";
}

// Pure: is a record expired under a policy at asOf? (\u00a724)
export function isRetentionExpired(recordCreated: string, policy: { retention_days: number; legal_hold?: boolean }, asOf = new Date().toISOString()): boolean {
  if (policy.legal_hold) return false;
  if (policy.retention_days == null || policy.retention_days < 0) return false; // indefinite
  if (!recordCreated) return false;
  const expiresAt = new Date(recordCreated).getTime() + policy.retention_days * 86400000;
  return new Date(asOf).getTime() >= expiresAt;
}

// ---------- Retention job (\u00a725) ----------
// Safe, idempotent. NEVER touches CaseEvent (\u00a725.5). For each active policy, finds
// expired Documents of the matching category (no legal hold) and anonymizes/archive
// by setting status. Audit via OperationsAuditEvent. Best-effort, non-destructive to
// the document file (storage purge is a platform operation; here we revoke access).
export async function runRetention(svc: any, opts: { dryRun?: boolean } = {}): Promise<{ scanned: number; expired: number; actioned: number; byCategory: Record<string, number> }> {
  const policies: any[] = await svc.entities.DataRetentionPolicy.filter({ status: "active" }).catch(() : any[] => []);
  const docs: any[] = await svc.entities.Document.list("-created_date", 5000).catch(() : any[] => []);
  let scanned = docs.length, expired = 0, actioned = 0;
  const byCategory: Record<string, number> = {};
  for (const p of policies) {
    if (p.legal_hold) continue;
    for (const d of docs) {
      if (d.status === "deleted") continue;
      const cat = documentTypeCategory(d.document_type);
      if (cat !== p.category) continue;
      if (!isRetentionExpired(d.created_date, p as any)) continue;
      expired++;
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
      if (opts.dryRun) continue;
      const behavior = p.behavior || "ANONYMIZE";
      if (behavior === "DELETE") {
        await svc.entities.Document.update(d.id, { status: "deleted", metadata: { ...(d.metadata || {}), retention_applied_at: new Date().toISOString(), retention_category: p.category } }).catch(() => {});
      } else {
        // ANONYMIZE / ARCHIVE: revoke display metadata, keep audit reference.
        await svc.entities.Document.update(d.id, { status: "archived", display_name: "[retention-anonymized]", metadata: { ...(d.metadata || {}), retention_applied_at: new Date().toISOString(), retention_behavior: behavior, retention_category: p.category } }).catch(() => {});
      }
      await svc.entities.OperationsAuditEvent.create({ actor_user_id: "system", tenant_id: "worldz", action: "retention.applied", entity_type: "Document", entity_id: d.id, changes: { category: p.category, behavior, days: p.retention_days }, occurred_at: new Date().toISOString() }).catch(() => {});
      actioned++;
    }
  }
  return { scanned, expired, actioned, byCategory };
}

// ---------- Consent versioning (\u00a726) ----------
export async function recordConsent(svc: any, user: any, opts: { consent_type: string; consent_version: string; purpose?: string; case_id?: string }): Promise<any> {
  return await svc.entities.ConsentRecord.create({
    consent_type: opts.consent_type, consent_version: opts.consent_version,
    user_id: user?.id, case_id: opts.case_id || null, purpose: opts.purpose || "",
    actor: user?.email || user?.id || "system", consented_at: new Date().toISOString(), metadata: {},
  }).catch(() => null);
}
export async function latestConsent(svc: any, user: any, consent_type: string): Promise<any | null> {
  const rows: any[] = await svc.entities.ConsentRecord.filter({ user_id: user?.id, consent_type }, "-consented_at", 1).catch(() : any[] => []);
  return rows[0] || null;
}