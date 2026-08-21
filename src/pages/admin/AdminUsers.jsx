import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, Search, Users } from 'lucide-react';

export default function AdminUsers() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const load = async () => {
    setLoading(true); setErr('');
    try { const r = await base44.entities.User.list('-created_date', 500); setRows(Array.isArray(r) ? r : []); }
    catch (e) { setErr(e?.message || 'Unable to load users.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(u => [u.name,u.full_name,u.email,u.role,u.platform_role,u.id].some(v => String(v||'').toLowerCase().includes(s)));
  }, [rows,q]);
  return <div className="px-5 py-6 sm:px-8 lg:px-10">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-orange-600">Customers</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Users & Customers</h1><p className="mt-2 text-sm text-slate-600">Registered accounts, roles and account identity in one searchable view.</p></div><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"><RefreshCw size={15} className={loading?'animate-spin':''}/>Refresh</button></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-3"><Card label="Total users" value={rows.length}/><Card label="Admins" value={rows.filter(u=>u.role==='admin').length}/><Card label="Customers" value={rows.filter(u=>u.role!=='admin').length}/></div>
    <div className="mt-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"><Search size={16} className="text-slate-400"/><input className="w-full bg-transparent text-sm outline-none" placeholder="Search name, email, role or user ID…" value={q} onChange={e=>setQ(e.target.value)}/></div>
    {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Platform role</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">ID</th></tr></thead><tbody className="divide-y divide-slate-100">{loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Loading users…</td></tr>}{!loading && filtered.length===0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No users found.</td></tr>}{filtered.map(u=><tr key={u.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-semibold text-slate-900">{u.full_name||u.name||'Unnamed user'}</td><td className="px-4 py-3 text-slate-600">{u.email||'—'}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{u.role||'user'}</span></td><td className="px-4 py-3 text-slate-600">{u.platform_role||'—'}</td><td className="px-4 py-3 text-slate-500">{u.created_date?new Date(u.created_date).toLocaleDateString():'—'}</td><td className="px-4 py-3 font-mono text-xs text-slate-400">{String(u.id).slice(-10)}</td></tr>)}</tbody></table></div>
  </div>;
}
function Card({label,value}) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-slate-500"><Users size={15}/><span className="text-xs font-semibold">{label}</span></div><p className="mt-2 text-2xl font-bold text-slate-950">{value}</p></div>; }