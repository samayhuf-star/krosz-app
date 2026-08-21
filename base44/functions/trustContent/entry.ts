import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Public, read-only content API for the Krosz legal/trust pages.
// Anonymous visitors fetch current policies + business trust config here.
// Writes happen in admin (admin token via base44.entities), never through this endpoint.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const sr = base44.asServiceRole.entities;

    if (body.action === 'list-policies') {
      const list = await sr.PolicyVersion.filter({ is_current: true }, '-effective_from', 100);
      return Response.json({
        policies: (list || []).map((p) => ({
          policy_key: p.policy_key, title: p.title, category: p.category,
          version: p.version, status: p.status, summary: p.summary,
          effective_from: p.effective_from, needs_legal_review: p.needs_legal_review,
        })),
      });
    }

    if (body.action === 'get-policy') {
      const list = await sr.PolicyVersion.filter({ policy_key: body.policy_key, is_current: true }, '-effective_from', 1);
      const policy = (list || [])[0];
      if (!policy) return Response.json({ error: 'Not found' }, { status: 404 });
      const cfgList = await sr.BusinessTrustConfig.list('-updated_date', 1);
      return Response.json({ policy, config: (cfgList || [])[0] || null });
    }

    if (body.action === 'get-business-config') {
      const list = await sr.BusinessTrustConfig.list('-updated_date', 1);
      return Response.json({ config: (list || [])[0] || null });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}