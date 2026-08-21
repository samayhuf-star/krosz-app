// Agent Tools (Phase 13a) — permission guard + argument validation + executors.
//
// The agent's model proposes a tool call; this module enforces that the call is
// ALLOWED for the specific agent (capability exists AND is in the agent's
// allowed-tools list), validates the arguments against the capability's
// argsSchema, then executes the real backend. Read-kind tools (no args) map to
// the existing interpreter reads; the new "tool" kind (structured args) maps to
// stateless external executors such as website_fetch.
//
// Nothing here duplicates the Provider Runtime, the Workflow Engine, or the
// capability registry — it consumes CAPABILITIES and delegates execution.

import { CAPABILITIES } from "../actions/capabilities.ts";
import { writeBusinessFact } from "./memory.ts";

export interface ToolResult {
  ok: boolean;
  data?: any;
  error?: string;
  errorCode?: string;
}

// TOOL PERMISSION MODEL (spec step 5). A requested capability must exist in the
// registry AND be in the agent's explicit allowed-tools list, otherwise the
// request is rejected with TOOL_NOT_ALLOWED. The model can never bypass this.
export function enforceToolPermission(allowedTools: string[] | undefined, requested: string): { ok: boolean; errorCode?: string; reason?: string } {
  if (!requested) return { ok: false, errorCode: "TOOL_NOT_ALLOWED", reason: "No tool capability requested." };
  const cap = (CAPABILITIES as any)[requested];
  if (!cap) return { ok: false, errorCode: "TOOL_NOT_ALLOWED", reason: `Unknown tool: '${requested}' is not a registered capability.` };
  const allow = Array.isArray(allowedTools) ? allowedTools : [];
  if (!allow.includes(requested)) return { ok: false, errorCode: "TOOL_NOT_ALLOWED", reason: `Tool '${requested}' is not permitted for this agent.` };
  return { ok: true };
}

// Tool argument validation against the capability argsSchema (shallow: required
// keys present + basic type match). Invalid args return TOOL_INVALID_ARGS.
export function validateToolArgs(requested: string, args: any): { ok: boolean; missing?: string[]; reason?: string } {
  const cap: any = (CAPABILITIES as any)[requested];
  if (!cap) return { ok: false, reason: `Unknown tool: ${requested}` };
  const schema = cap.argsSchema;
  if (!schema || !schema.properties) return { ok: true };
  args = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const required: string[] = schema.required || [];
  const missing = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
  if (missing.length) return { ok: false, missing, reason: `Missing required arguments: ${missing.join(", ")}` };
  for (const k of Object.keys(schema.properties)) {
    const t = schema.properties[k]?.type;
    if (args[k] !== undefined && t && !matchesType(args[k], t)) return { ok: false, reason: `Argument '${k}' must be of type ${t}.` };
  }
  return { ok: true };
}

function matchesType(v: any, t: string): boolean {
  if (t === "string") return typeof v === "string";
  if (t === "number") return typeof v === "number" || (!isNaN(Number(v)) && v !== "");
  if (t === "boolean") return typeof v === "boolean";
  if (t === "object") return v && typeof v === "object" && !Array.isArray(v);
  if (t === "array") return Array.isArray(v);
  return true;
}

// Execute a tool. Read-kind (no args) -> interpreter reads; tool-kind (args) ->
// stateless external executor. workflow/standalone_task tools are explicitly NOT
// invocable inside the agent loop (they would create a nested Run).
export async function executeAgentTool(svc: any, business: any, capabilityKey: string, args: any, opts?: { run?: any; task?: any; agent?: any }): Promise<ToolResult> {
  const cap: any = (CAPABILITIES as any)[capabilityKey];
  if (!cap) return { ok: false, error: `Unknown tool: ${capabilityKey}`, errorCode: "TOOL_NOT_ALLOWED" };
  try {
    if (cap.kind === "tool") {
      if (capabilityKey === "website_fetch") return await executeWebsiteFetch(args);
      if (capabilityKey === "remember_business_fact") return await executeRememberFact(svc, business, args, opts);
      // Phase 14: chatbot tools — delegate to the canonical chatbot tool module
      // which performs REAL CRM Lead / Support Ticket writes and BusinessContext
      // reads scoped to the chatbot's business. Conversation context (chatbot_id,
      // conversation_id, chatbot_config) is threaded from the dispatch input.
      if (["lookup_business_info", "check_business_hours", "capture_lead", "escalate_to_human"].includes(capabilityKey)) {
        const chat = await import("../chatbot/index.ts");
        const convCtx: any = (opts?.task?.input_context) || {};
        return await chat.executeChatbotTool(svc, business, capabilityKey, args, {
          chatbot_id: convCtx.chatbot_id || null,
          conversation_id: convCtx.conversation_id || null,
          chatbot_config: convCtx.chatbot_config || null,
          customer_context: convCtx.customer_context || null,
          agent: opts?.agent,
        });
      }
      if (capabilityKey === "technology_detector") return await executeTechnologyDetector(args);
      if (capabilityKey === "metadata") return await executeMetadata(args);
      if (capabilityKey === "robots") return await executeRobots(args);
      if (capabilityKey === "sitemap") return await executeSitemap(args);
      return { ok: false, error: `Tool '${capabilityKey}' is registered but not wired.`, errorCode: "TOOL_FAILED" };
    }
    if (cap.kind === "read") {
      const m = await import("../actions/interpreter.ts");
      let r: { data: any; reply: string };
      if (capabilityKey === "list_customers") r = await m.readListCustomers(svc, business.id);
      else if (capabilityKey === "show_status") r = await m.readShowStatus(svc, business);
      else if (capabilityKey === "advice_today") r = await m.readAdviceToday(svc, business);
      else return { ok: false, error: `Read tool not wired: ${capabilityKey}`, errorCode: "TOOL_FAILED" };
      return { ok: true, data: r.data };
    }
    return { ok: false, error: `Tool kind '${cap.kind}' is not invocable inside the agent loop.`, errorCode: "TOOL_FAILED" };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e), errorCode: "TOOL_FAILED" };
  }
}

