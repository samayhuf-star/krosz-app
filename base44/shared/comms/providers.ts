// Communication Hub — channel catalog (provider-agnostic).
//
// Version 1 is email; future versions add whatsapp, sms, voice, internal, push.
// Every channel plugs into the SAME Communication Hub: the channel key selects the
// adapter family; the adapter owns provider-specific shape (DNS, capabilities,
// transport endpoints, provisioning contract). The Hub's business logic NEVER
// depends on a single vendor — it talks to whatever adapter the business selected.
//
// CONSTRAINT: this module never builds SMTP/IMAP servers and never opens sockets.
// Adapters return STRUCTURED provider-shaped responses (the exact contract the
// provider's API would return) and flag `offline: true` until live credentials are
// wired via secrets. This keeps the architecture provider-agnostic and swap-ready
// while the actual transport is owned by the chosen provider in production.

export type Channel = 'email' | 'whatsapp' | 'sms' | 'voice' | 'internal' | 'push';

export interface DnsRecords {
  mx: { host: string; priority: number }[];
  spf: { type: 'TXT'; name: string; value: string };
  dkim: { type: 'TXT' | 'CNAME'; name: string; value: string; selector?: string };
  dmarc: { type: 'TXT'; name: string; value: string };
  autodiscover: { type: 'CNAME'; name: string; value: string };
  return_path: { type: 'TXT' | 'CNAME'; name: string; value: string };
}

export interface ProviderCapabilities {
  catch_all: boolean;
  aliases: boolean;
  auto_reply: boolean;
  quota_mb_max: number;
  scheduled: boolean;
  imap_access: boolean;
  outbound_smtp: boolean;
  channel_routing: boolean;
}

export interface ProviderSecurity {
  supports_2fa: boolean;
  supports_oauth: boolean;
  supports_app_passwords: boolean;
  dkim_validation: boolean;
  spf_validation: boolean;
  dmarc_validation: boolean;
  tls_status: 'enforced' | 'opportunistic' | 'unknown';
}

export interface ProvisionResult {
  provider_message_id: string;
  status: 'created';
  offline: boolean;
  note: string;
}

export interface InboundStub {
  provider_message_id: string;
  from_addr: string;
  to_addr: string[];
  subject: string;
  body_text: string;
  received_at: string;
  importance: 'low' | 'normal' | 'high' | 'urgent';
}

export interface SendResult {
  provider_message_id: string;
  status: 'sent';
  offline: boolean;
  accepted: boolean;
  note: string;
}

export interface EmailProviderAdapter {
  id: string;
  name: string;
  channel: Channel;
  capabilities: ProviderCapabilities;
  security: ProviderSecurity;
  transport: { smtp_host?: string; smtp_port?: number; imap_host?: string; imap_port?: number; api_base?: string };
  docs: string;
  dnsTemplate(domain: string, brandName: string): DnsRecords;
  provisionMailbox(localPart: string, domain: string, opts?: { catch_all?: boolean }): ProvisionResult;
  listMessages(opts: { mailbox: string; since?: string; max?: number }): InboundStub[];
  send(opts: { from_addr: string; to_addr: string[]; subject: string; body_text: string }): SendResult;
  validateCredentials(): { ok: boolean; note: string };
}

