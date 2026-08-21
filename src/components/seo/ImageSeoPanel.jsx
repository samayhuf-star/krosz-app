import { ImageIcon, FileImage } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function ImageSeoPanel({ images }) {
  const list = images || [];
  if (!list.length) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No image SEO recommendations generated.</div>;

  const byPage = {};
  list.forEach((i) => { (byPage[i.page_slug] ||= []).push(i); });
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700"><ImageIcon size={16} className="text-emerald-700" />Image SEO · {list.length} across {Object.keys(byPage).length} pages</h3>
      <div className="space-y-4">
        {Object.entries(byPage).map(([slug, imgs]) => (
          <div key={slug} className="rounded-xl border border-slate-200 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><FileImage size={14} className="text-emerald-600" />/{slug}</p>
            <div className="space-y-2">
              {imgs.map((i, idx) => (
                <div key={i.id || idx} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800">{i.original_ref || 'image'}</p>
                    <Badge variant="outline" className="border-slate-300 text-slate-600">{i.compression || 'webp'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600"><span className="text-slate-400">alt:</span> {i.alt_text}</p>
                  <p className="text-xs text-slate-600"><span className="text-slate-400">file:</span> {i.filename}</p>
                  {i.title && <p className="text-xs text-slate-600"><span className="text-slate-400">title:</span> {i.title}</p>}
                  {i.caption && <p className="text-xs text-slate-600"><span className="text-slate-400">caption:</span> {i.caption}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}