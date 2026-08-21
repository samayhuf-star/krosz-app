import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Public, read-only help-content API for the Krosz Help Center.
// Anonymous visitors fetch published guide articles + FAQs, and search them here.
// Writes happen in admin (admin token via base44.entities), never through this endpoint.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const sr = base44.asServiceRole.entities;
    const onlyPublished = { status: 'published' };

    if (body.action === 'list-articles') {
      const filter = body.category ? { ...onlyPublished, category: body.category } : onlyPublished;
      const list = await sr.HelpArticle.filter(filter, 'order', 100);
      return Response.json({
        articles: (list || []).map((a) => ({
          id: a.id, category: a.category, slug: a.slug, title: a.title,
          summary: a.summary, icon: a.icon, order: a.order,
        })),
      });
    }

    if (body.action === 'get-article') {
      const list = await sr.HelpArticle.filter({ slug: body.slug, status: 'published' }, 'order', 1);
      const article = (list || [])[0];
      if (!article) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json({ article });
    }

    if (body.action === 'list-faqs') {
      const filter = body.category ? { ...onlyPublished, category: body.category } : onlyPublished;
      const list = await sr.HelpFaq.filter(filter, 'order', 300);
      return Response.json({
        faqs: (list || []).map((f) => ({
          id: f.id, category: f.category, question: f.question, answer: f.answer, order: f.order,
        })),
      });
    }

    if (body.action === 'search') {
      const q = String(body.q || '').trim().toLowerCase();
      if (!q) return Response.json({ articles: [], faqs: [] });
      const terms = q.split(/\s+/).filter(Boolean);
      const matchAll = (text) => {
        if (!text) return false;
        const t = String(text).toLowerCase();
        return terms.every((term) => t.includes(term));
      };
      const [articles, faqs] = await Promise.all([
        sr.HelpArticle.filter(onlyPublished, 'order', 200),
        sr.HelpFaq.filter(onlyPublished, 'order', 400),
      ]);
      const matchedArticles = (articles || []).filter((a) => matchAll([a.title, a.summary, a.body].filter(Boolean).join(' \n '))).map((a) => ({
        id: a.id, category: a.category, slug: a.slug, title: a.title, summary: a.summary, icon: a.icon,
      }));
      const matchedFaqs = (faqs || []).filter((f) => matchAll([f.question, f.answer, ...(f.keywords || [])].filter(Boolean).join(' \n '))).map((f) => ({
        id: f.id, category: f.category, question: f.question, answer: f.answer,
      }));
      return Response.json({ articles: matchedArticles, faqs: matchedFaqs });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}