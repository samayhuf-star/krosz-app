import { useEffect, useState } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { publishIsSaved, publishSaveDestination, publishUnsaveDestination } from '@/lib/visaApi';
import { trackDiscovery } from '@/lib/discoveryIntent';

export default function SaveDestinationButton({ countryCode, slug }) {
  const [authed, setAuthed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ok = false;
    import('@/api/base44Client').then(({ base44 }) => base44.auth.isAuthenticated().then((v) => { setAuthed(!!v); ok = !!v; if (v) publishIsSaved(countryCode).then((r) => setSaved(!!r.saved)).catch(() => {}); }).catch(() => {}));
    void ok; void slug;
  }, [countryCode]);

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
    } finally { setBusy(false); }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        saved ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      } disabled:opacity-50`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className={`h-4 w-4 ${saved ? 'fill-rose-500 text-rose-500' : ''}`} />}
      {saved ? 'Saved' : 'Save'}
    </button>
  );
}