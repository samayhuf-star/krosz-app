import { CheckCircle2, ArrowDownRight } from 'lucide-react';

// Compact requirements preview (§14). Items come from the existing visa
// requirement system (resolveRequirements) via the destination page payload.
export default function RequirementsPreview({ preview, onShowAll }) {
  if (!preview?.items?.length) return <p className="text-sm text-slate-400">Requirements are being verified. Check back shortly.</p>;
  return (
    <div>
      <h3 className="mb-3 text-base font-semibold text-slate-900">What you'll need</h3>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {preview.items.map((it, index) => (
          <li key={`${it.code || 'requirement'}-${index}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-600" aria-hidden /> {it.label}{it.mandatory ? '' : ' (if applicable)'}
          </li>
        ))}
      </ul>
      {preview.has_more && onShowAll && (
        <button onClick={onShowAll} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline">
          View all requirements <ArrowDownRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}