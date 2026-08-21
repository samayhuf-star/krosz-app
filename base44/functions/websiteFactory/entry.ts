import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { stageArchitecture, stageSitemap, stagePage, stageMedia, validateWebsite, WF_PROMPT_VERSION, WF_AI_PROVIDER, WF_AI_MODEL } from '../../shared/website/factory.ts';
import { runAIStage } from '../../shared/ai/stages.ts';

// AI Website Factory — orchestrates the pipeline that converts an APPROVED
// Business Blueprint into a versioned, publishable website. Consumes only the
// approved blueprint version; never re-reads the customer's raw input.
// Pipeline: architecture + sitemap (parallel) → per-page components+content+SEO
// (parallel) → media plan → validation (deterministic) → publish-ready draft.

const actorName = (u: any) => (u && (u.full_name || u.email)) || (u && u.id) || 'system';
const prov = (t0: number, llmCalls: number, status = 'complete') => ({ ai_provider: WF_AI_PROVIDER, ai_model: WF_AI_MODEL, prompt_version: WF_PROMPT_VERSION, generation_time_ms: Date.now() - t0, token_usage: { llm_calls: llmCalls }, generation_status: status });

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const businessId = body.business_id;

    const latestApproved = async (bid: string) => {
      const all = await svc.entities.BusinessBlueprint.filter({ business_id: bid });
      return (all || []).filter((r: any) => r.status === 'approved').sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0] || null;
    };
    const listWebsites = async (bid: string) => {
      const all = await base44.entities.Website.filter({ business_id: bid });
      return (all || []).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
    };
    // Website Factory now delegates every AI call to the Shared AI Execution Engine
    // (audit trail, prompt version, usage logging, retry). The pure stages still
    // receive the same injected (prompt, schema) => data contract — no stage logic changed.
    const llm = async (prompt: string, schema: any) => {
      const r = await runAIStage(base44, { prompt, schema, stage: 'website.stage', promptVersion: WF_PROMPT_VERSION, business_id: businessId });
      if (!r.ok || r.data == null) throw new Error(r.error?.message || 'AI stage failed');
      return r.data;
    };

    // ---------- STATUS ----------
    if (action === 'status') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      const approved = await latestApproved(businessId);
      const websites = await listWebsites(businessId);
      let active: any = null;
      const activeRec = websites.find((w: any) => w.status === 'published') || websites[0] || null;
      if (activeRec) {
        const [arch] = (await base44.entities.WebsiteArchitecture.filter({ website_id: activeRec.id })).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
        const pages = await base44.entities.WebsitePage.filter({ website_id: activeRec.id });
        const components = await base44.entities.ComponentInstance.filter({ website_id: activeRec.id });
        const media = await base44.entities.MediaPlan.filter({ website_id: activeRec.id });
        const [validation] = (await base44.entities.ValidationReport.filter({ website_id: activeRec.id })).sort((a: any, b: any) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
        const publishHistory = (await base44.entities.PublishHistory.filter({ website_id: activeRec.id })).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
        const compsByPage: Record<string, any[]> = {};
        components.forEach((c: any) => { (compsByPage[c.page_id] ||= []).push(c); });
        active = {
          website: activeRec,
          architecture: arch || null,
          pages: pages.map((p: any) => ({ ...p, components: (compsByPage[p.id] || []).sort((a: any, b: any) => (a.order || 0) - (b.order || 0)) })),
          media, validation, publishHistory,
        };
      }
      return Response.json({ business: { id: business.id, name: business.name }, blueprint: approved ? { id: approved.id, version: approved.version } : null, websites: websites.map((w: any) => ({ id: w.id, version: w.version, status: w.status, name: w.name, summary: w.summary, published_at: w.published_at })), active });
    }

    // ---------- GENERATE ----------
    if (action === 'generate') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      const approved = await latestApproved(businessId);
      if (!approved) return Response.json({ error: 'No approved Business Blueprint. Approve a blueprint in the Blueprint page first.' }, { status: 404 });
      const t0 = Date.now();
      const blue = approved;

      // Stage 1 + 2 in parallel (both depend only on the blueprint).
      const [architecture, sitemap] = await Promise.all([stageArchitecture(llm, blue), stageSitemap(llm, blue)]);

      // Stages 3 + 4 + 5 per page in parallel (each page → components + content + SEO).
      const pageResults = await Promise.all(sitemap.map(async (p: any) => {
        try { return { page: p, data: await stagePage(llm, blue, architecture, p), ok: true }; }
        catch (e: any) { return { page: p, data: null, ok: false, err: e.message }; }
      }));

      // Create the Website draft so every following record can reference it.
      const websites = await listWebsites(businessId);
      const version = (websites.reduce((m: number, w: any) => Math.max(m, w.version || 0), 0)) + 1;
      const website: any = await base44.entities.Website.create({
        tenant_id: business.tenant_id, business_id: businessId, blueprint_id: approved.id, blueprint_version: approved.version,
        version, status: 'draft', name: `${architecture.name || business.name} Website`,
        generated_by: actorName(user), generated_at: new Date().toISOString(), provenance: prov(t0, 2 + pageResults.length + 1, 'pending'),
      });

      // Architecture record (Stage 1 frozen output).
      await base44.entities.WebsiteArchitecture.create({
        tenant_id: business.tenant_id, business_id: businessId, website_id: website.id, version,
        name: architecture.name, navigation: architecture.navigation, footer: architecture.footer, primary_cta: architecture.primary_cta, secondary_cta: architecture.secondary_cta,
        brand_theme: architecture.brand_theme, color_palette: architecture.color_palette, typography: architecture.typography, spacing: architecture.spacing, grid_system: architecture.grid_system,
        icon_style: architecture.icon_style, image_style: architecture.image_style, animation_style: architecture.animation_style,
        component_library: architecture.component_library, design_tokens: architecture.design_tokens, responsive_rules: architecture.responsive_rules, accessibility_rules: architecture.accessibility_rules,
        provenance: prov(t0, 1, 'complete'),
      });

      // Pages (Stage 2 architecture + Stage 5 SEO from the per-page stage).
      const pageRecords = await base44.entities.WebsitePage.bulkCreate(
        pageResults.map((r: any) => {
          const p = r.page; const seo = (r.data && r.data.seo) || {};
          return {
            tenant_id: business.tenant_id, business_id: businessId, website_id: website.id, version,
            title: p.title, slug: p.slug, url: p.url, purpose: p.purpose, audience: p.audience, primary_cta: p.primary_cta,
            seo_intent: p.seo_intent, parent: p.parent, children: p.children || [], priority: p.priority, template: p.template,
            seo: { ...seo, slug: seo.slug || p.slug },
            provenance: prov(t0, 1, r.ok ? 'complete' : 'failed'),
          };
        })
      );

      // Component instances (Stage 3 + 4) mapped to page ids.
      const slugToPageId: Record<string, string> = {};
      pageRecords.forEach((p: any) => { slugToPageId[p.slug] = p.id; });
      const componentDocs: any[] = [];
      pageResults.forEach((r: any) => {
        const pageId = slugToPageId[r.page.slug];
        const comps = (r.data && Array.isArray(r.data.components) && r.data.components.length) ? r.data.components : [];
        if (!comps.length) {
          componentDocs.push({ tenant_id: business.tenant_id, business_id: businessId, website_id: website.id, page_id: pageId, version, component_key: 'hero', name: r.page.title, order: 1, visible: true, properties: { headline: r.page.title, subheadline: r.page.purpose || '', body: '', cta_text: r.page.primary_cta || '', faq: [], image_suggestion: '', internal_links: [] }, responsive: { mobile: '', tablet: '', desktop: '' }, provenance: prov(t0, 0, 'failed') });
          return;
        }
        comps.forEach((c: any) => componentDocs.push({
          tenant_id: business.tenant_id, business_id: businessId, website_id: website.id, page_id: pageId, version,
          component_key: c.key, name: c.name, order: c.order ?? 1, visible: c.visible !== false,
          properties: c.properties || {}, responsive: c.responsive || {},
          provenance: prov(t0, 0, r.ok ? 'complete' : 'failed'),
        }));
      });
      let components: any[] = [];
      if (componentDocs.length) components = await base44.entities.ComponentInstance.bulkCreate(componentDocs);

      // Stage 6 — Media plan.
      const mediaItems = await stageMedia(llm, blue, architecture, pageResults.map((r: any) => r.page));
      let media: any[] = [];
      if (mediaItems.length) media = await base44.entities.MediaPlan.bulkCreate(mediaItems.map((m: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, website_id: website.id, version,
        page_id: slugToPageId[m.page_slug] || null, page_slug: m.page_slug, section: m.section, component_key: m.component_key,
        media_type: m.media_type, purpose: m.purpose, aspect_ratio: m.aspect_ratio, image_prompt: m.image_prompt, alt_text: m.alt_text,
        provenance: prov(t0, 1, 'complete'),
      })));

      // Stage 7 — Validation (deterministic, no LLM).
      const compsByPage: Record<string, any[]> = {};
      components.forEach((c: any) => { const slug = Object.entries(slugToPageId).find(([, id]) => id === c.page_id)?.[0]; if (slug) (compsByPage[slug] ||= []).push(c); });
      const report = validateWebsite(architecture, pageRecords, compsByPage);
      await base44.entities.ValidationReport.create({
        tenant_id: business.tenant_id, business_id: businessId, website_id: website.id,
        status: report.status, checks: report.checks, summary: report.summary, provenance: prov(t0, 0, 'complete'),
      });

      // Finalize the website with summary + provenance.
      const summary = {
        page_count: pageRecords.length,
        component_count: components.length,
        media_count: media.length,
        seo_summary: { pages: pageRecords.length, with_meta: pageRecords.filter((p: any) => p.seo && p.seo.seo_title).length },
        media_summary: { items: media.length, types: [...new Set(media.map((m: any) => m.media_type))] },
        validation_summary: report.summary,
        estimated_publish_time: 'Synchronous — ready to publish now',
      };
      const updated: any = await base44.entities.Website.update(website.id, { summary, provenance: prov(t0, 2 + pageResults.length + 1, 'complete') });

      return Response.json({ website: updated, architecture: { name: architecture.name, components: architecture.component_library.length, color_palette: architecture.color_palette }, pages: pageRecords.length, components: components.length, media: media.length, validation: report, summary });
    }

    // ---------- PUBLISH ----------
    if (action === 'publish') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const websites = await listWebsites(businessId);
      const draft = body.website_id ? websites.find((w: any) => w.id === body.website_id) : websites.find((w: any) => w.status === 'draft');
      if (!draft) return Response.json({ error: 'No draft website to publish. Generate first.' }, { status: 400 });
      for (const w of websites) if (w.status === 'published' && w.id !== draft.id) await svc.entities.Website.update(w.id, { status: 'superseded' });
      const pages = await base44.entities.WebsitePage.filter({ website_id: draft.id });
      const components = await base44.entities.ComponentInstance.filter({ website_id: draft.id });
      const media = await base44.entities.MediaPlan.filter({ website_id: draft.id });
      const validation = (await base44.entities.ValidationReport.filter({ website_id: draft.id }))[0];
      const published: any = await base44.entities.Website.update(draft.id, { status: 'published', is_published: true, published_by: actorName(user), published_at: new Date().toISOString() });
      const history = await base44.entities.PublishHistory.create({
        tenant_id: draft.tenant_id, business_id: businessId, website_id: draft.id, version: draft.version,
        published_by: actorName(user), published_at: new Date().toISOString(),
        page_count: pages.length, component_count: components.length, media_count: media.length,
        summary: { validation_status: validation?.status || 'unknown' },
        provenance: prov(Date.now(), 0, 'complete'),
      });
      return Response.json({ website: published, publish_history: history });
    }

    // ---------- ROLLBACK ----------
    if (action === 'rollback') {
      const { website_id } = body;
      if (!website_id) return Response.json({ error: 'website_id is required' }, { status: 400 });
      const rec: any = await base44.entities.Website.get(website_id);
      const websites = await listWebsites(rec.business_id);
      for (const w of websites) if (w.status === 'published') await svc.entities.Website.update(w.id, { status: 'superseded' });
      const active: any = await base44.entities.Website.update(website_id, { status: 'published', is_published: true });
      return Response.json({ website: active });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any).message }, { status: 500 });
  }
}