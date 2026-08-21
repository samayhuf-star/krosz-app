import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileText } from 'lucide-react';
import { getOrderApi } from '@/lib/visaApi';
import { formatMoney } from '@/lib/moneyFmt';

export default function OrderConfirmation() {
  const { order_id } = useParams();
  const [bundle, setBundle] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrderApi(order_id)
      .then((r) => setBundle(r))
      .catch((e) => setErr(e?.message || 'Order not found'))
      .finally(() => setLoading(false));
  }, [order_id]);

  if (loading) return <div className="px-4 md:px-8 py-12 text-sm text-slate-500">Loading order…</div>;
  if (err) return <div className="px-4 md:px-8 py-8"><p className="text-sm text-rose-600">{err}</p><Link to="/applications" className="mt-2 inline-flex items-center gap-1 text-sm text-orange-700"><ArrowLeft size={14} /> Back</Link></div>;

  const { order, items, payments, invoices, receipts } = bundle;
  const succeeded = (payments || []).find((p) => p.status === 'SUCCEEDED');
  const paidAt = order.paid_at || succeeded?.paid_at || (invoices || [])[0]?.paid_at;
  const app = { id: order.application_id };

  return (
    <div className="px-4 md:px-8 pb-20">
      <Link to={`/applications/${order.application_id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Return to application</Link>

      {/* Success banner (§20) */}
      <div className="mt-3 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-5">
        <CheckCircle2 className="mt-0.5 text-orange-600" size={22} />
        <div>
          <h1 className="text-xl font-semibold text-orange-900">Payment successful</h1>
          <p className="text-sm text-orange-700">Order #{order.order_number} · Payment received. Your application is queued for Krosz final review.</p>
          <p className="mt-1 text-[11px] text-orange-600">Application status: PAID · AWAITING VISA APPROVER MANAGER REVIEW</p>
        </div>
      </div>

      {/* Order confirmation (§21) */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <h2 className="text-base font-semibold text-slate-900">Order confirmation</h2>
          <dl className="mt-3 divide-y divide-slate-100 text-sm">
            <Row label="Order number" value={`#${order.order_number}`} />
            <Row label="Application number" value={order.application_id ? `APP-${order.application_id.slice(-6).toUpperCase()}` : '—'} />
            <Row label="Product" value={order.product_code || '—'} />
            <Row label="Destination" value={order.product_code || '—'} />
            <Row label="Applicant" value={order.traveler_id ? `Traveler ${order.traveler_id.slice(-6).toUpperCase()}` : '—'} />
            <Row label="Amount paid" value={formatMoney(order.total_minor, order.currency)} />
            <Row label="Payment date" value={paidAt ? new Date(paidAt).toLocaleString() : '—'} />
            <Row label="Payment status" value={order.status} />
          </dl>
        </div>

        {/* Receipt (§22) */}
        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Receipt</h2>
            <FileText size={16} className="text-slate-400" />
          </div>
          <dl className="mt-3 divide-y divide-slate-100 text-sm">
            <Row label="Order ID" value={order.order_number} />
            <Row label="Application ID" value={order.application_id || '—'} />
            <Row label="Customer" value={order.traveler_id ? `Traveler ${order.traveler_id.slice(-6).toUpperCase()}` : '—'} />
          </dl>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Items</p>
          <div className="mt-1 divide-y divide-slate-100">
            {(items || []).map((it) => (
              <div key={it.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-700">{it.description}</span>
                <span className="font-medium text-slate-900">{formatMoney(it.total_minor, order.currency)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1 border-t border-slate-200 pt-3 text-sm">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatMoney(order.subtotal_minor, order.currency)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Tax</span><span>{formatMoney(order.tax_minor, order.currency)}</span></div>
            {order.discount_minor > 0 && <div className="flex justify-between text-slate-500"><span>Discount</span><span>-{formatMoney(order.discount_minor, order.currency)}</span></div>}
            <div className="flex justify-between font-semibold text-slate-900"><span>Total ({order.currency})</span><span>{formatMoney(order.total_minor, order.currency)}</span></div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>Payment status: {order.status}</span><span>{paidAt ? new Date(paidAt).toLocaleString() : ''}</span></div>
          {(receipts || []).length > 0 && <p className="mt-3 text-[11px] text-slate-400">Receipt #{receipts[0].receipt_number}</p>}
        </div>
      </div>
      <p className="mt-4 text-[11px] text-amber-700">Payment does not mean your application has been submitted or approved. Krosz submits only after the Visa Approver Manager clears the case.</p>
    </div>
  );
}

function Row({ label, value }) { return <div className="flex items-center justify-between py-2"><dt className="text-slate-500">{label}</dt><dd className="font-medium text-slate-900">{value}</dd></div>; }