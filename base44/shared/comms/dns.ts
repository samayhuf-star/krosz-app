// Email Domain DNS blueprint — deterministic, provider-specific.
//
// Builds the full DNS record set (MX, SPF, DKIM, DMARC, Autodiscover, Return-Path)
// for a business domain from the chosen provider's template, then computes a
// deterministic DNS health score from the record shape (no live DNS lookups —
// the validation step is structural; live verification is the provider's job).

import { getProvider, type DnsRecords } from './providers.ts';

export interface HealthCheck { id: string; check: string; pass: boolean; message: string; }
export interface DnsHealth { score: number; checks: HealthCheck[]; last_checked_at: string; }

export function buildDnsRecords(providerId: string, domain: string, brandName: string): DnsRecords {
  const provider = getProvider(providerId);
  return provider.dnsTemplate(domain, brandName);
}

export function validateDns(records: DnsRecords): DnsHealth {
  const checks: HealthCheck[] = [];
  const add = (id: string, check: string, pass: boolean, message: string) => checks.push({ id, check, pass, message });

  add('mx_present', 'MX records present', Array.isArray(records.mx) && records.mx.length > 0, records.mx?.length ? `${records.mx.length} MX record(s)` : 'No MX records');
  add('spf_present', 'SPF (TXT) present', !!records.spf?.value && /v=spf1/.test(records.spf.value), records.spf?.value ? 'SPF configured' : 'SPF missing');
  add('spf_softfail', 'SPF uses soft/hard fail', !!records.spf?.value && /~all|-all/.test(records.spf.value), /~all|-all/.test(records.spf?.value || '') ? 'SPF fail policy set' : 'SPF has no fail policy');
  add('dkim_present', 'DKIM record present', !!(records.dkim as any) && (Array.isArray(records.dkim) ? records.dkim.length > 0 : !!(records.dkim as any).value), 'DKIM configured');
  add('dmarc_present', 'DMARC (TXT) present', !!records.dmarc?.value && /v=DMARC1/.test(records.dmarc.value), records.dmarc?.value ? 'DMARC configured' : 'DMARC missing');
  add('dmarc_policy', 'DMARC policy set (p=quarantine|reject)', !!records.dmarc?.value && /p=(quarantine|reject)/.test(records.dmarc.value), /p=(quarantine|reject)/.test(records.dmarc?.value || '') ? 'DMARC enforcement set' : 'DMARC monitoring only');
  add('autodiscover', 'Autodiscover record present', !!records.autodiscover?.value, records.autodiscover?.value ? 'Autodiscover configured' : 'Autodiscover missing');
  add('return_path', 'Return-Path / bounce record present', !!(records.return_path as any) && (records.return_path as any).value, 'Return-Path configured');

  const passed = checks.filter((c) => c.pass).length;
  const score = Math.round((passed / checks.length) * 100);
  return { score, checks, last_checked_at: new Date().toISOString() };
}

export function tlsStatusFor(providerId: string): 'enforced' | 'opportunistic' | 'unknown' {
  return getProvider(providerId).security.tls_status;
}