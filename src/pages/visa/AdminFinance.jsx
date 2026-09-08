import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { adminListOrders, adminListPayments, adminListRefunds } from '@/lib/visaApi';
import { formatMoney } from '@/lib/moneyFmt';
import PageHeader from '@/components/app/PageHeader';
import { Info } from 'lucide-react';

const RECON_BADGE = {
  UNRECONCILED: 'bg-amber-100 text-amber-700',
  MATCHED: 'bg-orange-100 text-orange-700',
  PARTIAL_MATCH: 'bg-amber-100 text-amber-700',
  MISMATCH: 'bg-rose-100 text-rose-700',
  REFUND_PENDING: 'bg-amber-100 text-amber-700',
  REFUND_MATCHED: 'bg-orange-100 text-orange-700',
  DISPUTED: 'bg-rose-100 text-rose-700',
  CLOSED: 'bg-slate-100 text-slate-600',
};

export default function AdminFinance() {
  const { user } = useAuth();
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [recon, setRecon] = useState([]);
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') return;
    adminListOrders({}).then((r) => setOrders(r.orders || [])).catch((e) => setErr(e?.message));
    adminListPayments({}).then((r) => setPayments(r.payments || [])).catch((e) => setErr(e?.message));
    adminListRefunds().then((r) => setRefunds(r.refunds || [])).catch((e) => setErr(e?.message));
    // Phase 38: authoritative reconciliation records (admin-only via RLS).
    base44.entities.ApplicationFinancialRecord.list('-created_date', 100)
      .then((r) => setRecon(Array.isArray(r) ? r : []))
      .catch((e) => setErr(e?.message || String(e)));
  }, [user]);

  if (user?.role !== 'admin') return <div className="px-4 md:px-8 py-12 text-sm text-slate-500">Admin access required.</div>;

  const TABS = [['orders', 'Orders'], ['payments', 'Payments'], ['refunds', 'Refunds'], ['reconciliation', 'Reconciliation']];
  const q = filter.trim().toLowerCase();
  const matches = (s) => !q || String(s || '').toLowerCase().includes(q);
  const fOrders = orders.filter((o) => matches(o.order_number) || matches(o.application_id) || matches(o.status));
  const fPayments = payments.filter((p) => matches(p.id) || matches(p.provider_key) || matches(p.status) || matches(p.provider_payment_id));
  const fRefunds = refunds.filter((r) => matches(r.id) || matches(r.status) || matches(r.reason) || matches(r.order_id));
  const fRecon = recon.filter((r) => matches(r.case_id) || matches(r.order_number) || matches(r.provider_key) || matches(r.reconciliation_status) || matches(r.refund_status));

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Finance & Operations"
        description="Orders, payments, refunds and provider reconciliation. All figures come from authoritative backend state — nothing is fabricated."
      />
      <div className="px-5 py-6 sm:px-8 lg:px-10">

      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <Info size={14} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Payment provider: PayU (production, INR) — mock/manual retained for sandbox.</p>
          <p className="mt-0.5">When <code>PAYU_MERCHANT_KEY</code> + <code>PAYU_SALT</code> are set in Base44 Secrets, checkouts route to PayU's hosted payment page and the verified server-side <code>payuWebhook</code> reconciles each Payment→SUCCEEDED / Order→PAID (issuing INV-/RCT- exactly as the mock provider does). Without those secrets the resolver falls back to the sandbox mock/manual providers (no real charge). The Order/Payment/PaymentAttempt/Invoice/Receipt/Refund data model and state machine are unchanged for any provider.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 border-b border-slate-200">
          {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-medium ${tab === k ? 'border-b-2 border-orange-600 text-orange-700' : 'text-slate-500 hover:text-slate-900'}`}>{l}</button>)}
        </div>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter (id / status / provider)…" className="w-full sm:w-72 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-orange-500 focus:outline-none" />
      </div>

      {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {tab === 'orders' && <OrdersTable rows={fOrders} />}
        {tab === 'payments' && <PaymentsTable rows={fPayments} />}
        {tab === 'refunds' && <RefundsTable rows={fRefunds} />}
        {tab === 'reconciliation' && <ReconciliationTable rows={fRecon} />}
      </div>
      <p className="mt-3 text-[11px] text-amber-700">Financial events (PRICE_CREATED … REFUND_SUCCEEDED) and reconciliation state are persisted immutably in the audit trail.</p>
      </div>
    </div>
  );
}

function Th({ children }) { return <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-4 py-3 text-sm text-slate-700 ${className}`}>{children}</td>; }

