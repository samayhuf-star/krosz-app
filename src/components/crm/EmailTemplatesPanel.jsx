import { useState } from 'react';
import { Mail, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const TYPE_TONE = {
  welcome: 'bg-emerald-100 text-emerald-700',
  quotation: 'bg-blue-100 text-blue-700',
  reminder: 'bg-amber-100 text-amber-700',
  follow_up: 'bg-violet-100 text-violet-700',
  thank_you: 'bg-pink-100 text-pink-700',
  re_engagement: 'bg-orange-100 text-orange-700',
  appointment_confirmation: 'bg-cyan-100 text-cyan-700',
};

export default function EmailTemplatesPanel({ templates }) {
  const list = templates || [];
  const [openId, setOpenId] = useState(null);

  if (!list.length) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No email templates generated for this CRM version.</div>;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700"><Mail size={16} className="text-emerald-700" />Email Templates · {list.length}</h3>
      <div className="space-y-2">
        {list.map((t) => {
          const open = openId === t.id;
          return (
            <div key={t.id} className="rounded-xl border border-slate-200">
              <button onClick={() => setOpenId(open ? null : t.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                <div className="flex min-w-0 items-center gap-3">
                  {open ? <ChevronDown size={16} className="shrink-0 text-slate-400" /> : <ChevronRight size={16} className="shrink-0 text-slate-400" />}
                  <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{t.name}</p><p className="truncate text-xs text-slate-500">{t.subject}</p></div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={`border-transparent ${TYPE_TONE[t.type] || 'bg-slate-100 text-slate-700'}`}>{t.type.replace('_', ' ')}</Badge>
                  <Badge variant="outline" className="border-slate-300 capitalize text-slate-600">{t.channel}</Badge>
                </div>
              </button>
              {open && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{t.body}</pre>
                  <p className="mt-3 text-xs text-slate-500">Trigger: <span className="font-medium text-slate-700">{t.trigger || '—'}</span> · Owner: <span className="font-medium text-slate-700">{t.owner_role || '—'}</span></p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}