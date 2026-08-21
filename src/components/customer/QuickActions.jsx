import { useNavigate } from 'react-router-dom';
import { Rocket, Sparkles, Mail, UserPlus, Megaphone, Users } from 'lucide-react';
import { trackAction } from '@/lib/productLearning';

const ACTIONS = [
  { key: 'launch_business', label: 'Launch Business', icon: Rocket, to: '/onboarding' },
  { key: 'ask_ai', label: 'Ask AI', icon: Sparkles, to: '/assistant' },
  { key: 'compose_email', label: 'Compose Email', icon: Mail, to: '/communications' },
  { key: 'add_lead', label: 'Add Lead', icon: UserPlus, to: '/customers' },
  { key: 'create_campaign', label: 'Create Campaign', icon: Megaphone, to: '/insights' },
  { key: 'view_customers', label: 'View Customers', icon: Users, to: '/customers' },
];

export default function QuickActions() {
  const navigate = useNavigate();
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-slate-900">Quick actions</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              onClick={() => { trackAction(a.key); navigate(a.to); }}
              className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white">
                <Icon size={20} />
              </span>
              <span className="text-sm font-medium text-slate-800">{a.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}