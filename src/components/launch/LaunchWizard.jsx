import { useState } from 'react';
import { Wand2, Loader2, ArrowRight, Sparkles } from 'lucide-react';
import { launchApi } from '@/lib/launchApi';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EXAMPLES = [
  'I want to start a dental clinic in Dallas.',
  'Launch a fitness coaching brand serving busy professionals.',
  'Open an online plant nursery shipping nationwide.',
];

export default function LaunchWizard({ businessId, businessName, onPrepared }) {
  const [goal, setGoal] = useState('');
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const prepare = async () => {
    if (!goal.trim()) { setError('Describe your goal first.'); return; }
    setLoading(true); setError('');
    try {
      await launchApi.prepare({ business_id: businessId, goal, brief });
      onPrepared();
    } catch (e) {
      setError(e.message || 'Could not prepare the launch plan.');
    } finally { setLoading(false); }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#102a2a] text-emerald-300"><Wand2 size={26} /></div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Launch Assistant</h1>
        <p className="mx-auto mt-2 max-w-xl text-slate-600">Describe your business and what you want to launch. The assistant plans every step, asks only what's missing, then runs each module in order — pausing for your approval.</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="goal">Active business</Label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{businessName || businessId}</div>
        </div>
        <div className="mt-5 space-y-2">
          <Label htmlFor="goal">What do you want to launch?</Label>
          <Textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} placeholder="e.g. I want to start a dental clinic in Dallas." />
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="brief">Anything else the assistant should know? <span className="font-normal text-slate-400">(optional)</span></Label>
          <Input id="brief" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Services, audience, brand direction, location…" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setGoal(ex)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-800"><Sparkles size={12} /> {ex}</button>
          ))}
        </div>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end">
          <Button onClick={prepare} disabled={loading} className="bg-emerald-700 text-white hover:bg-emerald-800">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Building launch plan…</> : <><ArrowRight size={16} /> Build my Launch Plan</>}
          </Button>
        </div>
      </div>
    </div>
  );
}