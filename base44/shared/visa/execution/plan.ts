// Worldz Visa (Phase 11) — Execution Plan generator (§6).
//
// A deterministic, pinned plan is generated from the GovernmentFormDefinition +
// SubmissionPackage items + the PortalWorkflow steps + provider strategy. It
// is NEVER invented by an LLM at runtime (§6). The plan pins the package hash +
// portal workflow version; a workflow change produces a new plan version while
// existing executions stay pinned to the old one (§7).

import type { Checkpoint, ExecutionStrategy } from "./types.ts";

export interface PlannedStep {
  key: string;        // workflow step key (OPEN_PORTAL, FILL_IDENTITY, ... SUBMIT, CAPTURE_RECEIPT).
  order: number;
  capability: string;
  field_codes?: string[];
  document_types?: string[];
  checkpoint: Checkpoint;
}

const CHECKPOINT_BY_KEY: Record<string, Checkpoint> = {
  OPEN_PORTAL: "PORTAL_OPENED",
  CREATE_APPLICATION: "APPLICATION_CREATED",
  FILL_IDENTITY: "IDENTITY_COMPLETED",
  FILL_TRAVEL: "TRAVEL_COMPLETED",
  UPLOAD_PASSPORT: "DOCUMENTS_UPLOADED",
  UPLOAD_PHOTO: "DOCUMENTS_UPLOADED",
  UPLOAD_DOCS: "DOCUMENTS_UPLOADED",
  REVIEW: "REVIEW_READY",
  SUBMIT: "SUBMITTED",
  CAPTURE_RECEIPT: "RECEIPT_CAPTURED",
};

const CAP_BY_KEY: Record<string, string> = {
  OPEN_PORTAL: "BROWSER_NAVIGATION",
  CREATE_APPLICATION: "BROWSER_NAVIGATION",
  AUTHENTICATE: "HUMAN_HANDOFF",
  FILL_IDENTITY: "FORM_FILLING",
  FILL_PASSPORT: "FORM_FILLING",
  FILL_TRAVEL: "FORM_FILLING",
  FILL_CONTACT: "FORM_FILLING",
  UPLOAD_PASSPORT: "DOCUMENT_UPLOAD",
  UPLOAD_PHOTO: "DOCUMENT_UPLOAD",
  UPLOAD_DOCS: "DOCUMENT_UPLOAD",
  REVIEW: "BROWSER_NAVIGATION",
  SUBMIT: "EXTERNAL_SUBMISSION",
  CAPTURE_RECEIPT: "RECEIPT_CAPTURE",
};

// Build the plan steps from the portal workflow's declared steps. For API
// strategies, a single SUBMIT step is sufficient (the provider adapter drives
// the whole round-trip in one shot). For MANUAL, only an OPEN + SUBMIT-gate
// (operator-driven) exists.
export function generateExecutionPlan(input: {
  workflow: any;
  packageItems: any[];
  formFields: any[];
  strategy: ExecutionStrategy;
  packageHash: string;
  portalWorkflowId: string;
  portalWorkflowVersion: string;
}): { steps: PlannedStep[] } {
  const steps: PlannedStep[] = [];
  if (input.strategy === "API") {
    steps.push({
      key: "SUBMIT", order: 1, capability: "EXTERNAL_SUBMISSION",
      checkpoint: "SUBMITTED",
    });
    steps.push({ key: "CAPTURE_RECEIPT", order: 2, capability: "RECEIPT_CAPTURE", checkpoint: "RECEIPT_CAPTURED" });
    return { steps };
  }
  if (input.strategy === "MANUAL" || input.strategy === "HUMAN_ASSISTED") {
    steps.push({ key: "OPEN_PORTAL", order: 1, capability: "BROWSER_NAVIGATION", checkpoint: "PORTAL_OPENED" });
    steps.push({ key: "SUBMIT", order: 2, capability: "EXTERNAL_SUBMISSION", checkpoint: "SUBMITTED" });
    steps.push({ key: "CAPTURE_RECEIPT", order: 3, capability: "RECEIPT_CAPTURE", checkpoint: "RECEIPT_CAPTURED" });
    return { steps };
  }
  // BROWSER_AUTOMATION: derive from the workflow's declared step list.
  const wfSteps: any[] = input.workflow?.steps || [];
  const list = wfSteps.length ? wfSteps : DEFAULT_BROWSER_STEPS;
  list.forEach((s: any, i: number) => {
    const key = String(s.key);
    steps.push({
      key, order: i + 1, capability: CAP_BY_KEY[key] || "BROWSER_NAVIGATION",
      field_codes: s.field_codes || fieldCodesFor(key, input.formFields),
      document_types: s.document_types || docTypesFor(key, input.packageItems),
      checkpoint: CHECKPOINT_BY_KEY[key] || "NONE",
    });
  });
  return { steps };
}

const DEFAULT_BROWSER_STEPS = [
  { key: "OPEN_PORTAL" }, { key: "AUTHENTICATE" },
  { key: "FILL_IDENTITY" }, { key: "FILL_PASSPORT" }, { key: "FILL_TRAVEL" }, { key: "FILL_CONTACT" },
  { key: "UPLOAD_PASSPORT" }, { key: "UPLOAD_PHOTO" }, { key: "UPLOAD_DOCS" },
  { key: "REVIEW" }, { key: "SUBMIT" }, { key: "CAPTURE_RECEIPT" },
];

function fieldCodesFor(key: string, fields: any[]): string[] | undefined {
  if (!fields?.length) return undefined;
  const map: Record<string, string[]> = {
    FILL_IDENTITY: ["applicant.surname", "applicant.given_names", "applicant.dob"],
    FILL_PASSPORT: ["passport.number", "passport.issuing_country", "passport.expiry"],
    FILL_TRAVEL: ["travel.arrival_date", "travel.departure_date", "travel.purpose"],
    FILL_CONTACT: ["contact.email", "contact.phone"],
  };
  const want = map[key];
  if (!want) return undefined;
  return fields.map((f: any) => f.code || f.field_code).filter((c: string) => want.some((w) => (c || "").includes(w)));
}

function docTypesFor(key: string, items: any[]): string[] | undefined {
  if (!items?.length) return undefined;
  const map: Record<string, string[]> = {
    UPLOAD_PASSPORT: ["PASSPORT", "PASSPORT_BIO_PAGE"],
    UPLOAD_PHOTO: ["PHOTO"],
    UPLOAD_DOCS: ["INVITATION_LETTER", "HOTEL_BOOKING", "FLIGHT_ITINERARY", "BANK_STATEMENT", "EMPLOYMENT_LETTER", "SUPPORTING_DOCUMENT"],
  };
  const want = map[key];
  if (!want) return undefined;
  const present = items.map((it: any) => it.document_type).filter(Boolean) as string[];
  return want.filter((w) => present.some((p) => p === w || p.startsWith(w.split("_")[0])));
}