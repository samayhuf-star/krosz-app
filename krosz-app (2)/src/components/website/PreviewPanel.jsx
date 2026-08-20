import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

function resolveColors(architecture) {
  const pal = architecture?.color_palette || [];
  const pick = (role) => pal.find((c) => (c.role || '').toLowerCase() === role)?.hex;
  const primary = pick('primary') || pal[0]?.hex || '#0f766e';
  const accent = pick('accent') || pal.find((c) => (c.role || '').toLowerCase() === 'accent')?.hex || '#ea580c';
  const bg = pick('background') || pal.find((c) => /background|surface/i.test(c.role || ''))?.hex || '#ffffff';
  const text = pick('secondary text') || pal.find((c) => /text/i.test(c.role || ''))?.hex || '#334155';
  return { primary, accent, bg, text };
}

function ComponentPreview({ comp, colors, fonts }) {
  const p = comp.properties || {};
  const key = (comp.component_key || '').toLowerCase();

  if (key.includes('hero') || key.includes('header')) {
    return (
      <section style={{ background: colors.primary }} className="px-8 py-16 text-center text-white">
        {p.headline && <h2 style={{ fontFamily: fonts.heading }} className="text-3xl font-bold sm:text-4xl">{p.headline}</h2>}
        {p.subheadline && <p className="mx-auto mt-3 max-w-2xl text-base text-white/85">{p.subheadline}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {p.cta_text && <span className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold" style={{ color: colors.primary }}>{p.cta_text}</span>}
          {p.cta_secondary && <span className="rounded-lg border border-white/60 px-5 py-2.5 text-sm font-semibold text-white">{p.cta_secondary}</span>}
        </div>
      </section>
    );
  }
  if (key.includes('cta')) {
    return (
      <section style={{ background: colors.accent }} className="px-8 py-12 text-center text-white">
        {p.headline && <h3 style={{ fontFamily: fonts.heading }} className="text-2xl font-bold">{p.headline}</h3>}
        {p.subheadline && <p className="mx-auto mt-2 max-w-xl text-sm text-white/85">{p.subheadline}</p>}
        {p.cta_text && <span className="mt-4 inline-block rounded-lg bg-white px-5 py-2 text-sm font-semibold" style={{ color: colors.accent }}>{p.cta_text}</span>}
      </section>
    );
  }
  if (key.includes('feature') || key.includes('grid') || key.includes('service') || key.includes('amenit')) {
    const items = (p.items || []).slice(0, 3);
    return (
      <section className="px-8 py-12">
        {p.headline && <h3 style={{ fontFamily: fonts.heading, color: colors.primary }} className="text-xl font-bold">{p.headline}</h3>}
        {p.subheadline && <p className="mt-1 text-sm text-slate-500">{p.subheadline}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {items.map((it, i) => {
            const t = typeof it === 'string' ? it : (it.title || it.name || it.headline || `Item ${i + 1}`);
            const b = typeof it === 'string' ? '' : (it.body || it.description || '');
            return (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-medium text-slate-800">{t}</p>
                {b && <p className="mt-1 text-xs text-slate-500">{b}</p>}
              </div>
            );
          })}
          {!items.length && p.body && <p className="text-sm text-slate-600">{p.body}</p>}
        </div>
      </section>
    );
  }
  if (key.includes('testimonial') || key.includes('review')) {
    return (
      <section className="bg-slate-50 px-8 py-12">
        <blockquote className="mx-auto max-w-2xl text-center">
          {p.body && <p className="text-lg italic text-slate-700">"{p.body}"</p>}
          {p.headline && <footer className="mt-3 text-sm font-medium text-slate-500">— {p.headline}</footer>}
        </blockquote>
      </section>
    );
  }
  if (key.includes('faq')) {
    return (
      <section className="px-8 py-12">
        {p.headline && <h3 style={{ fontFamily: fonts.heading, color: colors.primary }} className="text-xl font-bold">{p.headline}</h3>}
        <div className="mt-3 space-y-2">
          {(p.faq || []).slice(0, 5).map((q, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">{q}</div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="px-8 py-10">
      {p.headline && <h3 style={{ fontFamily: fonts.heading, color: colors.primary }} className="text-xl font-bold">{p.headline}</h3>}
      {p.subheadline && <p className="mt-1 text-sm text-slate-500">{p.subheadline}</p>}
      {p.body && <p className="mt-2 text-sm text-slate-600">{p.body}</p>}
      {p.cta_text && <span className="mt-3 inline-block rounded-lg px-4 py-2 text-xs font-semibold text-white" style={{ background: colors.primary }}>{p.cta_text}</span>}
    </section>
  );
}

export default function PreviewPanel({ pages, architecture, website }) {
  const [pi, setPi] = useState(0);
  const list = pages || [];
  const page = list[Math.min(pi, list.length - 1)];
  if (!page) return <p className="text-sm text-slate-500">No pages to preview yet.</p>;
  const colors = resolveColors(architecture);
  const fonts = {
    heading: `${architecture?.typography?.heading_font}, ui-sans-serif, system-ui, sans-serif`,
    body: `${architecture?.typography?.body_font}, ui-sans-serif, system-ui, sans-serif`,
  };
  const nav = architecture?.navigation || [];
  const comps = (page.components || []).filter((c) => c.visible !== false);
  const siteSlug = (architecture?.name || 'site').toLowerCase().replace(/[^a-z0-9]/g, '');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Preview page:</span>
        {list.slice(0, 10).map((p, idx) => (
          <button key={p.id || idx} onClick={() => setPi(idx)} className={`rounded-full px-3 py-1 text-xs transition-colors ${idx === pi ? 'bg-emerald-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{p.title}</button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-300 shadow-lg">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <div className="ml-3 flex flex-1 items-center gap-1.5 rounded-md bg-white px-3 py-1 text-xs text-slate-500">
            <span className="text-emerald-600">🔒</span>
            {siteSlug}.com/{page.slug || ''}
            {website?.status === 'published' && website?.url && (
              <a href={website.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-emerald-700">Open live <ExternalLink size={12} /></a>
            )}
          </div>
        </div>

        <div style={{ background: colors.bg, fontFamily: fonts.body }} className="max-h-[70vh] overflow-y-auto">
          <header className="flex items-center justify-between border-b border-slate-100 bg-white/80 px-8 py-3">
            <span style={{ fontFamily: fonts.heading, color: colors.primary }} className="text-base font-bold">{architecture?.name || 'Site'}</span>
            <nav className="hidden gap-5 text-sm text-slate-600 sm:flex">
              {nav.slice(0, 5).map((n, i) => <span key={i}>{n.label}</span>)}
              {architecture?.primary_cta && <span className="rounded-md px-3 py-1 text-xs font-semibold text-white" style={{ background: colors.primary }}>{architecture.primary_cta}</span>}
            </nav>
          </header>

          {comps.length ? comps.map((c, i) => <ComponentPreview key={i} comp={c} colors={colors} fonts={fonts} />)
            : <div className="px-8 py-16 text-center text-sm text-slate-400">This page has no components yet.</div>}

          <footer className="px-8 py-8 text-center text-xs" style={{ color: colors.text }}>
            © {new Date().getFullYear()} {architecture?.name} · Built with Launch OS
          </footer>
        </div>
      </div>
      <p className="text-xs text-slate-400">A rendered preview of the generated content. Publish to make it live at your domain.</p>
    </div>
  );
}