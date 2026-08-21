import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, Wand2 } from 'lucide-react';

export default function AIBuildBar({ businessId, onApply }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const res = await import('@/lib/studioApi').then((m) => m.studioApi.aiBuild(prompt, businessId));
      const canvas = res.canvas || { nodes: [], edges: [] };
      // sync _deps for the config panel
      const depMap = {};
      for (const e of canvas.edges) (depMap[e.to] ||= []).push(e.from);
      canvas.nodes = (canvas.nodes || []).map((n) => ({ ...n, _deps: depMap[n.id] || [], kind: kindOf(n.engine_type || n.type) }));
      onApply(canvas, res.validation);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <Wand2 size={15} className="text-violet-600" />
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && run()}
        placeholder="Describe a workflow: “When a new lead arrives, qualify it, get approval, create CRM opportunity, send welcome email.”"
        className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      />
      <Button onClick={run} disabled={loading || !prompt.trim()} size="sm" className="bg-violet-600 hover:bg-violet-700">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {loading ? 'Generating…' : 'Generate'}
      </Button>
    </div>
  );
}

function kindOf(t) {
  if (!t) return 'flow';
  if (t.startsWith('trigger')) return 'trigger';
  if (t === 'start' || t === 'end' || t === 'merge') return 'flow';
  if (t === 'approval_gate' || t === 'noop.delay') return 'flow';
  if (t.startsWith('exec.')) return 'executive';
  if (t.startsWith('connector.')) return 'connector';
  if (t.startsWith('notify.')) return 'notify';
  return 'factory';
}