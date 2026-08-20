import { base44 } from "@/api/base44Client";

// Frontend client for the Phase 3 Customer Operations Engine.
async function invoke(payload) {
  try {
    const res = await base44.functions.invoke("operationsEngine", payload);
    return res?.data ?? res;
  } catch (error) {
    const backend = error?.response?.data || error?.data;
    const message = backend?.error || backend?.message || error?.message || "Operations engine request failed";
    throw Object.assign(new Error(message), { code: backend?.code || error?.code });
  }
}

export const customerOps = (application_id) => invoke({ action: "customer-ops", application_id });
export const operationsCommandCenter = () => invoke({ action: "command-center" });
export const operationsDailyBrief = () => invoke({ action: "daily-brief" });
export const operationsReconciliation = () => invoke({ action: "reconciliation" });