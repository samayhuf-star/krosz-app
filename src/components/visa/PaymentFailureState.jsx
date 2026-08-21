// Worldz Visa (Phase 18) — Payment failure UI (§19). Shown when checkout/reconcile fails.
import { AlertTriangle, RotateCw, ArrowLeft } from 'lucide-react';

export default function PaymentFailureState({ error, onRetry, onReturn }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 text-rose-600" size={20} />
        <div>
          <h3 className="text-base font-semibold text-rose-900">Payment unsuccessful</h3>
          <p className="mt-1 text-sm text-rose-700">Your application is safe. No application information has been lost.</p>
          {error && <p className="mt-2 text-xs text-rose-600">Reason: {error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"><RotateCw size={14} /> Try again</button>
            <button onClick={onReturn} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"><ArrowLeft size={14} /> Return to application</button>
          </div>
        </div>
      </div>
    </div>
  );
}