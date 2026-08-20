// Real Orchestrator adapter for `generate_blueprint`.
//
// Reuses Business Blueprint domain intelligence (schema, slice strategy, normalize)
// but executes AI through the orchestrator's truthful provider path (runStructuredAI)
// and records runtime-truthful provenance on the AIExecution checkpoint + the
// BusinessBlueprint. The orchestrator coordinates; blueprint domain logic stays here.
//
// Returns the dispatch contract shape engine.dispatchTask already expects:
//   { status: 'completed'|'failed', output, error, last_stage, executionIds }

import { recordExecution, hashOf } from "../adapterContract.ts";
import { runStructuredAI, StructuredAIResult } from "../ai_provider.ts";
import type { Adapter } from "../adapters.ts";

const BP_PROMPT_VERSION = "bp-prompt-v1";
const BP_PLANNER_VERSION_DEFAULT = "planner-v1";

const str = { type: "string" };
const arrStr = { type: "array", items: { type: "string" } };

export const BLUEPRINT_SCHEMA = {
  type: "object", additionalProperties: true,
  properties: {
    business_profile: { type: "object", additionalProperties: true, properties: { business_name: str, industry: str, business_category: str, business_description: str, mission: str, vision: str, usp: str, brand_position: str }, required: ["business_name", "industry", "business_description"] },
    target_audience: { type: "object", additionalProperties: true, properties: { primary_audience: str, secondary_audience: str, customer_personas: { type: "array", items: { type: "object", additionalProperties: true, properties: { name: str, age_range: str, description: str } } }, customer_problems: arrStr, customer_goals: arrStr }, required: ["primary_audience"] },
    branding: { type: "object", additionalProperties: true, properties: { brand_tone: str, brand_personality: str, brand_voice: str, suggested_colors: { type: "array", items: { type: "object", additionalProperties: true, properties: { name: str, hex: str } } }, suggested_font_style: str, cta_style: str } },
    services: { type: "array", items: { type: "object", additionalProperties: true, properties: { name: str, short_description: str, long_description: str, benefits: arrStr, cta: str } } },
    website_blueprint: { type: "object", additionalProperties: true, properties: { pages: { type: "array", items: { type: "object", additionalProperties: true, properties: { title: str, page_type: str, parent: str, purpose: str } } } } },
    seo_blueprint: { type: "object", additionalProperties: true, properties: { primary_keywords: arrStr, secondary_keywords: arrStr, long_tail_keywords: arrStr, topic_clusters: { type: "array", items: { type: "object", additionalProperties: true, properties: { topic: str, supporting_keywords: arrStr } } }, blog_categories: arrStr, location_strategy: str, internal_linking_strategy: str, content_pillars: arrStr } },
    crm_blueprint: { type: "object", additionalProperties: true, properties: { lead_stages: arrStr, lead_sources: arrStr, contact_fields: arrStr, required_forms: { type: "array", items: { type: "object", additionalProperties: true, properties: { name: str, fields: arrStr } } }, follow_up_pipeline: str, appointment_requirements: str } },
    email_blueprint: { type: "object", additionalProperties: true, properties: { mailboxes: { type: "array", items: { type: "object", additionalProperties: true, properties: { address: str, purpose: str } } } } },
    phone_blueprint: { type: "object", additionalProperties: true, properties: { numbers: { type: "array", items: { type: "object", additionalProperties: true, properties: { label: str, type: str, purpose: str } } } } },
    ai_agent_blueprint: { type: "object", additionalProperties: true, properties: { agents: { type: "array", items: { type: "object", additionalProperties: true, properties: { role: str, purpose: str, tools: arrStr } } }, knowledge_sources: arrStr, escalation_rules: arrStr } },
    build_estimate: { type: "object", additionalProperties: true, properties: { website_pages: { type: "number" }, blog_categories: { type: "number" }, seo_pages: { type: "number" }, expected_build_time: str, estimated_monthly_infrastructure_cost: str } },
  },
  required: ["business_profile", "target_audience", "branding", "services", "website_blueprint", "seo_blueprint", "crm_blueprint", "email_blueprint", "phone_blueprint", "ai_agent_blueprint", "build_estimate"],
};

