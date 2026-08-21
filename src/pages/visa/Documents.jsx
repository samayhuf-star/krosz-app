import { useEffect, useState } from 'react';
import DocumentVault from '@/components/visa/DocumentVault';
import PageHeader from '@/components/app/PageHeader';

export default function Documents() {
  const [travelerId, setTravelerId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Ensure the user has a traveler profile, then render the vault scoped to it.
    import('@/lib/visaApi').then(({ createTraveler }) => createTraveler({}).then((r) => setTravelerId(r?.traveler?.id || null)).catch(() => setTravelerId(null)).finally(() => setLoading(false)));
  }, []);

  if (loading) return <div className="px-4 md:px-8 py-8 text-sm text-slate-500">Loading your vault…</div>;

  return (
    <div className="pb-16">
      <PageHeader eyebrow="Vault" title="Document Vault" description="Your private, reusable visa documents. Pinned versioning keeps every application auditable." />
      <DocumentVault travelerId={travelerId} />
    </div>
  );
}