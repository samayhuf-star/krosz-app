// Real Orchestrator adapter for `generate_website`.
//
// Reuses the pure Website Factory pipeline stages (architecture → sitemap →
// pages → media → validation) but executes every AI call through the orchestrator's
// truthful provider path (runStructuredAI). The stage logic is unchanged; only the
// LLM transport + provenance are truthful. Records per-stage AIExecution checkpoints
// (resume-from-checkpoint) and writes Website/WebsiteArchitecture/WebsitePage/
// ComponentInstance/MediaPlan/ValidationReport with runtime-truthful provenance.
//
// Returns the dispatch contract shape engine.dispatchTask already expects:
//   { status: 'completed'|'failed', output, error, last_stage, executionIds }

import {
  stageArchitecture, stageSitemap, stagePage, stageMedia, validateWebsite,
  blueprintContext, WF_PROMPT_VERSION,
} from "../../website/factory.ts";
import type { LLM } from "../../website/factory.ts";
import { recordExecution, hashOf } from "../adapterContract.ts";
import { runStructuredAI } from "../ai_provider.ts";
import type { Adapter } from "../adapters.ts";

interface ProvInfo { provider_id: string; provider_key: string; adapter_key: string; model: string }

export function createWebsiteAdapter(): Adapter {
  return async (input) => {
    const { svc, run, task, context, resolvedProvider, actor } = input as any;
    const base44 = (svc && svc.__base44) || svc;
    const attempt = task.attempt || 1;
    const execIds: string[] = [];
    const stageProviders: Record<string, ProvInfo> = {};
    const callProviders: Record<string, ProvInfo> = {};

    // Resume-from-checkpoint: stages whose AIExecution already succeeded.
    const doneRows = await svc.entities.AIExecution.filter({ task_id: task.id, success: true }).catch(() => []);
    const done = new Set((doneRows || []).map((e: any) => e.stage));
    const ckptOf = async (stage: string): Promise<any | null> => {
      const rows = (doneRows || []).filter((e: any) => e.stage === stage);
      if (!rows.length) return null;
      return rows.sort((a: any, b: any) => String(b.created_date || "").localeCompare(String(a.created_date || "")))[0].output || null;
    };

    const providerRef = (stage: string): any => {
      const p = stageProviders[stage] || ({} as ProvInfo);
      return {
        provider_id: p.provider_id || resolvedProvider?.provider_id || "",
        provider_key: p.provider_key || resolvedProvider?.key || resolvedProvider?.provider_key || "",
        adapter_key: p.adapter_key || resolvedProvider?.adapter_key || "",
        name: p.provider_key || resolvedProvider?.name || "",
        category: "", via: resolvedProvider?.via || "",
      };
    };
    const modelOf = (stage: string) => (stageProviders[stage] || ({} as ProvInfo)).model || "";

    const checkpoint = async (stage: string, success: boolean, output: any, durationMs: number, errorCode = "", errorMessage = "", retryable = false) => {
      // AIExecution.output must be a dict; stages produce arrays (sitemap/pages/media) → wrap.
      const outObj: any = output == null ? {} : (Array.isArray(output) ? { items: output, count: output.length } : (typeof output === "object" ? output : { value: output }));
      const id = await recordExecution(svc, {
        run, task, attempt, stage, operation: `generate_website.${stage}`,
        capability: task.provider_capability || "ai_generation",
        provider: providerRef(stage), model: modelOf(stage),
        inputHash: task.input_hash, outputHash: hashOf(outObj),
        success, errorCode, errorMessage, retryable, durationMs, actor, output: outObj,
      });
      execIds.push(id);
    };

    // mkLLM — routes one LLM call through the truthful provider runtime.
    // `coarse` is the resume-checkpoint stage (architecture/sitemap/pages/media);
    // `fine` is the per-call label used only on a failure-checkpoint trace.
    // The runtime provider that ACTUALLY executed is stashed under the coarse key
    // (and the fine key for per-page provenance) — checkpoints read the coarse key
    // so their `provider` field reflects the real executor, never the resolved one.
    const mkLLM = (coarse: string, fine: string): LLM => async (prompt, schema) => {
      const t = Date.now();
      const r = await runStructuredAI(base44, svc, { tenantId: run.tenant_id, businessId: run.business_id, prompt, schema, stage: fine });
      const info: ProvInfo = { provider_id: r.provider_id, provider_key: r.provider_key, adapter_key: r.adapter_key, model: r.model };
      stageProviders[coarse] = info;
      callProviders[fine] = info;
      if (!r.ok || r.data == null) {
        await checkpoint(fine, false, { runtime: { provider_key: r.provider_key, error_code: r.error_code } }, Date.now() - t, r.error_code || "AI_FAILED", r.error_message || `${fine} AI generation failed`, true);
        throw new Error(r.error_message || `${fine} AI generation failed`);
      }
      return r.data;
    };

    // --- Load approved blueprint (single source of truth). ---
    const blue: any = await (async () => {
      const ctxBp = context?.business?.approved_blueprint;
      if (ctxBp && ctxBp.id) {
        try { return await svc.entities.BusinessBlueprint.get(ctxBp.id); } catch {}
      }
      const all = await svc.entities.BusinessBlueprint.filter({ business_id: run.business_id });
      return (all || []).filter((x: any) => x.status === "approved").sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0] || null;
    })();
    if (!blue) {
      await checkpoint("architecture", false, null, 0, "VALIDATION_FAILED", "No approved Business Blueprint yet — approve a blueprint first.", false);
      return { status: "failed", output: null, error: { code: "VALIDATION_FAILED", message: "No approved Business Blueprint yet — approve a blueprint first.", retryable: false }, last_stage: "architecture", executionIds: execIds };
    }

    // --- Stage: architecture ---
    let architecture: any;
    if (done.has("architecture")) {
      architecture = await ckptOf("architecture");
    } else {
      const t = Date.now();
      try { architecture = await stageArchitecture(mkLLM("architecture", "website.architecture"), blue); await checkpoint("architecture", true, architecture, Date.now() - t); }
      catch (e: any) { return { status: "failed", output: null, error: { code: "FACTORY_FAILED", message: e.message, retryable: true }, last_stage: "architecture", executionIds: execIds }; }
    }

    // --- Stage: sitemap ---
    let sitemapPages: any[];
    if (done.has("sitemap")) {
      sitemapPages = await ckptOf("sitemap");
    } else {
      const t = Date.now();
      try { sitemapPages = await stageSitemap(mkLLM("sitemap", "website.sitemap"), blue); await checkpoint("sitemap", true, sitemapPages, Date.now() - t); }
      catch (e: any) { return { status: "failed", output: null, error: { code: "FACTORY_FAILED", message: e.message, retryable: true }, last_stage: "sitemap", executionIds: execIds }; }
    }

    // --- Ensure the Website draft exists (tied to this run for resume). ---
    let website: any = null;
    const existing = await svc.entities.Website.filter({ business_id: run.business_id }).catch(() => []);
    website = (existing || []).find((w: any) => w.status === "draft" && w.provenance && w.provenance.run_id === run.id) || null;
    if (!website) {
      const version = (existing || []).reduce((m: number, w: any) => Math.max(m, w.version || 0), 0) + 1;
      const rep = stageProviders["architecture"] || ({} as ProvInfo);
      website = await svc.entities.Website.create({
        tenant_id: run.tenant_id, business_id: run.business_id, blueprint_id: blue.id, blueprint_version: blue.version,
        version, status: "draft", name: `${architecture.name || run.business_id} Website`,
        generated_by: actor, generated_at: new Date().toISOString(),
        provenance: {
          ai_provider: rep.provider_key || resolvedProvider?.key || "base44-core",
          ai_model: rep.model || "", prompt_version: WF_PROMPT_VERSION,
          provider_id: rep.provider_id || resolvedProvider?.provider_id || "",
          adapter_key: rep.adapter_key || resolvedProvider?.adapter_key || "",
          run_id: run.id, task_id: task.id, attempt, generation_status: "pending",
        },
      });
    } else if (website.provenance && (website.provenance.ai_provider === "base44-core" || !website.provenance.provider_id)) {
      // First attempt may have stashed resolved (non-runtime) provider; refresh with truthful.
      const rep = stageProviders["architecture"];
      if (rep && rep.provider_id) {
        website = await svc.entities.Website.update(website.id, { provenance: { ...website.provenance, ai_provider: rep.provider_key, ai_model: rep.model, provider_id: rep.provider_id, adapter_key: rep.adapter_key } });
      }
    }

    // --- Stage: pages (components + content + SEO per page, parallel, resilient per page). ---
    let pageResults: any[];
    if (done.has("pages")) {
      pageResults = (await ckptOf("pages")) || [];
    } else {
      const t = Date.now();
      pageResults = await Promise.all(sitemapPages.map(async (p: any) => {
        try { return { page: p, data: await stagePage(mkLLM("pages", `website.page.${p.slug}`), blue, architecture, p), ok: true }; }
        catch (e: any) { return { page: p, data: null, ok: false, err: e.message }; }
      }));
      await checkpoint("pages", true, pageResults, Date.now() - t);
    }

    // Persist WebsiteArchitecture (create-if-missing).
    const archExisting = (await svc.entities.WebsiteArchitecture.filter({ website_id: website.id }).catch(() => []))[0];
    if (!archExisting) {
      const rep = stageProviders["architecture"] || ({} as ProvInfo);
      await svc.entities.WebsiteArchitecture.create({
        tenant_id: run.tenant_id, business_id: run.business_id, website_id: website.id, version: website.version,
        name: architecture.name, navigation: architecture.navigation, footer: architecture.footer, primary_cta: architecture.primary_cta, secondary_cta: architecture.secondary_cta,
        brand_theme: architecture.brand_theme, color_palette: architecture.color_palette, typography: architecture.typography, spacing: architecture.spacing, grid_system: architecture.grid_system,
        icon_style: architecture.icon_style, image_style: architecture.image_style, animation_style: architecture.animation_style,
        component_library: architecture.component_library, design_tokens: architecture.design_tokens, responsive_rules: architecture.responsive_rules, accessibility_rules: architecture.accessibility_rules,
        provenance: { ai_provider: rep.provider_key || resolvedProvider?.key || "base44-core", ai_model: rep.model || "", prompt_version: WF_PROMPT_VERSION, provider_id: rep.provider_id || "", adapter_key: rep.adapter_key || "", run_id: run.id, task_id: task.id, attempt },
      });
    }

    // Persist WebsitePage + ComponentInstance (only if pages ran this attempt).
    let pageRecords: any[] = [];
    const pageExisting = await svc.entities.WebsitePage.filter({ website_id: website.id }).catch(() => []);
    if (done.has("pages") && pageExisting.length) {
      pageRecords = pageExisting;
    } else {
      // Clear any partial from a prior failed attempt for this website version.
      if (pageExisting.length) await svc.entities.WebsitePage.deleteMany({ website_id: website.id, version: website.version }).catch(() => {});
      const compExisting = await svc.entities.ComponentInstance.filter({ website_id: website.id }).catch(() => []);
      if (compExisting.length) await svc.entities.ComponentInstance.deleteMany({ website_id: website.id, version: website.version }).catch(() => {});

      pageRecords = await svc.entities.WebsitePage.bulkCreate(pageResults.map((r: any) => {
        const p = r.page; const seo = (r.data && r.data.seo) || {};
        const rep = callProviders[`website.page.${p.slug}`] || stageProviders["pages"] || ({} as ProvInfo);
        return {
          tenant_id: run.tenant_id, business_id: run.business_id, website_id: website.id, version: website.version,
          title: p.title, slug: p.slug, url: p.url, purpose: p.purpose, audience: p.audience, primary_cta: p.primary_cta,
          seo_intent: p.seo_intent, parent: p.parent, children: p.children || [], priority: p.priority, template: p.template,
          seo: { ...seo, slug: seo.slug || p.slug },
          provenance: { ai_provider: rep.provider_key || "base44-core", ai_model: rep.model || "", prompt_version: WF_PROMPT_VERSION, provider_id: rep.provider_id || "", adapter_key: rep.adapter_key || "", run_id: run.id, task_id: task.id, attempt, generation_status: r.ok ? "complete" : "failed" },
        };
      }));
      const slugToPageId: Record<string, string> = {};
      pageRecords.forEach((p: any) => { slugToPageId[p.slug] = p.id; });
      const componentDocs: any[] = [];
      pageResults.forEach((r: any) => {
        const pageId = slugToPageId[r.page.slug];
        const comps = (r.data && Array.isArray(r.data.components) && r.data.components.length) ? r.data.components : [];
        if (!comps.length) {
          componentDocs.push({ tenant_id: run.tenant_id, business_id: run.business_id, website_id: website.id, page_id: pageId, version: website.version, component_key: "hero", name: r.page.title, order: 1, visible: true, properties: { headline: r.page.title, subheadline: r.page.purpose || "", body: "", cta_text: r.page.primary_cta || "", faq: [], image_suggestion: "", internal_links: [] }, responsive: { mobile: "", tablet: "", desktop: "" }, provenance: { ai_provider: "base44-core", prompt_version: WF_PROMPT_VERSION, run_id: run.id, task_id: task.id, attempt, generation_status: "failed" } });
          return;
        }
        comps.forEach((c: any) => componentDocs.push({
          tenant_id: run.tenant_id, business_id: run.business_id, website_id: website.id, page_id: pageId, version: website.version,
          component_key: c.key, name: c.name, order: c.order ?? 1, visible: c.visible !== false,
          properties: c.properties || {}, responsive: c.responsive || {},
          provenance: { ai_provider: callProviders[`website.page.${r.page.slug}`]?.provider_key || stageProviders["pages"]?.provider_key || "base44-core", provider_id: callProviders[`website.page.${r.page.slug}`]?.provider_id || stageProviders["pages"]?.provider_id || "", adapter_key: callProviders[`website.page.${r.page.slug}`]?.adapter_key || stageProviders["pages"]?.adapter_key || "", prompt_version: WF_PROMPT_VERSION, run_id: run.id, task_id: task.id, attempt, generation_status: "complete" },
        }));
      });
      if (componentDocs.length) await svc.entities.ComponentInstance.bulkCreate(componentDocs);
    }

    // --- Stage: media ---
    let mediaItems: any[] = [];
    if (done.has("media")) {
      mediaItems = (await ckptOf("media")) || [];
    } else {
      const t = Date.now();
      try { mediaItems = await stageMedia(mkLLM("media", "website.media"), blue, architecture, pageResults.map((r: any) => r.page)); await checkpoint("media", true, mediaItems, Date.now() - t); }
      catch (e: any) { return { status: "failed", output: null, error: { code: "FACTORY_FAILED", message: e.message, retryable: true }, last_stage: "media", executionIds: execIds }; }
    }
    const mediaExisting = await svc.entities.MediaPlan.filter({ website_id: website.id }).catch(() => []);
    let media: any[] = [];
    if (done.has("media") && mediaExisting.length) {
      media = mediaExisting;
    } else {
      if (mediaExisting.length) await svc.entities.MediaPlan.deleteMany({ website_id: website.id, version: website.version }).catch(() => {});
      const slugToPageId: Record<string, string> = {};
      pageRecords.forEach((p: any) => { slugToPageId[p.slug] = p.id; });
      const rep = stageProviders["media"] || ({} as ProvInfo);
      if (mediaItems.length) media = await svc.entities.MediaPlan.bulkCreate(mediaItems.map((m: any) => ({
        tenant_id: run.tenant_id, business_id: run.business_id, website_id: website.id, version: website.version,
        page_id: slugToPageId[m.page_slug] || null, page_slug: m.page_slug, section: m.section, component_key: m.component_key,
        media_type: m.media_type, purpose: m.purpose, aspect_ratio: m.aspect_ratio, image_prompt: m.image_prompt, alt_text: m.alt_text,
        provenance: { ai_provider: rep.provider_key || "base44-core", ai_model: rep.model || "", prompt_version: WF_PROMPT_VERSION, provider_id: rep.provider_id || "", adapter_key: rep.adapter_key || "", run_id: run.id, task_id: task.id, attempt },
      })));
    }

    // --- Stage: validation (deterministic, no LLM). Build compsByPage from persisted components. ---
    const components = await svc.entities.ComponentInstance.filter({ website_id: website.id }).catch(() => []);
    const slugToPageId: Record<string, string> = {};
    const idToSlug: Record<string, string> = {};
    pageRecords.forEach((p: any) => { slugToPageId[p.slug] = p.id; idToSlug[p.id] = p.slug; });
    const compsByPage: Record<string, any[]> = {};
    components.forEach((c: any) => { const slug = idToSlug[c.page_id]; if (slug) (compsByPage[slug] ||= []).push(c); });
    const report = validateWebsite(architecture, pageRecords.map((p: any) => ({ ...p, slug: p.slug, seo: p.seo, primary_cta: p.primary_cta })), compsByPage);
    // Use resolved (non-AI) provider stamp for the deterministic validation checkpoint, but keep truthful for AI stages.
    await svc.entities.ValidationReport.create({
      tenant_id: run.tenant_id, business_id: run.business_id, website_id: website.id,
      status: report.status, checks: report.checks, summary: report.summary,
      provenance: { prompt_version: WF_PROMPT_VERSION, run_id: run.id, task_id: task.id, attempt, generation_status: "complete", deterministic: true },
    }).then((r: any) => execIds.push(r?.id || null));

    // --- Finalize website summary + truthful provenance. ---
    const summary = {
      page_count: pageRecords.length, component_count: components.length, media_count: media.length,
      seo_summary: { pages: pageRecords.length, with_meta: pageRecords.filter((p: any) => p.seo && p.seo.seo_title).length },
      media_summary: { items: media.length, types: [...new Set(media.map((m: any) => m.media_type))] },
      validation_summary: report.summary, estimated_publish_time: "Synchronous — ready to publish now",
    };
    const rep = stageProviders["architecture"] || ({} as ProvInfo);
    const updated: any = await svc.entities.Website.update(website.id, {
      summary,
      provenance: {
        ai_provider: rep.provider_key || resolvedProvider?.key || "base44-core",
        ai_model: rep.model || "", prompt_version: WF_PROMPT_VERSION,
        provider_id: rep.provider_id || resolvedProvider?.provider_id || "",
        adapter_key: rep.adapter_key || resolvedProvider?.adapter_key || "",
        run_id: run.id, task_id: task.id, attempt, generation_status: "complete",
        stage_providers: Object.fromEntries(Object.entries(stageProviders)),
      },
    });

    return {
      status: "completed",
      output: { website_id: updated.id, version: updated.version, page_count: pageRecords.length, component_count: components.length, media_count: media.length, validation_status: report.status, ai_provider: rep.provider_key, provider_id: rep.provider_id },
      last_stage: "validation",
      executionIds: execIds,
      provider: resolvedProvider,
    };
  };
}