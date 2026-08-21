import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const CATEGORIES = ['domain', 'email', 'phone', 'ai', 'payment', 'storage', 'other'];

export default function ProviderDialog({ open, onClose, existing, catalog }) {
  const isEdit = Boolean(existing);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('ai');
  const [adapterKey, setAdapterKey] = useState('');
  const [environment, setEnvironment] = useState('sandbox');
  const [testUrl, setTestUrl] = useState('https://httpbin.org/get');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setName(existing?.name || '');
    setCategory(existing?.category || 'ai');
    setAdapterKey(existing?.adapter_key || '');
    setEnvironment(existing?.environment || 'sandbox');
    setTestUrl(existing?.adapter_config?.test_url || 'https://httpbin.org/get');
    setApiKey('');
  }, [existing, open]);

  const adapters = (catalog || []).filter((a) => a.category === category);
  const selectedAdapter = (catalog || []).find((a) => a.key === adapterKey);
  const needsApiKey = selectedAdapter && selectedAdapter.credentialSchema && selectedAdapter.credentialSchema.length > 0;

  async function submit(e) {
    e.preventDefault();
    if (!name || !adapterKey) return;
    setSaving(true);
    try {
      const adapter_config = adapterKey === 'http_rest' ? { test_url: testUrl || 'https://httpbin.org/get' } : {};
      let providerId = existing?.id;
      if (isEdit) {
        await base44.functions.invoke('providerManagement', { action: 'update', id: providerId, name, environment, adapter_config });
      } else {
        const res = await base44.functions.invoke('providerManagement', { action: 'create', name, category, adapter_key: adapterKey, environment, adapter_config });
        providerId = res?.data?.provider?.id;
      }
      if (needsApiKey) {
        const cred = selectedAdapter.credentialSchema[0];
        await base44.functions.invoke('providerManagement', {
          action: 'setCredentials',
          provider_id: providerId,
          credential_label: cred.name,
          api_key_secret_name: apiKey || cred.name,
          environment,
        });
      }
      toast({ title: isEdit ? 'Provider updated' : 'Provider created' });
      onClose();
    } catch (err) {
      toast({ title: 'Could not save provider', description: String(err?.message || err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 shadow-sm outline-none transition-colors duration-200 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit provider' : 'Add provider'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-name">Provider name</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required disabled={saving} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="p-category">Category</Label>
              <select id="p-category" value={category} disabled={isEdit || saving} onChange={(e) => { setCategory(e.target.value); setAdapterKey(''); }} className={inputCls}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-env">Environment</Label>
              <select id="p-env" value={environment} disabled={saving} onChange={(e) => setEnvironment(e.target.value)} className={inputCls}>
                <option value="sandbox">sandbox</option>
                <option value="production">production</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-adapter">Adapter</Label>
            <select id="p-adapter" value={adapterKey} disabled={isEdit || saving || adapters.length === 0} onChange={(e) => setAdapterKey(e.target.value)} className={inputCls}>
              <option value="">{adapters.length ? 'Select…' : 'No adapter available'}</option>
              {adapters.map((a) => <option key={a.key} value={a.key}>{a.displayName}</option>)}
            </select>
            {adapters.length === 0 && <p className="text-xs text-slate-500">No adapter is installed for this category yet. Domain, email, phone, AI, payment and storage adapters are added here as they are implemented.</p>}
          </div>
          {adapterKey === 'http_rest' && (
            <div className="space-y-2">
              <Label htmlFor="p-url">Test URL (HTTP ping)</Label>
              <Input id="p-url" value={testUrl} onChange={(e) => setTestUrl(e.target.value)} disabled={saving} placeholder="https://httpbin.org/get" />
            </div>
          )}
          {needsApiKey && (
            <div className="space-y-2">
              <Label htmlFor="p-key">API key secret name</Label>
              <Input id="p-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={saving} placeholder={selectedAdapter.credentialSchema[0].name} />
              <p className="text-xs text-slate-500">Enter only the secret name (the value is stored in Dashboard → environment variables, never in this form).</p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost" disabled={saving}>Cancel</Button></DialogClose>
            <Button type="submit" disabled={saving || !adapterKey}>{saving && <Loader2 size={16} className="animate-spin" />}{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create provider'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}