// Lightweight, deterministic Business Health for the customer experience.
// Draws only on entity surfaces the customer can see — never reads platform
// internals. Used by the Home command center and the Business cards.

export function computeBusinessHealth({
  domains = [], websites = [], pages = [], leads = [], contacts = [],
  tickets = [], messages = [], aiExecs = [],
}) {
  const domainActive = domains.some((d) => d.status === 'active' || d.status === 'registered');
  const websitePublished = websites.some((w) => w.status === 'published');
  const websitePages = pages.length;
  const seoPages = pages.filter((p) => p.status === 'published').length;
  const crmActive = leads.length > 0;
  const unreadMsgs = messages.filter((m) => m.is_unread).length;
  const needsReply = messages.filter((m) => m.needs_reply).length;
  const ticketsOpen = tickets.filter((t) => !['resolved', 'closed', 'cancelled'].includes(t.status)).length;
  const aiSuccessRate = aiExecs.length ? Math.round((aiExecs.filter((e) => e.success).length / aiExecs.length) * 100) : 100;

  const domain = domainActive ? 100 : 30;
  const website = !websites.length ? 0 : websitePublished ? 100 : websitePages ? 65 : 30;
  const seo = seoPages ? Math.min(100, 55 + seoPages * 5) : 0;
  const crm = !leads.length ? 0 : Math.min(100, 45 + Math.min(leads.length, 11) * 5);
  const communication = !messages.length ? 0 : Math.max(35, 100 - Math.min(50, unreadMsgs * 4 + needsReply * 3 + ticketsOpen * 2));
  const security = Math.round((aiSuccessRate + (domainActive ? 100 : 55)) / 2);
  const launch = Math.round([domainActive, websitePublished, seoPages > 0, crmActive, messages.length > 0].filter(Boolean).length / 5 * 100);

  const overall = Math.round(domain * 0.1 + website * 0.2 + seo * 0.2 + crm * 0.2 + communication * 0.1 + launch * 0.2);

  return {
    scores: { overall, launch, website, seo, crm, communication, domain, security },
    reasons: {
      overall: overall >= 80 ? 'Your business is launch-ready and operating well.' : overall >= 50 ? 'Good progress — a few areas need attention.' : 'Early stage — focus on the highlighted next steps.',
      launch: launch === 100 ? 'Every launch pillar is in place.' : `${launch}% of launch pillars complete.`,
      website: !websites.length ? 'No website generated yet.' : websitePublished ? `Published website with ${websitePages} pages.` : 'Website drafted — publish to go live.',
      seo: seoPages ? `${seoPages} optimized pages live.` : 'No published SEO content yet.',
      crm: !leads.length ? 'No leads captured yet.' : `${leads.length} leads in your pipeline.`,
      communication: !messages.length ? 'No mailbox connected yet.' : `${unreadMsgs} unread · ${needsReply} need a reply.`,
      domain: domainActive ? 'Domain registered and active.' : 'No active domain yet.',
      security: `AI runtime ${aiSuccessRate}% success · ${domainActive ? 'domain verified' : 'domain pending'}.`,
    },
  };
}