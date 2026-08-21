import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Target Slack channel for "new application" alerts.
const CHANNEL_ID = "C0BR7V9AJLB";

function countryName(code) {
  if (!code) return 'Destination not selected';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()) || String(code); } catch { return String(code); }
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { application_id, destination, purpose, case_state, traveler_id } = body || {};

    let travelerName = '';
    if (traveler_id) {
      try {
        const t = await base44.asServiceRole.entities.Traveler.get(traveler_id);
        travelerName = t?.full_name || [t?.first_name, t?.last_name].filter(Boolean).join(' ') || '';
      } catch { /* traveler lookup is best-effort */ }
    }

    const shortId = String(application_id || '').slice(-6).toUpperCase();
    const dest = countryName(destination);
    const purposeLabel = purpose ? String(purpose).charAt(0).toUpperCase() + String(purpose).slice(1) : '—';
    const state = case_state || 'DRAFT';

    const lines = [
      ':new: *New visa application started*',
      `• Destination: ${dest}`,
      `• Purpose: ${purposeLabel}`,
    ];
    if (travelerName) lines.push(`• Traveler: ${travelerName}`);
    lines.push(`• Case state: ${state}`);
    if (shortId) lines.push(`• App ID: APP-${shortId}`);

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("slackbot");
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: CHANNEL_ID,
        text: lines.join('\n'),
        username: 'Krosz Visa',
        icon_emoji: ':airplane:',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      if (data.error === 'channel_not_found' || data.error === 'not_in_channel') {
        return Response.json({ error: `${data.error} — invite the Krosz Visa bot to the #all-krosz channel in Slack.` }, { status: 403 });
      }
      return Response.json({ error: data.error || 'slack_error' }, { status: 502 });
    }
    return Response.json({ ok: true, channel: CHANNEL_ID, ts: data.ts });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}