// website_fetch: fetch a public URL (10s timeout), extract title + a cheap tech
// heuristic + a content excerpt. No model call inside the tool — the agent's own
// LLM reasons about the returned data.
async function executeWebsiteFetch(args: any): Promise<ToolResult> {
  const url = String(args?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must be an absolute http(s) URL.", errorCode: "TOOL_INVALID_ARGS" };
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { "user-agent": "LaunchOS-Agent/1.0 (+website-analyzer)" }, redirect: "follow", signal: controller.signal });
    if (!res.ok) return { ok: false, error: `Fetch failed: HTTP ${res.status} for ${url}`, errorCode: "TOOL_FAILED" };
    const text = await res.text();
    const body = text.slice(0, 400000);
    const title = ((body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "").trim() || "";
    const metaDesc = (body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || (body.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || "";
    const lower = body.toLowerCase();
    const technologies: string[] = [];
    if (/<meta[^>]+name=["']generator["']/i.test(body) || /\/wp-content\//.test(lower)) technologies.push("wordpress");
    if (/__next_data__|\/_next\//.test(lower)) technologies.push("next.js");
    if (/data-reactroot|__react_internal|react\.production\.min/.test(lower)) technologies.push("react");
    if (/cdn\.shopify\.com/.test(lower)) technologies.push("shopify");
    if (/static\.wixstatic/.test(lower)) technologies.push("wix");
    if (/squarespace/.test(lower)) technologies.push("squarespace");
    if (/woocommerce/.test(lower)) technologies.push("woocommerce");
    if (/cloudflare/.test(lower)) technologies.push("cloudflare");
    const summary = (title || metaDesc || stripTags(body).slice(0, 220)).slice(0, 240);
    return {
      ok: true,
      data: {
        url, status_code: res.status, title: title || "(no title)", summary,
        technologies: Array.from(new Set(technologies)),
        content_excerpt: stripTags(body).slice(0, 500),
      },
    };
  } catch (e: any) {
    return { ok: false, error: `Fetch failed: ${String(e?.message || e)}`, errorCode: "TOOL_FAILED" };
  } finally {
    clearTimeout(to);
  }
}

// remember_business_fact: persist a durable business fact through the canonical
// memory writer (provenance + conflict resolution). The agent CANNOT write
// free-form memory — only validated facts via this tool, scoped to the
// running business. Returns a bounded summary (no full body echoed to model).
async function executeRememberFact(svc: any, business: any, args: any, opts?: { run?: any; task?: any; agent?: any }): Promise<ToolResult> {
  const key = String(args?.key || "").trim();
  const value = String(args?.value || "").trim();
  const confidence = Number(args?.confidence);
  if (!key || !value) return { ok: false, error: "key and value are required.", errorCode: "TOOL_INVALID_ARGS" };
  if (isNaN(confidence) || confidence < 0 || confidence > 1) return { ok: false, error: "confidence must be 0-1.", errorCode: "TOOL_INVALID_ARGS" };
  try {
    const res = await writeBusinessFact(svc, {
      business, agent_id: opts?.agent?.id || null, run_id: opts?.run?.id || null, task_id: opts?.task?.id || null,
      kind: "fact", key, title: key, body: value, confidence, source: "ai", actor: "agent",
    });
    return { ok: true, data: { id: res.id || null, key, superseded: !!res.superseded, preserved: !res.superseded, reason: res.reason || null } };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e), errorCode: "TOOL_FAILED" };
  }
}

// ---- Phase 13C: Website Intelligence Team tool executors (stateless HTTP fetch) ----
async function httpGet(url: string, opts: { timeoutMs?: number } = {}): Promise<{ status: number; text: string; finalUrl: string }> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(url, { headers: { "user-agent": "LaunchOS-Agent/1.0 (+website-intelligence)" }, redirect: "follow", signal: controller.signal });
    const text = await res.text();
    return { status: res.status, text, finalUrl: url };
  } finally { clearTimeout(to); }
}

function baseOf(url: string): string {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return url.replace(/\/+$/, ""); }
}

