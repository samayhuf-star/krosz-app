import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { callProviderManagement } from '@/lib/providerApi';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Save, Trash2, Search, Store, Building2 } from 'lucide-react';

const OVERRIDE_CATEGORIES = ['domain', 'email', 'phone', 'ai', 'payment'];

const LEVEL_LABELS = {
  tenant_override: 'Tenant Override',
  reseller_override: 'Reseller Override',
  platform_default: 'Platform Default',
  platform_fallback: 'Platform Fallback',
  none: 'None',
};

export default function OverrideManager({ scope, providers, overrides, onResolved }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isReseller = scope === 'reseller';

  const [scopeId, setScopeId] = useState('');
  const [category, setCategory] = useState('domain');
  const [providerId, setProviderId] = useState('');

  const accountsQuery = useQuery({
    queryKey: [isReseller ? 'whiteLabelAccounts' : 'tenants'],
    queryFn: () => (isReseller ? base44.entities.WhiteLabelAccount.list() : base44.entities.Tenant.list()),
  });
  const accounts = accountsQuery.data || [];

  const enabledProviders = useMemo(
    () => (providers || []).filter((p) => p.category === category && p.enabled),
    [providers, category]
  );
  const current = useMemo(
    () => (overrides || []).find((o) => o.scope_type === scope && o.scope_id === scopeId && o.category === category),
    [overrides, scope, scopeId, category]
  );
  const currentProvider = current ? (providers || []).find((p) => p.id === current.provider_id) : null;

  const setMut = useMutation({
    mutationFn: (pid) => callProviderManagement('setOverride', { scope_type: scope, scope_id: scopeId, category, provider_id: pid }),
    onSuccess: () => { qc.invalidateQueries(['providers']); toast({ title: 'Override saved' }); setProviderId(''); },
    onError: (e) => toast({ title: 'Save failed', description: String(e?.message || e), variant: 'destructive' }),
  });
  const clearMut = useMutation({
    mutationFn: () => callProviderManagement('clearOverride', { scope_type: scope, scope_id: scopeId, category }),
    onSuccess: () => qc.invalidateQueries(['providers']),
    onError: (e) => toast({ title: 'Remove failed', description: String(e?.message || e), variant: 'destructive' }),
  });
  const resolveMut = useMutation({
    mutationFn: () => callProviderManagement('resolve', { category, tenant_id: scopeId }),
    onSuccess: (d) => onResolved?.(d?.resolved?.level ?? null),
  });
  const resolved = resolveMut.data?.resolved;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center gap-3 border-b bg-slate-50 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          {isReseller ? <Store size={18} /> : <Building2 size={18} />}
        </span>
        <div>
          <h2 className="font-semibold text-slate-900">{isReseller ? 'Reseller / white-label overrides' : 'Tenant overrides'}</h2>
          <p className="text-xs text-slate-500">
            {isReseller
              ? 'Pin a provider to a reseller account; every tenant under it inherits this unless overridden.'
              : 'Pin a provider to a single tenant — highest priority in the resolution chain.'}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{isReseller ? 'Reseller account' : 'Tenant'}</label>
            <Select value={scopeId || undefined} onValueChange={(v) => { setScopeId(v); resolveMut.reset(); onResolved?.(null); }}>
              <SelectTrigger><SelectValue placeholder={accountsQuery.isLoading ? 'Loading…' : `Select ${isReseller ? 'reseller' : 'tenant'}`} /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}{a.slug ? ` · ${a.slug}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</label>
            <Select value={category} onValueChange={(v) => { setCategory(v); setProviderId(''); resolveMut.reset(); onResolved?.(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OVERRIDE_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Enabled provider</label>
            <Select value={providerId || undefined} onValueChange={setProviderId} disabled={!scopeId || enabledProviders.length === 0}>
              <SelectTrigger><SelectValue placeholder={enabledProviders.length === 0 ? 'None enabled' : 'Select provider'} /></SelectTrigger>
              <SelectContent>
                {enabledProviders.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {enabledProviders.length === 0 && (
          <p className="text-xs text-amber-700">No provider is enabled for <span className="font-semibold capitalize">{category}</span> — enable one on the Providers tab before setting an override.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => providerId && setMut.mutate(providerId)} disabled={!scopeId || !providerId || setMut.isPending}>
            <Save size={16} /> Save override
          </Button>
          {current && (
            <Button variant="outline" onClick={() => clearMut.mutate()} disabled={clearMut.isPending || !scopeId}>
              <Trash2 size={16} /> Remove override
            </Button>
          )}
          {!isReseller && (
            <Button variant="secondary" onClick={() => resolveMut.mutate()} disabled={!scopeId || resolveMut.isPending}>
              <Search size={16} /> Resolve preview
            </Button>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current override</p>
          {current ? (
            <p className="mt-1 text-slate-900">
              <span className="capitalize">{category}</span> → <span className="font-semibold">{currentProvider ? currentProvider.name : '(provider missing)'}</span>
            </p>
          ) : (
            <p className="mt-1 text-slate-500">No <span className="capitalize">{scope}</span> override set for <span className="capitalize">{category}</span>{scopeId ? '' : ' — select an account first'}.</p>
          )}
        </div>

        {!isReseller && resolved && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Resolved provider</p>
            <p className="mt-1 text-emerald-900">
              <span className="font-semibold">{LEVEL_LABELS[resolved.level]}</span>
              {' → '}
              {resolved.provider ? resolved.provider.name : 'None'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}