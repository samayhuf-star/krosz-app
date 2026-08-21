import { Badge } from '@/components/ui/badge';
import { Image } from 'lucide-react';

const TYPE_TONE = { hero: 'bg-emerald-100 text-emerald-800', icon: 'bg-sky-100 text-sky-800', illustration: 'bg-violet-100 text-violet-800', gallery: 'bg-amber-100 text-amber-800', logo: 'bg-slate-200 text-slate-700', background: 'bg-rose-100 text-rose-800' };

export default function MediaPanel({ items }) {
  if (!items?.length) return <p className="text-sm text-slate-500">No media plan.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((m, i) => (
        <div key={i} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={TYPE_TONE[m.media_type] || 'bg-slate-100'}>{m.media_type}</Badge>
            <span className="text-xs text-slate-500">{m.aspect_ratio}</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <Image size={12} />
            <span className="font-mono">{m.page_slug || 'site'} {m.section ? `· ${m.section}` : ''}</span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-900">{m.purpose}</p>
          <p className="mt-1 text-sm text-slate-600">{m.image_prompt}</p>
          {m.alt_text && <p className="mt-2 text-xs text-slate-400">alt: {m.alt_text}</p>}
        </div>
      ))}
    </div>
  );
}