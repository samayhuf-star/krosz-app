import { base44 } from "@/api/base44Client";

// Worldz Visa (Phase 29) — Admin Case Management API client. All mutations go
// through the Phase 27 Application Case Engine on the backend; the admin UI
// never mutates case state directly.
async function invoke(payload) {
  const res = await base44.functions.invoke("applicationCaseApi", payload);
  return res?.data ?? res;
}

export const adminCaseList = (p = {}) => invoke({ action: "admin-case-list", ...p });
export const adminCaseDetail = (id) => invoke({ action: "admin-case-detail", id });
export const adminAllowedTransitions = (id) => invoke({ action: "admin-case-allowed-transitions", id });
export const adminCaseTransition = (p) => invoke({ action: "admin-case-transition", ...p });
export const adminCaseAssign = (p) => invoke({ action: "admin-case-assign", ...p });
export const adminReviewDecision = (p) => invoke({ action: "admin-review-decision", ...p });
export const adminDocumentDecision = (p) => invoke({ action: "admin-document-decision", ...p });
export const adminInternalNoteCreate = (p) => invoke({ action: "admin-internal-note-create", ...p });
export const adminInternalNoteList = (id) => invoke({ action: "admin-internal-note-list", id });
export const adminExceptionUpdate = (p) => invoke({ action: "admin-exception-update", ...p });
export const adminCasePrioritySet = (p) => invoke({ action: "admin-case-priority-set", ...p });
export const adminTimeline = (id, filter) => invoke({ action: "admin-timeline", id, filter });
export const adminAuditLog = (id) => invoke({ action: "admin-audit-log", id });
export const adminExceptionList = (p = {}) => invoke({ action: "admin-exception-list", ...p });
export const adminExport = (p = {}) => invoke({ action: "admin-export", ...p });