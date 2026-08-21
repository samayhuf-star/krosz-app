// Worldz Visa (Phase 13) — seed the ReviewRule catalog (admin visibility + versioning).
// The engine implements rules in code; these rows surface them for the operator UI.
export const RULE_DEFS = [
  { rule_code: "APPLICATION_INFORMATION_INCOMPLETE", version: "v1", type: "COMPLETENESS", category: "Application", severity: "BLOCKING", title: "Application information incomplete", description: "Required application answers are missing." },
  { rule_code: "DOCUMENT_REQUIRED", version: "v1", type: "DOCUMENT", category: "Documents", severity: "BLOCKING", title: "Document required", description: "A mandatory document is missing." },
  { rule_code: "DOCUMENT_TYPE", version: "v1", type: "DOCUMENT", category: "Documents", severity: "BLOCKING", title: "Wrong document type", description: "Attached document does not match the requirement." },
  { rule_code: "IDENTITY_NAME", version: "v1", type: "IDENTITY", category: "Identity", severity: "BLOCKING", title: "Identity mismatch", description: "Name differs across passport/application/form." },
  { rule_code: "PASSPORT_NUMBER", version: "v1", type: "IDENTITY", category: "Identity", severity: "BLOCKING", title: "Passport number mismatch", description: "Passport number differs across sources." },
  { rule_code: "DATE_OF_BIRTH", version: "v1", type: "IDENTITY", category: "Identity", severity: "CRITICAL", title: "Date of birth mismatch", description: "DOB differs across sources." },
  { rule_code: "NATIONALITY", version: "v1", type: "IDENTITY", category: "Identity", severity: "CRITICAL", title: "Nationality mismatch", description: "Nationality differs across sources." },
  { rule_code: "PASSPORT_EXPIRY", version: "v1", type: "DATE", category: "Documents", severity: "BLOCKING", title: "Passport validity", description: "Passport may not meet route validity threshold." },
  { rule_code: "FORM_STALE", version: "v1", type: "FORM", category: "Forms", severity: "BLOCKING", title: "Form out of date", description: "Generated form is stale." },
  { rule_code: "PACKAGE_STALE", version: "v1", type: "SUBMISSION", category: "Submission", severity: "BLOCKING", title: "Package out of date", description: "Submission package is stale." },
  { rule_code: "PACKAGE_HASH", version: "v1", type: "SUBMISSION", category: "Submission", severity: "BLOCKING", title: "Package integrity", description: "Package hash mismatch." },
  { rule_code: "PAYMENT_REQUIRED", version: "v1", type: "PAYMENT", category: "Payment", severity: "BLOCKING", title: "Payment required", description: "Payment required before submission." },
  { rule_code: "APPOINTMENT_REQUIRED", version: "v1", type: "APPOINTMENT", category: "Appointments", severity: "BLOCKING", title: "Appointment required", description: "Appointment required before submission." },
  { rule_code: "SUBMISSION_PROVIDER", version: "v1", type: "SUBMISSION", category: "Submission", severity: "BLOCKING", title: "No submission provider", description: "Could not resolve a submission provider." },
  { rule_code: "TRAVEL_DATE", version: "v1", type: "TRAVEL", category: "Travel", severity: "BLOCKING", title: "Travel dates inconsistent", description: "Return date before departure." },
];

export async function ensureReviewCatalog(svc: any): Promise<{ rules: number }> {
  let rules = 0;
  for (const r of RULE_DEFS) {
    const existing: any = (await svc.entities.ReviewRule.filter({ rule_code: r.rule_code, version: r.version }).catch(() => []))[0];
    const row: any = { ...r, enabled: true, status: "ACTIVE", scope: {}, metadata: {} };
    if (existing) await svc.entities.ReviewRule.update(existing.id, row).catch(() => {});
    else await svc.entities.ReviewRule.create(row).catch(() => {});
    rules++;
  }
  return { rules };
}