function detectTechnologies(body: string): string[] {
  const lower = body.toLowerCase();
  const techs: string[] = [];
  if (/<meta[^>]+name=["']generator["']/i.test(body) || /\/wp-content\//.test(lower)) techs.push("wordpress");
  if (/__next_data__|\/_next\//.test(lower)) techs.push("next.js");
  if (/data-reactroot|__react_internal|react\.production\.min/.test(lower)) techs.push("react");
  if (/data-v-|vue\.runtime/.test(lower)) techs.push("vue");
  if (/cdn\.shopify\.com/.test(lower)) techs.push("shopify");
  if (/static\.wixstatic/.test(lower)) techs.push("wix");
  if (/squarespace/.test(lower)) techs.push("squarespace");
  if (/woocommerce/.test(lower)) techs.push("woocommerce");
  if (/cdn\.cloudflare|__cf-ray/.test(lower)) techs.push("cloudflare");
  if (/google-analytics|gtag\(|googletagmanager/.test(lower)) techs.push("google_analytics");
  if (/hotjar/.test(lower)) techs.push("hotjar");
  return Array.from(new Set(techs));
}

async function executeTechnologyDetector(args: any): Promise<ToolResult> {
  const url = String(args?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must be an absolute http(s) URL.", errorCode: "TOOL_INVALID_ARGS" };
  try {
    const { status, text } = await httpGet(url);
    if (status >= 400) return { ok: false, error: `Fetch failed: HTTP ${status}`, errorCode: "TOOL_FAILED" };
    const technologies = detectTechnologies(text);
    return { ok: true, data: { url, technologies, detected_from: status } };
  } catch (e: any) { return { ok: false, error: `Fetch failed: ${String(e?.message || e)}`, errorCode: "TOOL_FAILED" }; }
}

async function executeMetadata(args: any): Promise<ToolResult> {
  const url = String(args?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must be an absolute http(s) URL.", errorCode: "TOOL_INVALID_ARGS" };
  try {
    const { status, text } = await httpGet(url);
    if (status >= 400) return { ok: false, error: `Fetch failed: HTTP ${status}`, errorCode: "TOOL_FAILED" };
    const body = text.slice(0, 400000);
    const pick = (re: RegExp) => (body.match(re) || [])[1] || "";
    const title = ((body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "").trim();
    const description = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const charset = pick(/<meta[^>]+charset=["']?([^"'>\s]+)/i);
    const viewport = pick(/<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']+)["']/i);
    return { ok: true, data: { url, status_code: status, title: title || "(no title)", description: description || "", og_title: ogTitle || "", og_image: ogImage || "", charset: charset || "", viewport: viewport || "" } };
  } catch (e: any) { return { ok: false, error: `Fetch failed: ${String(e?.message || e)}`, errorCode: "TOOL_FAILED" }; }
}

async function executeRobots(args: any): Promise<ToolResult> {
  const url = String(args?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must be an absolute http(s) URL.", errorCode: "TOOL_INVALID_ARGS" };
  const base = baseOf(url);
  try {
    const { status, text } = await httpGet(`${base}/robots.txt`);
    if (status >= 400 && status !== 404) return { ok: false, error: `Fetch failed: HTTP ${status}`, errorCode: "TOOL_FAILED" };
    const present = status !== 404 && text.trim().length > 0;
    const sitemaps: string[] = [];
    const userAgents: string[] = [];
    const disallowed: string[] = [];
    for (const line of (text || "").split(/\r?\n/)) {
      const l = line.trim();
      if (/^sitemap:/i.test(l)) sitemaps.push(l.replace(/^sitemap:\s*/i, "").trim());
      else if (/^user-agent:/i.test(l)) userAgents.push(l.replace(/^user-agent:\s*/i, "").trim());
      else if (/^disallow:/i.test(l)) { const p = l.replace(/^disallow:\s*/i, "").trim(); if (p) disallowed.push(p); }
    }
    return { ok: true, data: { base, present, sitemaps, user_agents: Array.from(new Set(userAgents)), disallowed_paths: disallowed.slice(0, 50), status_code: status } };
  } catch (e: any) { return { ok: false, error: `Fetch failed: ${String(e?.message || e)}`, errorCode: "TOOL_FAILED" }; }
}

async function executeSitemap(args: any): Promise<ToolResult> {
  const url = String(args?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must be an absolute http(s) URL.", errorCode: "TOOL_INVALID_ARGS" };
  const base = baseOf(url);
  try {
    const { status, text } = await httpGet(`${base}/sitemap.xml`);
    if (status >= 400 && status !== 404) return { ok: false, error: `Fetch failed: HTTP ${status}`, errorCode: "TOOL_FAILED" };
    const present = status !== 404 && (text || "").trim().length > 0;
    const urls: string[] = [];
    const re = /<loc>([^<]+)<\/loc>/g; let m;
    let maxUrls = 200;
    while ((m = re.exec(text || "")) && maxUrls-- > 0) urls.push(m[1].trim());
    return { ok: true, data: { base, present, url_count: urls.length, urls: urls.slice(0, 200), status_code: status } };
  } catch (e: any) { return { ok: false, error: `Fetch failed: ${String(e?.message || e)}`, errorCode: "TOOL_FAILED" }; }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}