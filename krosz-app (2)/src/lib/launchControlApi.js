import { base44 } from "@/api/base44Client";

export async function controlTower() {
  const res = await base44.functions.invoke("operationsEngine", { action: "launch-control-tower" });
  return res?.data ?? res;
}
export async function launchControlGet() {
  const res = await base44.functions.invoke("operationsEngine", { action: "launch-control-get" });
  return res?.data ?? res;
}
export async function launchControlSet(config) {
  const res = await base44.functions.invoke("operationsEngine", { action: "launch-control-set", config });
  return res?.data ?? res;
}