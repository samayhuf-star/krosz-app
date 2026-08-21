import { base44 } from "@/api/base44Client";

export async function fetchPullRequests() {
  const res = await base44.functions.invoke("githubPullRequests", { action: "cached" });
  return res.data;
}

export async function refreshPullRequests() {
  const res = await base44.functions.invoke("githubPullRequests", { action: "live" });
  return res.data;
}