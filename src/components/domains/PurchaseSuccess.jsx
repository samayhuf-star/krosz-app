import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

const STEPS = ['Website', 'SEO', 'Blog', 'CRM', 'Email'];

export default function PurchaseSuccess({ domainCode, registrationStarted, providerName }) {
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState(-1);
  const navigate = useNavigate();

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const t = setInterval(() => { i += 1; setActive(i); if (i >= STEPS.length) clearInterval(t); }, 700);
    return () => clearInterval(t);
  }, [started]);

  return (
    <div className="rounded-3xl border border-emerald-200 bg-emerald-50/50 p-6 text-center">
      <CheckCircle2 size={40} className="mx-auto text-emerald-600" />
      <h3 className="mt-3 text-xl font-semibold text-slate-900">Domain secured{registrationStarted ? ' — registration started' : ''}</h3>
      <p className="mt-1 font-mono text-emerald-800">{domainCode}</p>
      {registrationStarted && <p className="mt-1 text-sm text-slate-500">Selected in your account. Complete live registration by configuring {providerName || 'your domain registrar'} credentials in Integrations.</p>}

      {!started ? (
        <div className="mt-6 rounded-2xl border border-white bg-white/70 p-5">
          <p className="text-sm font-medium text-slate-700">Would you like AI to build your website?</p>
          <p className="mt-1 text-xs text-slate-500">One click turns this domain into a full launch.</p>
          <Button className="mt-4 bg-emerald-800 hover:bg-emerald-900" onClick={() => setStarted(true)} size="lg">Yes — generate my website <ArrowRight size={16} /></Button>
        </div>
      ) : (
        <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2 text-sm">
              {i < active ? <CheckCircle2 size={16} className="text-emerald-600" /> : i === active ? <Loader2 size={16} className="animate-spin text-emerald-600" /> : <span className="h-4 w-4 rounded-full border border-slate-300" />}
              <span className={i <= active ? 'text-slate-700' : 'text-slate-400'}>Generating {s}…</span>
            </li>
          ))}
        </ul>
      )}
      {started && active >= STEPS.length && (
        <Button variant="outline" className="mt-5" onClick={() => navigate('/')}>Back to dashboard</Button>
      )}
    </div>
  );
}