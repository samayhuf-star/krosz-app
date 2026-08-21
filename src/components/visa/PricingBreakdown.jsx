// Worldz Visa (Phase 18) — Pricing breakdown (§7/§10). Government and service
// fees are explicitly separated; the UI never implies a service fee is a gov fee.
import { formatMoney } from '@/lib/moneyFmt';

export default function PricingBreakdown({ quote, selectedOptional = [] }) {
  if (!quote) return <p className="text-sm text-slate-400">Pricing unavailable for this route.</p>;
  const components = quote.price?.components || [];
  const gov = components.filter((c) => c.type === 'GOVERNMENT_FEE');
  const service = components.filter((c) => c.type === 'SERVICE_FEE' || c.type === 'PROCESSING_FEE' || c.type === 'DOCUMENT_SERVICE_FEE');
  const other = components.filter((c) => ![...gov, ...service].includes(c) && c.type !== 'TAX' && c.type !== 'DISCOUNT');
  const tax = components.filter((c) => c.type === 'TAX');
  const discount = components.filter((c) => c.type === 'DISCOUNT');
  const optional = (quote.optional_services || []).filter((o) => selectedOptional.includes(o.code));
  const currency = quote.currency;
  const row = (label, amount, opts = {}) => (
    <div className={`flex items-start justify-between gap-4 py-1.5 text-sm ${opts.muted ? 'text-slate-500' : 'text-slate-800'}`}>
      <span>{label}{opts.estimate ? <span className="ml-1 text-[11px] text-amber-600">(estimated)</span> : ''}{typeof opts.refundable === 'boolean' ? <span className={`ml-2 text-[10px] font-medium ${opts.refundable ? 'text-emerald-700' : 'text-slate-400'}`}>{opts.refundable ? 'Refundable if not yet incurred' : 'Non-refundable once incurred'}</span> : ''}</span>
      <span className="shrink-0 font-medium">{amount < 0 ? '-' : ''}{formatMoney(Math.abs(amount), currency)}</span>
    </div>
  );
  return (
    <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
      <h3 className="mb-2 text-base font-semibold text-slate-900">Price</h3>
      {gov.length > 0 && <div className="border-b border-slate-100 pb-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Government / Embassy fee</p>{gov.map((c) => row(c.label, c.amount_minor, { estimate: c.government_fee_basis === 'estimated', refundable: !!c.refundable }))}</div>}
      {service.length > 0 && <div className="border-b border-slate-100 py-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Krosz service fee</p>{service.map((c) => row(c.label, c.amount_minor, { refundable: !!c.refundable }))}</div>}
      {other.length > 0 && <div className="border-b border-slate-100 py-2">{other.map((c) => row(c.label, c.amount_minor, { refundable: typeof c.refundable === 'boolean' ? c.refundable : undefined }))}</div>}
      {optional.length > 0 && <div className="border-b border-slate-100 py-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Optional services</p>{optional.map((c) => row(c.label, c.amount_minor, { refundable: !!c.refundable }))}</div>}
      {tax.map((c) => row(c.label, c.amount_minor))}
      {discount.map((c) => row(c.label, -Math.abs(c.amount_minor), { muted: true }))}
      <div className="mt-2 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">Government and Krosz fees are shown separately. Refundability depends on whether a fee has already been incurred. If Krosz's Visa Approver Manager determines after payment that we cannot proceed before government submission, the eligible refund is escalated for CEO approval and processed within 24 hours after approval.</div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold text-slate-900">Total</span>
        <span className="text-lg font-semibold text-slate-950">{formatMoney(quote.total_minor, currency)}</span>
      </div>
    </div>
  );
}