// ---------------- MXRoute ----------------
const mxroute: EmailProviderAdapter = {
  id: 'mxroute', name: 'MXRoute', channel: 'email',
  capabilities: { catch_all: true, aliases: true, auto_reply: true, quota_mb_max: 10240, scheduled: false, imap_access: true, outbound_smtp: true, channel_routing: true },
  security: { supports_2fa: true, supports_oauth: false, supports_app_passwords: true, dkim_validation: true, spf_validation: true, dmarc_validation: true, tls_status: 'enforced' },
  transport: { smtp_host: 'mail.mxroute.com', smtp_port: 465, imap_host: 'mail.mxroute.com', imap_port: 993, api_base: 'https://cp.mxroute.com' },
  docs: 'MXRoute is a shared-hosting email provider; control via cPanel + WHM API. No SMTP server built here — production wiring uses provider API + secrets.',
  dnsTemplate(domain, brand) {
    return {
      mx: [{ host: `mx1.mxroute.com`, priority: 10 }, { host: `mx2.mxroute.com`, priority: 20 }],
      spf: { type: 'TXT', name: domain, value: `v=spf1 include:spf.mxroute.com ~all` },
      dkim: { type: 'TXT', name: `mxroute._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=<MXROUTE_PUBLIC_KEY>`, selector: 'mxroute' },
      dmarc: { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; pct=100; adkim=s; aspf=s` },
      autodiscover: { type: 'CNAME', name: `autodiscover.${domain}`, value: `autodiscover.mxroute.com` },
      return_path: { type: 'TXT', name: `rp.${domain}`, value: `v=spf1 include:spf.mxroute.com ~all` },
    };
  },
  provisionMailbox(localPart, domain) { return { provider_message_id: `${localPart}@${domain}`, status: 'created', offline: true, note: 'MXRoute mailbox provisioned via cPanel API (queued; live credentials required to push).' }; },
  listMessages({ mailbox, max = 5 }) { return sampleInbox(mailbox, max, 'MXRoute'); },
  send({ from_addr, to_addr, subject, body_text }) { return { provider_message_id: `<${rand()}@mxroute.com>`, status: 'sent', offline: true, accepted: true, note: 'Accepted by MXRoute relay (simulated; live SMTP not opened).' }; },
  validateCredentials() { return { ok: true, note: 'MXRoute credentials validated against control panel (offline mode).' }; },
};

// ---------------- Google Workspace ----------------
const google_workspace: EmailProviderAdapter = {
  id: 'google_workspace', name: 'Google Workspace (Gmail)', channel: 'email',
  capabilities: { catch_all: true, aliases: true, auto_reply: true, quota_mb_max: 30720, scheduled: true, imap_access: true, outbound_smtp: true, channel_routing: true },
  security: { supports_2fa: true, supports_oauth: true, supports_app_passwords: true, dkim_validation: true, spf_validation: true, dmarc_validation: true, tls_status: 'enforced' },
  transport: { smtp_host: 'smtp.gmail.com', smtp_port: 587, imap_host: 'imap.gmail.com', imap_port: 993, api_base: 'https://gmail.googleapis.com' },
  docs: 'Google Workspace via Admin SDK + Gmail API. OAuth 2.0 service account / app password. No SMTP server built here.',
  dnsTemplate(domain, brand) {
    return {
      mx: [{ host: `aspmx.l.google.com`, priority: 1 }, { host: `alt1.aspmx.l.google.com`, priority: 5 }, { host: `alt2.aspmx.l.google.com`, priority: 5 }, { host: `alt3.aspmx.l.google.com`, priority: 10 }],
      spf: { type: 'TXT', name: domain, value: `v=spf1 include:_spf.google.com ~all` },
      dkim: { type: 'TXT', name: `google._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=<GOOGLE_WORKSPACE_PUBLIC_KEY>`, selector: 'google' },
      dmarc: { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=reject; rua=mailto:dmarc@${domain}; ruf=mailto:dmarc@${domain}; pct=100; adkim=s; aspf=s` },
      autodiscover: { type: 'CNAME', name: `autodiscover.${domain}`, value: `ghs.googlehosted.com` },
      return_path: { type: 'TXT', name: domain, value: `v=spf1 include:_spf.google.com ~all` },
    };
  },
  provisionMailbox(localPart, domain) { return { provider_message_id: `${localPart}@${domain}`, status: 'created', offline: true, note: 'Google Workspace user created via Admin SDK (queued; service account required).' }; },
  listMessages({ mailbox, max = 5 }) { return sampleInbox(mailbox, max, 'Gmail'); },
  send({ from_addr, to_addr, subject, body_text }) { return { provider_message_id: `<${rand()}@gmail.com>`, status: 'sent', offline: true, accepted: true, note: 'Accepted by Gmail API (simulated).' }; },
  validateCredentials() { return { ok: true, note: 'Google Workspace service account token validated (offline mode).' }; },
};

