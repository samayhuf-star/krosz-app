import { base44 } from "@/api/base44Client";

async function invoke(payload) {
  try {
    const res = await base44.functions.invoke("applicationCaseApi", payload);
    return res?.data ?? res;
  } catch (error) {
    // The SDK throws a generic "Request failed with status code 400" and discards
    // the backend's structured error body. Re-extract it (mirroring visaApi) so
    // the wizard can surface the real reason (e.g. BAD_TRANSITION) to the user.
    const backend = error?.response?.data || error?.data;
    const message = backend?.error || backend?.message || error?.message || "Application case request failed";
    throw Object.assign(new Error(message), { code: backend?.code || error?.code, status: error?.status || error?.response?.status });
  }
}

// Phase 27 \u2014 Application Case API. All case mutations go through the pure case
// engine on the backend; the frontend never mutates case state directly (\u00a716).
export const applicationCaseCreate = (p) => invoke({ action: "application-case-create", ...p });
export const applicationCaseGet = (id) => invoke({ action: "application-case-get", id });
export const applicationCaseList = () => invoke({ action: "application-case-list" });
export const applicationCaseTransition = (p) => invoke({ action: "application-case-transition", ...p });
export const applicationCaseSaveProgress = (p) => invoke({ action: "application-case-save-progress", ...p });
export const applicationCaseContext = (id) => invoke({ action: "application-case-context", id });
export const applicationCaseTimeline = (id) => invoke({ action: "application-case-timeline", id });
export const applicationCaseWebhook = (p) => invoke({ action: "application-case-webhook", ...p });