const SLICES: { keys: string[]; brief: string }[] = [
  { keys: ["business_profile", "target_audience", "branding", "services"], brief: "business_profile (business_name, industry, business_category, business_description 2-3 sentences, mission, vision, usp, brand_position); target_audience (primary_audience, secondary_audience, customer_personas 3-4 {name, age_range, description}, customer_problems list, customer_goals list); branding (brand_tone, brand_personality, brand_voice, suggested_colors 4-6 {name, hex}, suggested_font_style, cta_style); services (array, each: name, short_description, long_description, benefits list, cta — use the planner's services)." },
  { keys: ["website_blueprint", "seo_blueprint", "crm_blueprint"], brief: "website_blueprint.pages (ordered array {title, page_type, parent, purpose} — include Home, About, Services overview, one page per service, Pricing, FAQ, Reviews, Gallery, Contact, Blog, Privacy, Terms, plus relevant location/industry pages); seo_blueprint (primary_keywords, secondary_keywords, long_tail_keywords, topic_clusters 3-5 {topic, supporting_keywords}, blog_categories, location_strategy, internal_linking_strategy, content_pillars); crm_blueprint (lead_stages, lead_sources, contact_fields, required_forms array {name, fields}, follow_up_pipeline, appointment_requirements)." },
  { keys: ["email_blueprint", "phone_blueprint", "ai_agent_blueprint", "build_estimate"], brief: "email_blueprint.mailboxes (array {address, purpose} — info@, sales@, support@, billing@, hello@, careers@ plus any others appropriate); phone_blueprint.numbers (array {label, type, purpose} — Business, Sales, Support, WhatsApp, Toll-Free as relevant); ai_agent_blueprint (agents array {role, purpose, tools} covering Sales, Support, Billing, Receptionist, Lead Qualification; knowledge_sources list, escalation_rules list); build_estimate (website_pages number = pages count, blog_categories number, seo_pages number, expected_build_time e.g. \"3-4 days\", estimated_monthly_infrastructure_cost e.g. \"$45/month\" USD)." },
];

function normalize(bp: any): any {
  const root: any = bp && typeof bp === "object" ? bp : {};
  const out: any = {};
  for (const key of Object.keys((BLUEPRINT_SCHEMA as any).properties)) {
    const v = root[key];
    out[key] = v === undefined ? ((BLUEPRINT_SCHEMA as any).properties[key].type === "array" ? [] : {}) : v;
  }
  return out;
}

function failed(error: { code: string; message: string; retryable: boolean }, execIds: string[], lastStage: string, provider?: any) {
  return { status: "failed" as const, output: null, error, last_stage: lastStage, executionIds: execIds, provider };
}