function OrdersTable({ rows }) {
  return (
    <table className="w-full">
      <thead className="bg-slate-50"><tr><Th>Order ID</Th><Th>Application</Th><Th>Customer</Th><Th>Amount</Th><Th>Status</Th><Th>Created</Th><Th>Paid</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.length === 0 && <tr><td className="px-4 py-6 text-sm text-slate-400" colSpan={7}>No orders.</td></tr>}
        {rows.map((o) => (
          <tr key={o.id}>
            <Td className="font-medium text-slate-900">#{o.order_number}</Td>
            <Td><Link to={`/applications/${o.application_id}`} className="text-orange-700 hover:underline">APP-{String(o.application_id || '').slice(-6).toUpperCase()}</Link></Td>
            <Td>{o.traveler_id ? `Traveler ${o.traveler_id.slice(-6).toUpperCase()}` : '—'}</Td>
            <Td>{formatMoney(o.total_minor, o.currency)}</Td>
            <Td><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{o.status}</span></Td>
            <Td>{o.created_date ? new Date(o.created_date).toLocaleDateString() : '—'}</Td>
            <Td>{o.paid_at ? new Date(o.paid_at).toLocaleDateString() : '—'}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaymentsTable({ rows }) {
  return (
    <table className="w-full">
      <thead className="bg-slate-50"><tr><Th>Payment ID</Th><Th>Provider</Th><Th>Amount</Th><Th>Status</Th><Th>Provider reference</Th><Th>Order</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.length === 0 && <tr><td className="px-4 py-6 text-sm text-slate-400" colSpan={6}>No payments.</td></tr>}
        {rows.map((p) => (
          <tr key={p.id}>
            <Td className="font-mono text-xs">{p.id.slice(-8)}</Td>
            <Td>{p.provider_key || '—'}</Td>
            <Td>{formatMoney(p.amount_minor, p.currency)}</Td>
            <Td><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{p.status}</span></Td>
            <Td className="font-mono text-xs">{p.provider_payment_id || '—'}</Td>
            <Td><Link to={`/orders/${p.order_id}/confirmation`} className="text-orange-700 hover:underline">#{p.order_id.slice(-6).toUpperCase()}</Link></Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RefundsTable({ rows }) {
  return (
    <table className="w-full">
      <thead className="bg-slate-50"><tr><Th>Refund ID</Th><Th>Amount</Th><Th>Type</Th><Th>Reason</Th><Th>Status</Th><Th>Order</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.length === 0 && <tr><td className="px-4 py-6 text-sm text-slate-400" colSpan={6}>No refunds.</td></tr>}
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="font-mono text-xs">{r.id.slice(-8)}</Td>
            <Td>{formatMoney(r.amount_minor, r.currency)}</Td>
            <Td>{r.type}</Td>
            <Td>{r.reason}</Td>
            <Td><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{r.status}</span></Td>
            <Td><Link to={`/orders/${r.order_id}/confirmation`} className="text-orange-700 hover:underline">#{r.order_id.slice(-6).toUpperCase()}</Link></Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReconciliationTable({ rows }) {
  return (
    <table className="w-full">
      <thead className="bg-slate-50"><tr><Th>Case</Th><Th>Order</Th><Th>Provider</Th><Th>Gov fee</Th><Th>Provider fee</Th><Th>Platform fee</Th><Th>Total</Th><Th>Paid</Th><Th>Refunded</Th><Th>Reconciliation</Th><Th>Refund</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.length === 0 && <tr><td className="px-4 py-6 text-sm text-slate-400" colSpan={11}>No reconciliation records.</td></tr>}
        {rows.map((r) => {
          const recon = r.reconciliation_status || 'UNRECONCILED';
          const refund = r.refund_status || 'NO_REFUND';
          return (
            <tr key={r.id}>
              <Td><Link to={`/cases/${r.case_id}`} className="text-orange-700 hover:underline">CASE-{String(r.case_id || '').slice(-6).toUpperCase()}</Link></Td>
              <Td>#{r.order_number || '—'}</Td>
              <Td>{r.provider_key || '—'}</Td>
              <Td>{formatMoney(r.government_fee_minor ?? 0, r.currency)}</Td>
              <Td>{formatMoney(r.provider_fee_minor ?? 0, r.currency)}</Td>
              <Td>{formatMoney(r.platform_fee_minor ?? 0, r.currency)}</Td>
              <Td className="font-medium text-slate-900">{formatMoney(r.traveler_total_minor ?? 0, r.currency)}</Td>
              <Td>{formatMoney(r.amount_paid_minor ?? 0, r.currency)}</Td>
              <Td>{formatMoney(r.amount_refunded_minor ?? 0, r.currency)}</Td>
              <Td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RECON_BADGE[recon] || 'bg-slate-100 text-slate-600'}`}>{recon}</span></Td>
              <Td><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{refund}</span></Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}