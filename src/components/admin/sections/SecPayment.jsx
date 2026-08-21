export default function SecPayment({ d }) {
  const p = d.payment || {};
  const fee = d.case_view?.snapshot?.fee || {};
  const gov = Number(fee.government_minor) || 0;
  const prov = Number(fee.provider_minor) || 0;
  const svc = Number(fee.service_minor || fee.our_minor) || 0;
  const total = (p.total_minor != null ? Number(p.total_minor) : (gov + prov + svc));
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Fee breakdown (snapshot)</h3>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <KV label="Government" value={gov ? `${gov}` : '—'} />
          <KV label="Provider" value={prov ? `${prov}` : '—'} />
          <KV label="Krosz fee" value={svc ? `${svc}` : '—'} />
          <KV label="Total (minor)" value={total || '—'} />
          <KV label="Currency" value={fee.currency || p.currency || '—'} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Amounts are integer minor units. Payment success does NOT equal submission.</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Payment status</h3>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <KV label="Order" value={p.order_id ? String(p.order_id).slice(-8) : '—'} />
          <KV label="Status" value={p.status || '—'} />
          <KV label="Paid at" value={p.paid_at ? new Date(p.paid_at).toLocaleString() : '—'} />
          <KV label="Submitted?" value={d.case_view?.state === 'SUBMITTED' ? 'Yes' : 'No'} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Card numbers, bank credentials and payment secrets are never displayed.</p>
      </div>
    </div>
  );
}
function KV({ label, value }) { return <div><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p><p className="text-sm font-medium text-slate-800">{String(value ?? '—')}</p></div>; }