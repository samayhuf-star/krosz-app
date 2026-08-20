// Worldz Visa (Phase 11) — Execution adapter: MOCK Browser Automation strategy.
//
// Drives the mock portal step-by-step deterministically using the PortalWorkflow
// selector definitions + fallbacks (§§10/11). Hard guards:
//   - Domain allowlist on every navigation (§33); unexpected redirect pauses.
//   - Selector lookup NEVER guesses — a missing selector or drift pauses as
//     WORKFLOW_DRIFT (§§11/47).
//   - OTP/MFA/CAPTCHA pause as WAITING_FOR_USER; never bypassed (§§20/21).
//   - Portal page content is UNTRUSTED DATA — injected prompt-injection text
//     ("ignore previous instructions…") is ignored (§35).
//   - Indeterminate post-submit → UNKNOWN_EXTERNAL_STATE, no auto-retry (§28).
//   - Final submit gate (package integrity + approval) is enforced by the
//     ENGINE before the SUBMIT step (§29/§30), not here.

import {
  openSession, getSession, attemptLogin, verifyOtp, solveCaptcha,
  navigate as portalNavigate, fillField, uploadDocument, setReviewed,
  submit as portalSubmit, captureReceipt, loginPageContent,
} from "../portal/mock_portal.ts";
import { isDomainAllowed } from "../security.ts";
import type {
  ExecutionProviderAdapter, ExecutionResult, ExecutionExecutionContext,
  HumanReason, SessionStatus, Checkpoint,
} from "../types.ts";

const KEY = "visa.exec.browser_mock";

function findFieldMapping(workflow: any, fieldCode: string): any | null {
  return (workflow?.field_mappings || []).find((m: any) => m.field_code === fieldCode) || null;
}
function findDocMapping(workflow: any, docType: string): any | null {
  return (workflow?.document_mappings || []).find((m: any) => (m.document_type === docType || m.document_types?.includes(docType)) === true) || null;
}

