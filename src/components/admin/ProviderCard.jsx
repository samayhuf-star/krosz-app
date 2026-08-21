import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CheckCircle2, Clock, FlaskConical, Star, Trash2, XCircle } from 'lucide-react';
import moment from 'moment';

export default function ProviderCard({ provider, busy, onTest, onToggle, onSetDefault, onDelete }) {
  const connected = provider.last_test_success === true;
  const failed = provider.last_test_success === false;
  const untested = provider.last_test_success === null || provider.last_test_success === undefined;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{provider.name}</p>
            {provider.is_default && <Badge className="bg-emerald-100 text-emerald-800">Default</Badge>}
            {provider.enabled ? <Badge variant="secondary">Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}
          </div>
          <p className="mt-1 truncate text-sm text-slate-600">{provider.adapter_key} · {provider.environment}</p>
        </div>
        <Switch checked={Boolean(provider.enabled)} onCheckedChange={(v) => onToggle(provider, v)} aria-label={provider.enabled ? 'Disable provider' : 'Enable provider'} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm">
        {connected && <><CheckCircle2 size={16} className="text-emerald-700" /><span className="text-emerald-800">Connected</span></>}
        {failed && <><XCircle size={16} className="text-rose-600" /><span className="text-rose-700">Connection failed</span></>}
        {untested && <><FlaskConical size={16} className="text-slate-400" /><span className="text-slate-500">Not tested</span></>}
        {provider.last_tested_at && <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500"><Clock size={12} />{moment(provider.last_tested_at).fromNow()}</span>}
      </div>
      {provider.last_test_message && (connected || failed) && (
        <p className={`mt-2 text-xs ${connected ? 'text-slate-600' : 'text-rose-700'}`}>{provider.last_test_message}</p>
      )}
      {typeof provider.last_test_latency === 'number' && (
        <p className="mt-1 text-xs text-slate-500">{provider.last_test_latency} ms</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => onTest(provider)} disabled={busy}><FlaskConical size={14} /> Test</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onSetDefault(provider)} disabled={provider.is_default}><Star size={14} /> Set default</Button>
        <Button type="button" size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => onDelete(provider)}><Trash2 size={14} /> Delete</Button>
      </div>
    </div>
  );
}