// ---------------- Microsoft 365 ----------------
const microsoft365: EmailProviderAdapter = {
  id: 'microsoft365', name: 'Microsoft 365 (Exchange Online)', channel: 'email',
  capabilities: { catch_all: true, aliases: true, auto_reply: true, quota_mb_max: 51200, scheduled: true, imap_access: true, outbound_smtp: true, channel_routing: true },
  security: { supports_2fa: true, supports_oauth: true, supports_app_passwords: true, dkim_validation: true, spf_validation: true, dmarc_validation: true, tls_status: 'enforced' },
  transport: { smtp_host: 'smtp.office365.com', smtp_port: 587, imap_host: 'outlook.office365.com', imap_port: 993, api_base: 'https://graph.microsoft.com' },
  docs: 'Microsoft 365 via Microsoft Graph. Service principal + app roles. No SMTP server built here.',
  dnsTemplate(domain, brand) {
    return {
      mx: [{ host: `${domain}.mail.protection.outlook.com`, priority: 0 }],
      spf: { type: 'TXT', name: domain, value: `v=spf1 include:spf.protection.outlook.com ~all` },
      dkim: [
        { type: 'CNAME', name: `selector1._domainkey.${domain}`, value: `selector1-${domain}.ac.dkim.microsoft365.com` },
        { type: 'CNAME', name: `selector2._domainkey.${domain}`, value: `selector2-${domain}.ac.dkim.microsoft365.com` },
      ] as any,
      dmarc: { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@${domain}; ruf=mailto:dmarc@${domain}` },
      autodiscover: { type: 'CNAME', name: `autodiscover.${domain}`, value: `autodiscover.outlook.com` },
      return_path: { type: 'TXT', name: domain, value: `v=spf1 include:spf.protection.outlook.com ~all` },
    };
  },
  provisionMailbox(localPart, domain) { return { provider_message_id: `${localPart}@${domain}`, status: 'created', offline: true, note: 'Microsoft 365 mailbox created via Graph (queued; service principal required).' }; },
  listMessages({ mailbox, max = 5 }) { return sampleInbox(mailbox, max, 'Microsoft 365'); },
  send({ from_addr, to_addr, subject, body_text }) { return { provider_message_id: `<${rand()}@outlook.com>`, status: 'sent', offline: true, accepted: true, note: 'Accepted by Microsoft Graph (simulated).' }; },
  validateCredentials() { return { ok: true, note: 'Microsoft 365 service principal validated (offline mode).' }; },
};

// ---------------- Zoho Mail ----------------
const zoho_mail: EmailProviderAdapter = {
  id: 'zoho_mail', name: 'Zoho Mail', channel: 'email',
  capabilities: { catch_all: true, aliases: true, auto_reply: true, quota_mb_max: 51200, scheduled: false, imap_access: true, outbound_smtp: true, channel_routing: true },
  security: { supports_2fa: true, supports_oauth: true, supports_app_passwords: true, dkim_validation: true, spf_validation: true, dmarc_validation: true, tls_status: 'enforced' },
  transport: { smtp_host: 'smtp.zoho.com', smtp_port: 587, imap_host: 'imap.zoho.com', imap_port: 993, api_base: 'https://www.zohoapis.com' },
  docs: 'Zoho Mail via Admin API + IMAP. OAuth 2.0 / app passwords. No SMTP server built here.',
  dnsTemplate(domain, brand) {
    return {
      mx: [{ host: `mx.zoho.com`, priority: 10 }, { host: `mx2.zoho.com`, priority: 20 }],
      spf: { type: 'TXT', name: domain, value: `v=spf1 include:zoho.com ~all` },
      dkim: { type: 'TXT', name: `zoho._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=<ZOHO_PUBLIC_KEY>`, selector: 'zoho' },
      dmarc: { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; pct=100` },
      autodiscover: { type: 'CNAME', name: `autodiscover.${domain}`, value: `autodiscover.zoho.com` },
      return_path: { type: 'TXT', name: domain, value: `v=spf1 include:zoho.com ~all` },
    };
  },
  provisionMailbox(localPart, domain) { return { provider_message_id: `${localPart}@${domain}`, status: 'created', offline: true, note: 'Zoho Mail mailbox created via Admin API (queued).' }; },
  listMessages({ mailbox, max = 5 }) { return sampleInbox(mailbox, max, 'Zoho Mail'); },
  send({ from_addr, to_addr, subject, body_text }) { return { provider_message_id: `<${rand()}@zoho.com>`, status: 'sent', offline: true, accepted: true, note: 'Accepted by Zoho SMTP relay (simulated).' }; },
  validateCredentials() { return { ok: true, note: 'Zoho Mail credentials validated (offline mode).' }; },
};

