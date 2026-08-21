import { Badge } from '@/components/ui/badge';
import { Palette, Type, Ruler, LayoutGrid, ShieldCheck, MousePointerClick, Component, Navigation } from 'lucide-react';

function Section({ icon: Icon, title, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon size={16} className="text-emerald-600" /> {title}</div>
      <div className="mt-3 text-sm text-slate-700">{children}</div>
    </div>
  );
}

export default function ArchitecturePanel({ architecture }) {
  if (!architecture) return <p className="text-sm text-slate-500">No architecture generated.</p>;
  const a = architecture;
  return (
    <div className="space-y-4">
      <Section icon={Component} title="Site identity">
        <h3 className="text-lg font-semibold text-slate-900">{a.name}</h3>
        <p className="mt-1 text-slate-600">{a.brand_theme?.tone} · {a.brand_theme?.personality} · {a.brand_theme?.voice}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="outline">Primary CTA: {a.primary_cta}</Badge>
          <Badge variant="outline">Secondary: {a.secondary_cta}</Badge>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={Palette} title="Color palette">
          <div className="flex flex-wrap gap-2">
            {(a.color_palette || []).map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                <span className="h-7 w-7 rounded-md border border-slate-200" style={{ background: c.hex }} />
                <div className="text-xs"><p className="font-medium text-slate-800">{c.name}</p><p className="text-slate-500">{c.hex} · {c.role}</p></div>
              </div>
            ))}
          </div>
        </Section>
        <Section icon={Type} title="Typography">
          <p>Headings: <span className="font-medium">{a.typography?.heading_font}</span></p>
          <p>Body: <span className="font-medium">{a.typography?.body_font}</span></p>
          <p className="text-slate-500">Scale: {a.typography?.scale}</p>
        </Section>
        <Section icon={Ruler} title="Layout system">
          <p>Spacing: {a.spacing}</p><p>Grid: {a.grid_system}</p><p>Icons: {a.icon_style}</p><p>Images: {a.image_style}</p><p>Animation: {a.animation_style}</p>
        </Section>
        <Section icon={Navigation} title="Navigation">
          <ul className="space-y-1">
            {(a.navigation || []).map((n, i) => (<li key={i} className="text-slate-700">{n.label} <span className="text-slate-400">→ {n.url}</span></li>))}
          </ul>
        </Section>
      </div>

      <Section icon={LayoutGrid} title="Component library">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(a.component_library || []).map((c, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-2">
              <p className="font-mono text-xs text-emerald-700">{c.key}</p>
              <p className="text-sm font-medium text-slate-800">{c.name}</p>
              <p className="text-xs text-slate-500">{c.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={MousePointerClick} title="Responsive rules">
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">{(a.responsive_rules || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Section>
        <Section icon={ShieldCheck} title="Accessibility rules">
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">{(a.accessibility_rules || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Section>
      </div>
    </div>
  );
}