export function createBlueprintAdapter(): Adapter {
  return async (input) => {
    const { svc, run, task, context, resolvedProvider, actor } = input as any;
    const base44 = (svc && svc.__base44) || svc;
    const attempt = task.attempt || 1;
    const execIds: string[] = [];

    // Resume-from-checkpoint: skip "generate" if it already succeeded for this task.
    const done = await svc.entities.AIExecution.filter({ task_id: task.id, success: true }).catch(() => []);
    const doneStages = new Set((done || []).map((e: any) => e.stage));

    const business: any = await svc.entities.Business.get(run.business_id);
    const ctxBusiness = (context && context.business) || {};
    const profile = business?.planner_profile || ctxBusiness?.planner_profile || task.input_context?.business?.planner_profile || null;
    if (!profile || !profile.industry) {
      const id = await recordExecution(svc, { run, task, attempt, stage: "generate", operation: "generate_blueprint.generate", capability: task.provider_capability || "ai_generation", provider: { provider_id: resolvedProvider?.provider_id || "", provider_key: resolvedProvider?.key || resolvedProvider?.provider_key || "", adapter_key: resolvedProvider?.adapter_key || "", name: resolvedProvider?.name || "", category: "", via: resolvedProvider?.via || "" }, model: "", inputHash: task.input_hash, outputHash: hashOf(null), success: false, errorCode: "VALIDATION_FAILED", errorMessage: "No planner_profile found — run the AI Business Planner first.", retryable: false, durationMs: 0, actor });
      return failed({ code: "VALIDATION_FAILED", message: "No planner_profile found on the business — run the AI Business Planner first.", retryable: false }, [id], "generate", resolvedProvider);
    }

    const ctxText = `PLANNER PROFILE (the seed — do NOT re-ask the customer anything):
${JSON.stringify(profile)}

BUSINESS INFO:
Name: ${business?.name || ctxBusiness.name || ""}
Industry: ${business?.industry || ctxBusiness.industry || ""}
Description: ${business?.description || ""}
Country / City: ${business?.country || ctxBusiness.country || ""} / ${business?.city || ctxBusiness.city || ""}
Known services: ${(business?.services_products || ctxBusiness.services_products || []).join(", ") || "(derive from planner)"}
Target customers: ${business?.target_customers || ctxBusiness.target_customers || "(derive from planner)"}

This Business Blueprint is the SINGLE SOURCE OF TRUTH for every downstream engine (website, SEO, CRM, email, phone, AI agents). Be specific, grounded and complete — no placeholders, no "TBD", no commentary. Return ONLY the JSON object. Stay consistent with the brand tone and the planner profile throughout.`;

    const slice = (keys: string[]) => ({ type: "object", additionalProperties: true, properties: Object.fromEntries(keys.map((k) => [k, (BLUEPRINT_SCHEMA as any).properties[k]])), required: keys });

    let raw: any;
    if (doneStages.has("generate")) {
      raw = ((done as any[]).find((e: any) => e.stage === "generate") || {}).output?.raw || {};
    } else {
      const t0 = Date.now();
      const results: StructuredAIResult[] = await Promise.all(SLICES.map((p) =>
        runStructuredAI(base44, svc, {
          tenantId: run.tenant_id, businessId: run.business_id,
          prompt: `You are a senior business strategist and launch planner. ${ctxText}\n\nProduce ONLY these top-level sections as JSON: ${p.brief}`,
          schema: slice(p.keys), stage: `blueprint.${p.keys[0]}`,
        })
      ));
      const failedRes = results.find((r) => !r.ok);
      if (failedRes) {
        const id = await recordExecution(svc, { run, task, attempt, stage: "generate", operation: "generate_blueprint.generate", capability: task.provider_capability || "ai_generation", provider: { provider_id: failedRes.provider_id || "", provider_key: failedRes.provider_key || "", adapter_key: failedRes.adapter_key || "", name: failedRes.provider_key || "", category: "", via: resolvedProvider?.via || "" }, model: failedRes.model || "", inputHash: task.input_hash, outputHash: hashOf(null), success: false, errorCode: failedRes.error_code || "AI_FAILED", errorMessage: failedRes.error_message || "", retryable: true, durationMs: Date.now() - t0, actor });
        return failed({ code: failedRes.error_code || "AI_FAILED", message: failedRes.error_message || "Blueprint AI generation failed.", retryable: true }, [id], "generate", { provider_id: failedRes.provider_id || "", provider_key: failedRes.provider_key || "", adapter_key: failedRes.adapter_key || "" });
      }
      raw = Object.assign({}, ...results.map((r) => r.data));
      const p0 = results[0];
      const id = await recordExecution(svc, { run, task, attempt, stage: "generate", operation: "generate_blueprint.generate", capability: task.provider_capability || "ai_generation", provider: { provider_id: p0.provider_id || "", provider_key: p0.provider_key || "", adapter_key: p0.adapter_key || "", name: p0.provider_key || "", category: "", via: resolvedProvider?.via || "" }, model: p0.model || "", inputHash: task.input_hash, outputHash: hashOf(raw), success: true, durationMs: Date.now() - t0, actor, output: { raw } });
      execIds.push(id);
    }

    // Validate + normalize (deterministic stage).
    const filled = Object.keys(raw).filter((k) => raw[k] && JSON.stringify(raw[k]) !== "{}").length;
    const t1 = Date.now();
    const valid = filled >= 9;
    const blueprint = normalize(raw);
    const valId = await recordExecution(svc, { run, task, attempt, stage: "validate", operation: "generate_blueprint.validate", capability: task.provider_capability || "ai_generation", provider: { provider_id: resolvedProvider?.provider_id || "", provider_key: resolvedProvider?.key || resolvedProvider?.provider_key || "", adapter_key: resolvedProvider?.adapter_key || "", name: resolvedProvider?.name || "", category: "", via: resolvedProvider?.via || "" }, model: "", inputHash: task.input_hash, outputHash: hashOf({ filled, valid }), success: valid, errorCode: valid ? "" : "VALIDATION_FAILED", errorMessage: valid ? "" : `Blueprint generation returned only ${filled} populated sections (need >= 9).`, retryable: !valid, durationMs: Date.now() - t1, actor, output: { filled, valid } });
    execIds.push(valId);
    if (!valid) {
      return failed({ code: "VALIDATION_FAILED", message: `Blueprint generation returned only ${filled} populated sections (need >= 9).`, retryable: true }, execIds, "validate", resolvedProvider);
    }

    // Persist the draft BusinessBlueprint with runtime-truthful provenance.
    const all = await svc.entities.BusinessBlueprint.filter({ business_id: run.business_id });
    const version = (all || []).reduce((m: number, r: any) => Math.max(m, r.version || 0), 0) + 1;
    const lastGen = execIds[0] ? await svc.entities.AIExecution.get(execIds[0]).catch(() => null) : null;
    const rec: any = await svc.entities.BusinessBlueprint.create({
      tenant_id: run.tenant_id, business_id: run.business_id, version, status: "draft",
      blueprint, source_profile: profile,
      generated_by: actor, generated_at: new Date().toISOString(),
      ai_model: lastGen?.model || "automatic",
      ai_provider: lastGen?.provider || resolvedProvider?.key || resolvedProvider?.provider_key || "base44-core",
      prompt_version: BP_PROMPT_VERSION,
      planner_version: (profile && (profile.planner_version || profile.version)) || BP_PLANNER_VERSION_DEFAULT,
      provenance: {
        provider_id: lastGen?.provider_id || resolvedProvider?.provider_id || "",
        provider_key: lastGen?.provider || resolvedProvider?.key || resolvedProvider?.provider_key || "",
        adapter_key: lastGen?.adapter_key || resolvedProvider?.adapter_key || "",
        model: lastGen?.model || "",
        capability: task.provider_capability || "ai_generation",
        execution_id: execIds[0] || null,
        run_id: run.id, task_id: task.id, attempt,
        prompt_version: BP_PROMPT_VERSION,
        fallback_used: !!(lastGen && lastGen.provider && resolvedProvider && lastGen.provider !== (resolvedProvider.key || resolvedProvider.provider_key)),
      },
    });

    return {
      status: "completed" as const,
      output: { blueprint_id: rec.id, version, ai_provider: rec.ai_provider, ai_model: rec.ai_model, provider_id: rec.provenance.provider_id, adapter_key: rec.provenance.adapter_key, sections: filled },
      last_stage: "validate",
      executionIds: execIds,
      provider: resolvedProvider,
    };
  };
}