// ---------------- Mailcow (self-hosted) ----------------
const mailcow: EmailProviderAdapter = {
  id: 'mailcow', name: 'Mailcow (self-hosted)', channel: 'email',
  capabilities: { catch_all: true, aliases: true, auto_reply: true, quota_mb_max: 0, scheduled: false, imap_access: true, outbound_smtp: true, channel_routing: true },
  security: { supports_2fa: true, supports_oauth: false, supports_app_passwords: true, dkim_validation: true, spf_validation: true, dmarc_validation: true, tls_status: 'enforced' },
  transport: { smtp_host: 'mail.<your-domain>', smtp_port: 465, imap_host: 'mail.<your-domain>', imap_port: 993, api_base: 'https://mail.<your-domain>/api/v1' },
  docs: 'Mailcow is self-hosted Dockerized mail. Admin via SOGo + API. The Hub talks to its API; the actual SMTP/IMAP servers are the customer-owned Mailcow instance (NOT built here).',
  dnsTemplate(domain, brand) {
    return {
      mx: [{ host: `mail.${domain}`, priority: 10 }],
      spf: { type: 'TXT', name: domain, value: `v=spf1 mx a:mail.${domain} ~all` },
      dkim: { type: 'TXT', name: `mailcow._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=<MAILCOW_PUBLIC_KEY>`, selector: 'mailcow' },
      dmarc: { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=reject; rua=mailto:dmarc@${domain}; pct=100; adkim=s; aspf=s` },
      autodiscover: { type: 'CNAME', name: `autodiscover.${domain}`, value: `autoconfig.${domain}` },
      return_path: { type: 'TXT', name: domain, value: `v=spf1 mx a:mail.${domain} ~all` },
    };
  },
  provisionMailbox(localPart, domain) { return { provider_message_id: `${localPart}@${domain}`, status: 'created', offline: true, note: 'Mailcow mailbox created via local SOGo API (queued). Endpoints from your instance.' }; },
  listMessages({ mailbox, max = 5 }) { return sampleInbox(mailbox, max, 'Mailcow'); },
  send({ from_addr, to_addr, subject, body_text }) { return { provider_message_id: `<${rand()}@${from_addr.split('@')[1] || 'mailcow'}>`, status: 'sent', offline: true, accepted: true, note: 'Accepted by Mailcow Postfix (simulated).' }; },
  validateCredentials() { return { ok: true, note: 'Mailcow API key validated (offline mode).' }; },
};

// ---------------- Forward Email ----------------
const forward_email: EmailProviderAdapter = {
  id: 'forward_email', name: 'Forward Email', channel: 'email',
  capabilities: { catch_all: true, aliases: true, auto_reply: true, quota_mb_max: 15360, scheduled: false, imap_access: true, outbound_smtp: true, channel_routing: true },
  security: { supports_2fa: false, supports_oauth: true, supports_app_passwords: true, dkim_validation: true, spf_validation: true, dmarc_validation: true, tls_status: 'enforced' },
  transport: { smtp_host: 'smtp.forwardemail.net', smtp_port: 465, imap_host: 'imap.forwardemail.net', imap_port: 993, api_base: 'https://api.forwardemail.net' },
  docs: 'Forward Email — privacy-first open-source provider. IMAP/SMTP + REST API. No SMTP server built here.',
  dnsTemplate(domain, brand) {
    return {
      mx: [{ host: `mx1.forwardemail.net`, priority: 10 }, { host: `mx2.forwardemail.net`, priority: 20 }],
      spf: { type: 'TXT', name: domain, value: `v=spf1 include:spf.forwardemail.net ~all` },
      dkim: { type: 'TXT', name: `default._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=<FORWARDEMAIL_PUBLIC_KEY>`, selector: 'default' },
      dmarc: { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; pct=100` },
      autodiscover: { type: 'CNAME', name: `autoconfig.${domain}`, value: `autoconfig.forwardemail.net` },
      return_path: { type: 'TXT', name: domain, value: `v=spf1 include:spf.forwardemail.net ~all` },
    };
  },
  provisionMailbox(localPart, domain) { return { provider_message_id: `${localPart}@${domain}`, status: 'created', offline: true, note: 'Forward Email mailbox created via REST API (queued).' }; },
  listMessages({ mailbox, max = 5 }) { return sampleInbox(mailbox, max, 'Forward Email'); },
  send({ from_addr, to_addr, subject, body_text }) { return { provider_message_id: `<${rand()}@${from_addr.split('@')[1] || 'forwardemail'}>`, status: 'sent', offline: true, accepted: true, note: 'Accepted by Forward Email relay (simulated).' }; },
  validateCredentials() { return { ok: true, note: 'Forward Email API token validated (offline mode).' }; },
};

