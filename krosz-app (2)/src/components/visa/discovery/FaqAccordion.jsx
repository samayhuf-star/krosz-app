import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// FAQ accordion (§9). Powers the FAQPage JSON-LD on destination pages.
export default function FaqAccordion({ faq = [] }) {
  const [open, setOpen] = useState(0);
  if (!faq.length) return null;
  return (
    <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {faq.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={i}>
            <button
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <span className="text-sm font-semibold text-slate-900">{f.question}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {isOpen && <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{f.answer}</p>}
          </div>
        );
      })}
    </div>
  );
}