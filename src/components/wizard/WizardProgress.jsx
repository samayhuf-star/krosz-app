import { Check } from 'lucide-react';

// Accessible wizard progress indicator. Steps beyond the resolved journey are
// omitted by the backend `application-case-context` projection; this only renders
// the steps applicable to THIS case.
export default function WizardProgress({ steps, currentIndex, blockedStepId }) {
  return (
    <nav aria-label="Application progress" className="mb-2">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {steps.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const blocked = blockedStepId === s.id;
          return (
            <li key={s.id} className="flex items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  active ? 'bg-orange-600 text-white' : done ? 'bg-orange-100 text-orange-700' : blocked ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? <Check size={14} /> : i + 1}
              </span>
              <span className={`text-xs font-medium ${active ? 'text-slate-900' : blocked ? 'text-rose-700' : 'text-slate-500'}`}>{s.label}</span>
              {i < steps.length - 1 && <span className="hidden h-px w-6 bg-slate-200 sm:inline-block" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}