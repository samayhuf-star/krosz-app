import { base44 } from "@/api/base44Client";

async function invoke(payload) {
  try {
    const res = await base44.functions.invoke("trustContent", payload);
    return res?.data ?? res;
  } catch (e) {
    throw e;
  }
}

// Public read-only content for legal/trust pages.
export const listPoliciesPublic = () => invoke({ action: "list-policies" });
export const getPolicyPublic = (policy_key) => invoke({ action: "get-policy", policy_key });
export const getBusinessConfigPublic = () => invoke({ action: "get-business-config" });