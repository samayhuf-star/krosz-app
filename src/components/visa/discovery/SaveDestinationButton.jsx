import { useEffect, useState } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { publishIsSaved, publishSaveDestination, publishUnsaveDestination } from '@/lib/visaApi';
import { trackDiscovery } from '@/lib/discoveryIntent';
import { useAuth } from '@/lib/AuthContext';

export default function SaveDestinationButton({ countryCode, slug }) {
  // Use the app's resolved auth state: base44.auth.isAuthenticated() only sees
  // bearer tokens, so cookie/SSO sessions were treated as signed out and looped
  // through /login without ever saving.
  const { isAuthenticated: authed } = useAuth();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!authed) return;
    publishIsSaved(countryCode).then((r) => setSaved(!!r.saved)).catch(() => {});
  }, [countryCode, authed]);

  const toggle = async () => {
    trackDiscovery('SAVED_DESTINATION', { destination: countryCode });
    if (!authed) {
      // For anonymous: persist as intent and route to login preserving the destination.
      import('@/lib/discoveryIntent').then(({ setDiscoveryIntent }) => setDiscoveryIntent({ destination: countryCode, slug, intent: 'save' }));
      window.location.href = `/login?returnTo=${encodeURIComponent(`/visa/${slug}`)}`;
      return;
    }
    setBusy(true);
    try {
      if (saved) { await publishUnsaveDestination(countryCode); setSaved(false); }
      else { await publishSaveDestination(countryCode); setSaved(true); }
      setErr('');
    } catch (e) { setErr(e?.message || 'Could not update saved destinations.'); }
    finally { setBusy(false); }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      title={err || undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        saved ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      } disabled:opacity-50`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className={`h-4 w-4 ${saved ? 'fill-rose-500 text-rose-500' : ''}`} />}
      {saved ? 'Saved' : 'Save'}
      {err && <span role="alert" className="sr-only">{err}</span>}
    </button>
  );
}