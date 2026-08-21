import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles } from 'lucide-react';
import { callDomainEngine } from '@/lib/domainApi';

export default function PlannerCard({ business, onPlanned }) {
  const [seed, setSeed] = useState(business?.name || '');
  const [profile, setProfile] = useState(business?.planner_profile || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (!seed.trim()) return;
    setLoading(true); setError('');
    try {
      const { profile: p } = await callDomainEngine('plan', { seed, brief: business?.description || '' });
      setProfile(p);
      onPlanned?.(p);
    } catch (e) { setError(e.message || 'Could not generate the brand strategy.'); }
    finally { setLoading(false); }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-emerald-50/60">
        <CardTitle className="flex items-center gap-2"><Sparkles size={18} className="text-emerald-700" /> AI Business Planner</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-2">
          <Label htmlFor="seed">Business name</Label>
          <div className="flex gap-2">
            <Input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Momentum Fitness" disabled={loading} />
            <Button onClick={run} disabled={loading || !seed.trim()} className="bg-emerald-800 hover:bg-emerald-900">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Generate strategy
            </Button>
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
        </div>
        {profile && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-xs font-medium uppercase tracking-wide text-emerald-700">{profile.industry}</p><p className="text-lg font-semibold text-slate-900">{profile.tagline}</p></div>
              <Badge variant="secondary">Tone: {profile.tone}</Badge>
            </div>
            <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">Audience:</span> {profile.target_audience}</p>
            <div className="flex flex-wrap gap-1.5">{(profile.keywords || []).map((k) => <Badge key={k} className="bg-white text-emerald-800 border border-emerald-200">{k}</Badge>)}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs font-medium text-slate-500">Services</p><ul className="mt-1 space-y-0.5 text-sm text-slate-700">{(profile.services || []).map((s) => <li key={s}>• {s}</li>)}</ul></div>
              <div><p className="text-xs font-medium text-slate-500">Suggested pages</p><ul className="mt-1 space-y-0.5 text-sm text-slate-700">{(profile.page_plan || []).map((p) => <li key={p}>• {p}</li>)}</ul></div>
            </div>
            <p className="text-sm italic text-slate-600"><span className="not-italic font-medium text-slate-700">Naming direction:</span> {profile.name_direction}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}