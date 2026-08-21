import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, Archive } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { listNotifications, markNotificationRead, archiveNotification } from '@/lib/visaApi';

const PRIORITY_TONE = {
  CRITICAL: 'border-red-200 bg-red-50',
  ACTION_REQUIRED: 'border-amber-200 bg-amber-50',
  IMPORTANT: 'border-blue-100 bg-blue-50',
  INFO: 'border-slate-200 bg-white',
};
const PRIORITY_DOT = {
  CRITICAL: 'bg-red-500',
  ACTION_REQUIRED: 'bg-amber-500',
  IMPORTANT: 'bg-blue-500',
  INFO: 'bg-slate-300',
};

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
}

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('UNREAD');
  const [loading, setLoading] = useState(true);

  const load = () => listNotifications(filter === 'ALL' ? {} : { status: 'UNREAD' })
    .then((r) => setItems(r.notifications || []))
    .catch(() => {})
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, [filter]);

  const mark = async (id) => { await markNotificationRead(id); load(); };
  const archive = async (id) => { await archiveNotification(id); load(); };

  return (
    <div className="px-4 md:px-8">
      <PageHeader title="Notifications" subtitle="Updates and actions across your applications." />
      <div className="mb-4 flex gap-2">
        {[['UNREAD', 'Unread'], ['ALL', 'All']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-4 py-1.5 text-xs font-semibold ${filter === k ? 'bg-orange-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{label}</button>
        ))}
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-700"><Bell size={22} /></span>
          <p className="mt-4 text-sm font-medium text-slate-900">You're all caught up</p>
          <p className="mt-1 text-sm text-slate-500">No notifications to review right now.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <div key={n.id} className={`flex items-start justify-between gap-3 rounded-xl border p-4 ${PRIORITY_TONE[n.priority] || PRIORITY_TONE.INFO}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[n.priority] || PRIORITY_DOT.INFO}`} />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                  <p className="text-sm text-slate-600">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-400">{fmtDate(n.occurred_at)} · <span className="capitalize">{(n.category || '').replace(/_/g, ' ')}</span></p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {n.deep_link && <Link to={n.deep_link} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open</Link>}
                {n.status === 'UNREAD' && <button onClick={() => mark(n.id)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50" aria-label="Mark read"><Check size={14} /></button>}
                <button onClick={() => archive(n.id)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50" aria-label="Archive"><Archive size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}