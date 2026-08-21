import { useEffect, useState } from 'react';
import PageHeader from '@/components/app/PageHeader';
import { getNotificationPreferences, setNotificationPreferences } from '@/lib/visaApi';

const CATEGORIES = [
  { key: 'application_updates', label: 'Application updates', desc: 'Stage changes, submission, processing and decisions.' },
  { key: 'appointment_reminders', label: 'Appointment reminders', desc: 'Booking confirmations and reminders before your appointment.' },
  { key: 'payment_updates', label: 'Payment updates', desc: 'Payment success, failures and refunds.' },
  { key: 'document_updates', label: 'Document updates', desc: 'When a document is needed or verified.' },
  { key: 'support_messages', label: 'Support messages', desc: 'Replies from our support team.' },
  { key: 'marketing', label: 'Marketing', desc: 'Offers and product news. Independent of your visa notifications.' },
];
const CHANNELS = [['in_app', 'In-app'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['sms', 'SMS'], ['push', 'Push']];

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lang, setLang] = useState('en');

  useEffect(() => {
    getNotificationPreferences().then((p) => { setPrefs(p); setLang(p.language || 'en'); }).catch(() => {});
  }, []);

  const toggle = (cat, channel) => {
    if (!prefs) return;
    const cur = prefs[cat] || {};
    const next = { ...prefs, [cat]: { ...cur, [channel]: !cur[channel] } };
    setPrefs(next);
    setSaving(true);
    setNotificationPreferences(strip(next)).finally(() => setSaving(false));
  };
  const changeLang = (l) => {
    setLang(l);
    const next = { ...prefs, language: l };
    setPrefs(next);
    setNotificationPreferences(strip(next));
  };

  if (!prefs) return <div className="px-4 md:px-8"><PageHeader title="Notification preferences" /><p className="text-sm text-slate-500">Loading…</p></div>;

  return (
    <div className="px-4 md:px-8">
      <PageHeader title="Notification preferences" subtitle="Choose how you hear about your applications." />
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-slate-500">Language:</span>
        <button onClick={() => changeLang('en')} className={`rounded-full px-3 py-1 text-xs font-semibold ${lang === 'en' ? 'bg-orange-600 text-white' : 'border border-slate-200 text-slate-600'}`}>English</button>
        <button onClick={() => changeLang('hi')} className={`rounded-full px-3 py-1 text-xs font-semibold ${lang === 'hi' ? 'bg-orange-600 text-white' : 'border border-slate-200 text-slate-600'}`}>हिन्दी</button>
        {saving && <span className="text-xs text-slate-400">Saving…</span>}
      </div>

      <div className="space-y-3">
        {CATEGORIES.map((c) => (
          <div key={c.key} className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
            <div className="mb-2">
              <p className="text-sm font-semibold text-slate-900">{c.label}</p>
              <p className="text-xs text-slate-500">{c.desc}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map(([ch, label]) => {
                const on = !!(prefs[c.key] && prefs[c.key][ch]);
                return (
                  <button key={ch} onClick={() => toggle(c.key, ch)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${on ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>
                    {on ? '✓ ' : ''}{label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-400">Critical and security notifications are always delivered, even during quiet hours.</p>
    </div>
  );
}

function strip(p) {
  const { id, created_date, updated_date, created_by_id, traveler_id, ...rest } = p || {};
  void id; void created_date; void updated_date; void created_by_id; void traveler_id;
  return rest;
}