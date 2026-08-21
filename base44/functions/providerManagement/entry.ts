import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { hasProviderAdapter } from '../../shared/providers/registry.ts';
import { adaptersMetadata } from '../../shared/providers/catalog.ts';
import { resolveActiveProviderChain, runAdapterTest } from '../../shared/providers/resolver.ts';
import { recordUsage, recordAudit } from '../../shared/logging.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: platform administrators only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const svc = base44.asServiceRole;

    if (action === 'list') {
      const providers = await svc.entities.Provider.list('category');
      const credentials = await svc.entities.ProviderCredential.list();
      const overrides = await svc.entities.ProviderOverride.list('category');
      const catalog = adaptersMetadata();
      return Response.json({ providers, credentials, overrides, catalog });
    }

    if (action === 'create') {
      const { name, key, category, adapter_key, environment, adapter_config } = body;
      if (!name || !category || !adapter_key) return Response.json({ error: 'name, category and adapter_key are required' }, { status: 400 });
      if (!hasProviderAdapter(adapter_key)) return Response.json({ error: `Unknown adapter: ${adapter_key}` }, { status: 400 });
      const provider = await svc.entities.Provider.create({
        name, key: key || adapter_key, category, adapter_key,
        adapter_config: adapter_config || {}, environment: environment || 'sandbox',
        status: 'not_configured', enabled: false, is_default: false, capabilities: [],
        last_tested_at: null, last_test_success: null, last_test_message: null, last_test_latency: null,
      });
      await recordAudit(base44, { action: 'provider.create', entity_type: 'Provider', entity_id: provider.id, changes: { name, category, adapter_key, environment } });
      return Response.json({ provider });
    }

    if (action === 'update') {
      const { id, name, environment, adapter_config } = body;
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      const patch = {};
      if (name !== undefined) patch.name = name;
      if (environment !== undefined) patch.environment = environment;
      if (adapter_config !== undefined) patch.adapter_config = adapter_config;
      const provider = await svc.entities.Provider.update(id, patch);
      await recordAudit(base44, { action: 'provider.update', entity_type: 'Provider', entity_id: id, changes: patch });
      return Response.json({ provider });
    }

    if (action === 'toggle') {
      const { id, enabled } = body;
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      const existing = await svc.entities.Provider.get(id);
      const newEnabled = Boolean(enabled);
      const provider = await svc.entities.Provider.update(id, {
        enabled: newEnabled,
        status: newEnabled ? (existing.status === 'disabled' ? 'not_configured' : existing.status) : 'disabled',
      });
      await recordAudit(base44, { action: newEnabled ? 'provider.enable' : 'provider.disable', entity_type: 'Provider', entity_id: id, changes: { enabled: newEnabled } });
      return Response.json({ provider });
    }

    if (action === 'setDefault') {
      const { id } = body;
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      const provider = await svc.entities.Provider.get(id);
      const others = await svc.entities.Provider.filter({ category: provider.category, is_default: true });
      for (const other of others) if (other.id !== id) await svc.entities.Provider.update(other.id, { is_default: false });
      const updated = await svc.entities.Provider.update(id, { is_default: true, enabled: true });
      await recordAudit(base44, { action: 'provider.set_default', entity_type: 'Provider', entity_id: id, changes: { category: provider.category } });
      return Response.json({ provider: updated });
    }

    if (action === 'setCredentials') {
      const { provider_id, credential_label, api_key_secret_name, api_secret_secret_name, environment } = body;
      if (!provider_id || !credential_label) return Response.json({ error: 'provider_id and credential_label are required' }, { status: 400 });
      const existing = await svc.entities.ProviderCredential.filter({ provider_id, credential_label });
      let cred;
      if (existing.length) {
        cred = await svc.entities.ProviderCredential.update(existing[0].id, {
          api_key_secret_name: api_key_secret_name || null, api_secret_secret_name: api_secret_secret_name || null,
          environment: environment || 'sandbox',
          key_configured: Boolean(api_key_secret_name), secret_configured: Boolean(api_secret_secret_name),
          status: Boolean(api_key_secret_name || api_secret_secret_name) ? 'configured' : 'pending',
        });
      } else {
        cred = await svc.entities.ProviderCredential.create({
          provider_id, credential_label,
          api_key_secret_name: api_key_secret_name || null, api_secret_secret_name: api_secret_secret_name || null,
          environment: environment || 'sandbox',
          key_configured: Boolean(api_key_secret_name), secret_configured: Boolean(api_secret_secret_name),
          status: Boolean(api_key_secret_name || api_secret_secret_name) ? 'configured' : 'pending',
        });
      }
      await recordAudit(base44, { action: 'provider.set_credentials', entity_type: 'ProviderCredential', entity_id: cred.id, changes: { credential_label } });
      return Response.json({ credential: cred });
    }

    if (action === 'setOverride') {
      const { scope_type, scope_id, category, provider_id } = body;
      if (!scope_type || !scope_id || !category || !provider_id) return Response.json({ error: 'scope_type, scope_id, category, provider_id are required' }, { status: 400 });
      const existing = await svc.entities.ProviderOverride.filter({ scope_type, scope_id, category });
      let override;
      if (existing.length) {
        override = await svc.entities.ProviderOverride.update(existing[0].id, { provider_id });
      } else {
        override = await svc.entities.ProviderOverride.create({ scope_type, scope_id, category, provider_id });
      }
      await recordAudit(base44, { action: 'provider.set_override', entity_type: 'ProviderOverride', entity_id: override.id, changes: { scope_type, scope_id, category, provider_id } });
      return Response.json({ override });
    }

    if (action === 'clearOverride') {
      const { scope_type, scope_id, category } = body;
      const existing = await svc.entities.ProviderOverride.filter({ scope_type, scope_id, category });
      for (const o of existing) await svc.entities.ProviderOverride.delete(o.id);
      await recordAudit(base44, { action: 'provider.clear_override', entity_type: 'ProviderOverride', entity_id: null, changes: { scope_type, scope_id, category } });
      return Response.json({ ok: true });
    }

    if (action === 'resolve') {
      const { category, tenant_id } = body;
      if (!category) return Response.json({ error: 'category is required' }, { status: 400 });
      const resolved = await resolveActiveProviderChain(base44, category, tenant_id);
      return Response.json({ resolved });
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      await svc.entities.Provider.delete(id);
      const creds = await svc.entities.ProviderCredential.filter({ provider_id: id });
      for (const c of creds) await svc.entities.ProviderCredential.delete(c.id);
      const overs = await svc.entities.ProviderOverride.filter({ provider_id: id });
      for (const o of overs) await svc.entities.ProviderOverride.delete(o.id);
      await recordAudit(base44, { action: 'provider.delete', entity_type: 'Provider', entity_id: id, changes: {} });
      return Response.json({ ok: true });
    }

    if (action === 'test') {
      const { id } = body;
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      const provider = await svc.entities.Provider.get(id);
      const result = await runAdapterTest(base44, (name) => { try { return secrets.get(name); } catch { return undefined; } }, provider, {
        invokeLLM: async (prompt, opts) => {
          const res = await svc.integrations.Core.InvokeLLM({ prompt, ...(opts || {}) });
          return res || '';
        },
        fetchExternal: async (url, init) => await fetch(url, init),
      });
      const connected = Boolean(result.success);
      const message = (result.success && result.data && result.data.message) || result.error_message || (result.success ? 'Connected' : 'Connection failed');
      const latency = result.success && result.data ? (result.data.latencyMs ?? null) : null;
      const now = new Date().toISOString();
      await svc.entities.Provider.update(id, {
        last_tested_at: now, last_test_success: connected, last_test_message: message,
        last_test_latency: latency, status: connected ? 'connected' : 'error',
      });
      await recordUsage(base44, {
        provider_id: provider.id, service: 'provider', operation: 'testConnection',
        usage_quantity: 1, usage_unit: 'request', provider_request_id: result.request_id,
        success: connected, kind: 'test_connection', error_message: connected ? null : message,
      });
      await recordAudit(base44, { action: 'provider.test', entity_type: 'Provider', entity_id: id, changes: { connected, message } });
      return Response.json({ result });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}