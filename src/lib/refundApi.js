import { base44 } from "@/api/base44Client";

async function invoke(action, payload = {}) {
  const res = await base44.functions.invoke("refundAdmin", { action, ...payload });
  return res?.data ?? res;
}

export const adminListRefunds = () => invoke("list");
export const adminReviewRefund = (refund_id) => invoke("review", { refund_id });
export const adminRejectRefund = (refund_id, reason) => invoke("reject", { refund_id, reason });
export const adminEvidencePack = (opts) => invoke("evidence", opts);