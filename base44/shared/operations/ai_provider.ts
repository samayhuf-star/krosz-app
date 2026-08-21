// Truthful AI execution for orchestrator factory adapters.
//
// Factory adapters call runStructuredAI() instead of Core.InvokeLLM / runAIStage.
// runStructuredAI routes through the REAL provider runtime (executeAIChat):
//   capability → resolved provider chain → adapter_key → AI provider adapter → execution
// Provider.enabled, health, credentials, fallback and provider identity all affect the
// real execution path. Provenance (provider_id, provider_key, adapter_key, model) is read
// from the runtime result — never hardcoded. When only base44-core is configured, the
// base44core_ai adapter executes Core.InvokeLLM and provenance truthfully records
// "base44-core"; when an external provider (openai/anthropic/gemini) is configured and
// healthy, THAT adapter executes and provenance records it.

import { secrets } from "base44:runtime";
import { executeAIChat } from "../providers/runtime.ts";

const secGet = (name: string): string | undefined => {
  try { return secrets.get(name); } catch { return undefined; }
};

function runtimeFor(svc: any) {
  return {
    invokeLLM: async (prompt: string, opts: Record<string, unknown> = {}) => {
      const r = await svc.integrations.Core.InvokeLLM({ prompt, ...opts });
      return r || "";
    },
    fetchExternal: async (url: string, init?: RequestInit) => await fetch(url, init),
  };
}

function buildSchemaInstruction(schema: any): string {
  return [
    "You are a precise JSON generator.",
    "Respond with a SINGLE JSON object that satisfies the JSON schema below.",
    "Do NOT include markdown, code fences, or any commentary — only the JSON object.",
    "SCHEMA:",
    JSON.stringify(schema || { type: "object", additionalProperties: true }),
  ].join("\n");
}

function parseJsonObject(content: any): any | null {
  if (content == null) return null;
  let s = String(content).trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}

export interface StructuredAIResult {
  ok: boolean;
  data: any;
  provider_id: string | null;
  provider_key: string | null;
  adapter_key: string;
  model: string;
  tried: any[];
  fallback_used: boolean;
  error_code?: string;
  error_message?: string;
  latency_ms: number;
  // Reused Provider Runtime telemetry, surfaced for honest AIExecution provenance.
  tokens?: { prompt_tokens: number; completion_tokens: number };
  estimated_cost?: number;
  currency?: string;
}

async function adapterKeyOf(svc: any, providerId: string | null, tried: any[]): Promise<string> {
  if (providerId) {
    const p: any = await svc.entities.Provider.get(providerId).catch(() => null);
    if (p?.adapter_key) return p.adapter_key;
  }
  return "";
}

// Execute a structured (prompt + JSON-schema) AI call through the real provider runtime.
export async function runStructuredAI(base44: any, svc: any, opts: {
  tenantId?: string;
  businessId?: string;
  prompt: string;
  schema?: any;
  stage: string;
  model?: string;
  temperature?: number;
  actor?: string;
}): Promise<StructuredAIResult> {
  const rt = runtimeFor(svc);
  const t0 = Date.now();
  const model = opts.model || "automatic";
  const request: any = {
    model,
    messages: [
      { role: "system", content: buildSchemaInstruction(opts.schema) },
      { role: "user", content: opts.prompt },
    ],
    temperature: opts.temperature ?? 0.4,
  };

  let res: any;
  try {
    res = await executeAIChat(base44, secGet, rt, {
      tenant_id: opts.tenantId,
      business_id: opts.businessId,
      request,
    });
  } catch (e: any) {
    return {
      ok: false, data: null, provider_id: null, provider_key: null, adapter_key: "",
      model, tried: [], fallback_used: false,
      error_code: "PROVIDER_RUNTIME_FAILED",
      error_message: String(e?.message || e),
      latency_ms: Date.now() - t0,
    };
  }

  // Runtime-truth: when NO AI provider is configured/enabled, executeAIChat returns
  // NO_PROVIDER. We then (and ONLY then) fall back to the platform Core LLM and
  // truthfully record "base44-core" as the provider. This is never a silent
  // override of a configured provider — it is degraded-mode execution with honest
  // provenance, so the orchestrator still works before any provider is registered.
  if (!res.provider_id && res.result && res.result.error_code === "NO_PROVIDER") {
    try {
      const core: any = await svc.integrations.Core.InvokeLLM({
        prompt: opts.prompt,
        response_json_schema: opts.schema || { type: "object", additionalProperties: true },
        model,
      });
      const data = core && typeof core === "object" ? core : null;
      return {
        ok: !!data, data, provider_id: null, provider_key: "base44-core",
        adapter_key: "base44core_ai", model, tried: [], fallback_used: false,
        error_code: data ? "" : "INVALID_JSON",
        error_message: data ? "" : "Core LLM returned no parseable object for the requested schema.",
        latency_ms: Date.now() - t0,
      };
    } catch (e: any) {
      return {
        ok: false, data: null, provider_id: null, provider_key: "base44-core",
        adapter_key: "base44core_ai", model, tried: [], fallback_used: false,
        error_code: "CORE_LLM_FAILED", error_message: String(e?.message || e),
        latency_ms: Date.now() - t0,
      };
    }
  }

  const r = res.result;
  if (r.success && r.data) {
    const data = parseJsonObject(r.data.content);
    const adapter_key = await adapterKeyOf(svc, res.provider_id, res.tried);
    const modelUsed = r.data.model || model;
    if (data == null) {
      return {
        ok: false, data: null, provider_id: res.provider_id, provider_key: res.provider_key,
        adapter_key, model: modelUsed, tried: res.tried, fallback_used: res.tried.length > 1,
        error_code: "INVALID_JSON",
        error_message: "Provider returned content that did not parse as JSON for the requested schema.",
        latency_ms: Date.now() - t0,
      };
    }
    return {
      ok: true, data, provider_id: res.provider_id, provider_key: res.provider_key,
      adapter_key, model: modelUsed, tried: res.tried, fallback_used: res.tried.length > 1,
      latency_ms: Date.now() - t0, tokens: res.tokens, estimated_cost: res.estimated_cost, currency: res.currency,
    };
  }

  const adapter_key = await adapterKeyOf(svc, res.provider_id, res.tried);
  return {
    ok: false, data: null, provider_id: res.provider_id, provider_key: res.provider_key,
    adapter_key, model, tried: res.tried, fallback_used: false,
    error_code: r.error_code || "AI_FAILED",
    error_message: r.error_message || "AI provider call failed.",
    latency_ms: Date.now() - t0,
  };
}