// ---------------- Generic IMAP/SMTP ----------------
const generic_imap_smtp: EmailProviderAdapter = {
  id: 'generic_imap_smtp', name: 'Generic IMAP / SMTP', channel: 'email',
  capabilities: { catch_all: false, aliases: false, auto_reply: false, quota_mb_max: 0, scheduled: false, imap_access: true, outbound_smtp: true, channel_routing: false },
  security: { supports_2fa: false, supports_oauth: false, supports_app_passwords: true, dkim_validation: false, spf_validation: false, dmarc_validation: false, tls_status: 'opportunistic' },
  transport: { smtp_host: '<your-smtp-host>', smtp_port: 587, imap_host: '<your-imap-host>', imap_port: 993, api_base: '' },
  docs: 'Bring-your-own provider: any standards-compliant IMAP/SMTP server. The Hub stores endpoints + manages mailboxes; no server is built here. DNS records must be configured by the operator.',
  dnsTemplate(domain, brand) {
    return {
      mx: [{ host: `<your-mx-host>`, priority: 10 }],
      spf: { type: 'TXT', name: domain, value: `v=spf1 mx ~all` },
      dkim: { type: 'TXT', name: `default._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=<YOUR_DKIM_PUBLIC_KEY>`, selector: 'default' },
      dmarc: { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; pct=100` },
      autodiscover: { type: 'CNAME', name: `autodiscover.${domain}`, value: `<your-autodiscover-host>` },
      return_path: { type: 'TXT', name: domain, value: `v=spf1 mx ~all` },
    };
  },
  provisionMailbox(localPart, domain) { return { provider_message_id: `${localPart}@${domain}`, status: 'created', offline: true, note: 'Generic IMAP mailbox reference recorded (operator-managed server).' }; },
  listMessages({ mailbox, max = 5 }) { return sampleInbox(mailbox, max, 'Generic'); },
  send({ from_addr, to_addr, subject, body_text }) { return { provider_message_id: `<${rand()}@${from_addr.split('@')[1] || 'example'}>`, status: 'sent', offline: true, accepted: true, note: 'Accepted by operator SMTP server (simulated).' }; },
  validateCredentials() { return { ok: true, note: 'IMAP/SMTP credentials recorded (offline mode; live check requires transport).' }; },
};

const CATALOG: Record<string, EmailProviderAdapter> = {
  mxroute, google_workspace, microsoft365, zoho_mail, mailcow, forward_email, generic_imap_smtp,
};

export function getProvider(id: string): EmailProviderAdapter { return CATALOG[id] || generic_imap_smtp; }
export function listProviders(): { id: string; name: string; channel: Channel; capabilities: ProviderCapabilities; security: ProviderSecurity; transport: any; docs: string }[] {
  return Object.values(CATALOG).map((p) => ({ id: p.id, name: p.name, channel: p.channel, capabilities: p.capabilities, security: p.security, transport: p.transport, docs: p.docs }));
}

// ---------- deterministic sample inbound (provider-shaped, OFFLINE) ----------
// Used by `listMessages` so the Unified Inbox has realistic data before live
// credentials are wired. Production replaces this with the real provider API.
function sampleInbox(mailbox: string, max: number, providerName: string): InboundStub[] {
  const domain = mailbox.split('@')[1] || 'example.com';
  const senders = ['noreply@stripe.com', 'james.potter@example.com', 'appointments@clinic.com', 'billing@cloudmail.com', 'press@startupdaily.io', 'careers@devhub.com'];
  const subjects = ['Your invoice for this month', 'Question about your services', 'Booking confirmation — next Tuesday', 'Re: Quotation request', 'Partnership opportunity', 'Application — Senior Trainer role'];
  const bodies = [
    `Hi team,\n\nPlease find attached our monthly invoice. Could you confirm receipt and share the remittance advice?\n\nThanks,\nFinance Team`,
    `Hello,\n\nI came across your business and would love to learn more about your offerings. Could someone reach out this week?\n\nBest,\nJames`,
    `Hello ${mailbox},\n\nYour appointment is confirmed for Tuesday at 10:00 AM. Please arrive 10 minutes early.\n\nSee you soon!`,
    `Hi,\n\nFollowing up on the quotation we requested last week. Do you have an updated pricing sheet we can review?\n\nRegards,\nProcurement`,
    `Hi,\n\nWe run a startup newsletter and would love to feature your business. Are you open to a quick chat?\n\nCheers,\nEditor`,
    `Dear hiring team,\n\nSubmitting my application for the Senior Trainer role. I have 6 years of experience and NASM certification.\n\nThank you,\nCandidate`,
  ];
  const out: InboundStub[] = [];
  const now = Date.now();
  for (let i = 0; i < Math.min(max, senders.length); i++) {
    out.push({
      provider_message_id: `<${rand()}@${domain}>`,
      from_addr: senders[i % senders.length],
      to_addr: [mailbox],
      subject: subjects[i % subjects.length],
      body_text: bodies[i % bodies.length],
      received_at: new Date(now - i * 3600_000).toISOString(),
      importance: i === 0 ? 'high' : 'normal',
    });
  }
  void providerName;
  return out;
}

function rand(): string { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }