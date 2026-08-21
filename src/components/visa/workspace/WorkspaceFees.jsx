import { Landmark, Wallet, Sparkles, ShieldCheck } from 'lucide-react';
import { formatMoney } from '@/lib/moneyFmt';

function fmt(minor, currency) {
  return minor == null ? '—' : formatMoney(minor, currency || 'INR');
}

export default function WorkspaceFees({ quote }) {
  if (!quote) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-900">Fees</p>
        <p className="mt-1 text-sm text-slate-500">Pricing for this route is being finalized. You won't be charged to prepare your application.</p>
      </div>
    );
  }
  const components = quote.components || [];
  const gov = components.filter((c) => c.government_fee_basis).reduce((n, c) => n + (c.amount_minor || 0), 0);
  const service = components.filter((c) => !c.government_fee_basis && c.type !== 'TAX' && c.type !== 'DISCOUNT').reduce((n, c) => n + (c.amount_minor || 0), 0);
  const optional = components.filter((c) => c.type === 'DISCOUNT').reduce((n, c) => n + (c.amount_minor || 0), 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-semibold text-slate-900">Fees</p>
      <div className="mt-3 space-y-2">
        <Row icon={Landmark} label="Government fee" value={fmt(gov, quote.currency)} />
        <Row icon={Wallet} label="Service fee" value={fmt(service, quote.currency)} />
        {optional > 0 && <Row icon={Sparkles} label="Optional services" value={`− ${fmt(optional, quote.currency)}`} />}
        <div className="my-2 border-t border-slate-100" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-900">Total</span>
          <span className="text-base font-semibold text-slate-900">{fmt(quote.total_minor, quote.currency)}</span>
        </div>
      </div>
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700">
        <ShieldCheck size={13} /> Payment opens in the next workflow stage — no charges yet.
      </p>
    </div>
  );
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="inline-flex items-center gap-2 text-slate-500"><Icon size={14} /> {label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}