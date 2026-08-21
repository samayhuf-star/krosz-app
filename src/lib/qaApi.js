import { base44 } from "@/api/base44Client";

async function invoke(payload) {
  const res = await base44.functions.invoke("qaOrchestrator", payload);
  return res?.data ?? res;
}

export const qaLatest = () => invoke({ action: "latest" });
export const qaRun = (mode = "LIGHT") => invoke({ action: "run", mode });
export const qaExportLatest = () => invoke({ action: "export-latest" });
