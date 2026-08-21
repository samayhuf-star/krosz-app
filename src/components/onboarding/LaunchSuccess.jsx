import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { Check } from 'lucide-react';

const STEPS = [
  'Domain registered',
  'DNS configured',
  'Professional email created',
  'Website generated',
  'Mobile version generated',
  'SEO setup completed',
  'Contact form connected',
  'AI chatbot activated',
];

export default function LaunchSuccess({ businessName }) {
  const navigate = useNavigate();

  useEffect(() => {
    const end = Date.now() + 1200;
    const colors = ['#10b981', '#34d399', '#6ee7b7'];
    const frame = () => {
      confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-600 text-3xl shadow-lg shadow-emerald-200">🚀</div>
        <h1 className="text-2xl font-bold text-slate-900">
          {businessName ? `${businessName} is being launched ` : 'Your business is being launched '}🚀
        </h1>
        <p className="mt-2 text-sm text-slate-500">We've queued up your launch — everything below is set up and ready for you.</p>

        <ul className="mx-auto mt-7 max-w-sm space-y-2.5 text-left">
          {STEPS.map((s) => (
            <li key={s} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check size={13} strokeWidth={3} />
              </span>
              <span className="text-sm font-medium text-slate-700">{s}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => navigate('/')}
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-emerald-700"
        >
          Go to my dashboard →
        </button>
      </div>
    </div>
  );
}