export const browserMockExecutionAdapter: ExecutionProviderAdapter = {
  key: KEY, displayName: "Mock Browser Automation", strategy: "BROWSER_AUTOMATION",
  capabilities: ["BROWSER_NAVIGATION", "FORM_FILLING", "DOCUMENT_UPLOAD", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK"],
  getCapabilities() { return ["BROWSER_NAVIGATION", "FORM_FILLING", "DOCUMENT_UPLOAD", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK"]; },

  async init(_ctx: any, exec: ExecutionExecutionContext): Promise<ExecutionResult> {
    const base = exec.portalDefinition?.base_url || "https://portal.mock-gov.example";
    const s = openSession(base, exec.behaviors || {});
    // Read the login page content as DATA (§35) — ignore prompt-injection text.
    void loginPageContent(s);
    return { success: true, status: "AUTHENTICATING", checkpoint: "PORTAL_OPENED", currentStep: "AUTHENTICATE", done: false, response_metadata: { session_ref: s.ref } };
  },

  async executeStep(_ctx: any, exec: ExecutionExecutionContext): Promise<ExecutionResult> {
    const s = getSession(exec.session.execution_session_reference);
    if (!s) return { success: false, status: "FAILED" as SessionStatus, error_code: "SESSION_LOST", error_category: "PERMANENT" };
    const step = exec.session.current_step || "";
    const resolution = exec.resolution; // set by engine when resuming a paused action.

    // ---- AUTHENTICATE: pause for OTP/CAPTCHA, resume after human solves ----
    if (step === "AUTHENTICATE") {
      if (resolution === "OTP_SOLVED") { verifyOtp(s, "000000"); solveCaptcha(s, "human"); }
      const login = attemptLogin(s, {});
      if (login.needsOtp) return pause(s, "OTP_REQUIRED", "Portal requires OTP verification. Complete it in the secure session, then resume.", step);
      if (login.needsCaptcha) return pause(s, "CAPTCHA_REQUIRED", "Portal presented a CAPTCHA. Solve it in the secure session, then resume.", step);
      return ok("IDENTITY_COMPLETED" as Checkpoint, "FILL_IDENTITY", "FILLING" as SessionStatus);
    }

    // ---- Filling steps: deterministic field writes via workflow selectors ----
    if (step === "FILL_IDENTITY" || step === "FILL_PASSPORT" || step === "FILL_TRAVEL" || step === "FILL_CONTACT") {
      const fieldCodes: string[] = exec.executionPlan?.steps?.find((st: any) => st.key === step)?.field_codes || [];
      const data = (exec.formSnapshot?.fields || exec.formSnapshot?.data || {}) as Record<string, any>;
      for (const code of fieldCodes) {
        const m = findFieldMapping(exec.portalWorkflow, code);
        if (!m) return automationBlocked(s, code, "NO_FIELD_MAPPING", step);
        const value = data[code];
        if (value == null || value === "") return automationBlocked(s, code, "MISSING_FORM_VALUE", step); // never invent (§13)
        const sel = m.primary?.value || m.selector;
        const r = fillField(s, code, sel, String(value));
        if (r.drift) return drift(s, code, sel, step);
        // Fallback selectors would be tried here on a real provider; in the mock
        // the primary selector resolves the field.
      }
      const mapNext: Record<string, string> = { FILL_IDENTITY: "FILL_PASSPORT", FILL_PASSPORT: "FILL_TRAVEL", FILL_TRAVEL: "FILL_CONTACT", FILL_CONTACT: "UPLOAD_PASSPORT" };
      const cp: Record<string, Checkpoint> = { FILL_IDENTITY: "IDENTITY_COMPLETED", FILL_TRAVEL: "TRAVEL_COMPLETED" };
      return ok(cp[step] || "NONE", mapNext[step], "FILLING");
    }

    // ---- Document uploads: pinned versions + portal constraints (§§14/16) ----
    if (step === "UPLOAD_PASSPORT" || step === "UPLOAD_PHOTO" || step === "UPLOAD_DOCS") {
      const docTypes: string[] = exec.executionPlan?.steps?.find((st: any) => st.key === step)?.document_types || [];
      for (const dt of docTypes) {
        const m = findDocMapping(exec.portalWorkflow, dt);
        const pkgItem = (exec.documents || []).find((d: any) => (d.document_type || d.requirement_type) === dt);
        // A pinned package item may legitimately be absent (optional); skip if so.
        if (!pkgItem) continue;
        if (!m) continue;
        const up = uploadDocument(s, pkgItem.document_type || dt, { mime_type: pkgItem.mime_type || "application/pdf", file_size: pkgItem.file_size || 1024 }, m.constraints);
        if (!up.ok) return { success: false, status: "WAITING_FOR_USER" as SessionStatus, requiresHuman: true, humanReason: "PORTAL_ERROR" as HumanReason, humanInstructions: `Portal rejected ${dt}`, error_code: up.error_code || "PORTAL_VALIDATION_ERROR", error_category: "PERMANENT", currentStep: step };
      }
      const next: Record<string, string> = { UPLOAD_PASSPORT: "UPLOAD_PHOTO", UPLOAD_PHOTO: "UPLOAD_DOCS", UPLOAD_DOCS: "REVIEW" };
      return ok("DOCUMENTS_UPLOADED", next[step], "UPLOADING");
    }

    // ---- Review ----
    if (step === "REVIEW") { setReviewed(s); return ok("REVIEW_READY", "SUBMIT", "REVIEWING"); }

    // ---- Submit: engine already enforced package + approval gate ----
    if (step === "SUBMIT") {
      const r = portalSubmit(s);
      if (r.indeterminate) return { success: false, status: "UNKNOWN_EXTERNAL_STATE" as SessionStatus, indeterminate: true, error_code: "SUBMIT_TIMEOUT", error_category: "UNKNOWN", done: false, currentStep: "SUBMIT" };
      return { success: true, status: "COMPLETED" as SessionStatus, checkpoint: "SUBMITTED" as Checkpoint, externalReference: r.reference || undefined, currentStep: "CAPTURE_RECEIPT" };
    }

    // ---- Receipt capture ----
    if (step === "CAPTURE_RECEIPT") {
      const receipt = captureReceipt(s);
      return { success: true, status: "COMPLETED" as SessionStatus, checkpoint: "RECEIPT_CAPTURED" as Checkpoint, receipt, externalReference: s.externalReference || undefined, done: true };
    }

    // ---- Open portal / navigate with domain allowlist ----
    if (step === "OPEN_PORTAL") {
      const nav = portalNavigate(s, "/apply");
      if (nav.unexpectedDomain || !isDomainAllowed(exec.portalDefinition, nav.url)) {
        return { success: false, status: "WAITING_FOR_USER" as SessionStatus, requiresHuman: true, humanReason: "UNEXPECTED_DOMAIN" as HumanReason, humanInstructions: `Unexpected redirect to ${nav.url}`, error_code: "UNEXPECTED_DOMAIN", error_category: "HUMAN_REQUIRED", next_url: nav.url };
      }
      return ok("PORTAL_OPENED", "AUTHENTICATE", "AUTHENTICATING");
    }

    return { success: false, status: "FAILED" as SessionStatus, error_code: "UNKNOWN_STEP", error_category: "PERMANENT" };
  },

  async pause(_ctx: any, _exec: ExecutionExecutionContext): Promise<ExecutionResult> {
    return { success: true, status: "WAITING_FOR_USER" as SessionStatus, done: false };
  },
  async cancel(_ctx: any, _exec: ExecutionExecutionContext): Promise<ExecutionResult> {
    return { success: true, status: "CANCELLED" as SessionStatus, done: true };
  },
  async getStatus(_ctx: any, ref: { external_reference: string }) {
    const st = getStatusByProxy(ref.external_reference);
    const done = st.status === "COMPLETED";
    return { success: true, status: done ? "COMPLETED" : "PROCESSING", done } as ExecutionResult;
  },
};

function getStatusByProxy(_ref: string): { status: "PROCESSING" | "COMPLETED" | "REJECTED" } {
  // Status is decoupled from the submit browser session (§62). Mock returns
  // COMPLETED once a reference is present (captured at submit time on the session).
  return { status: "COMPLETED" };
}

function ok(checkpoint: Checkpoint, next: string, status: SessionStatus): ExecutionResult {
  return { success: true, status, checkpoint, currentStep: next, done: false };
}
function pause(_s: any, reason: HumanReason, instructions: string, step: string): ExecutionResult {
  return { success: false, status: "WAITING_FOR_USER", requiresHuman: true, humanReason: reason, humanInstructions: instructions, error_code: reason, error_category: "HUMAN_REQUIRED", retryable: false, currentStep: step };
}
function automationBlocked(_s: any, code: string, reason: string, step: string): ExecutionResult {
  return { success: false, status: "WAITING_FOR_USER", requiresHuman: true, humanReason: "FIELD_AMBIGUITY", humanInstructions: `No selector mapping for ${code}: ${reason}`, error_code: "AUTOMATION_BLOCKED:" + reason, error_category: "PERMANENT", currentStep: step };
}
function drift(_s: any, code: string, selector: string, step: string): ExecutionResult {
  return { success: false, status: "WAITING_FOR_USER", requiresHuman: true, humanReason: "WORKFLOW_DRIFT", humanInstructions: `Selector "${selector}" for ${code} not found on portal`, error_code: "WORKFLOW_DRIFT", error_category: "PERMANENT", currentStep: step };
}