import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { ShieldCheck, Globe, FileText, BookOpen, Loader2 } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { seedDiscoveryCatalog, runDiscoveryContractTests } from '@/lib/visaApi';

export default function VisaIntelligenceAdmin() {
  const { user } = useAuth();
  const [countries, setCountries] = useState([]);
  const [nationalities, setNationalities] = useState([]);
  const [purposes, setPurposes] = useState([]);
  const [visaTypes, setVisaTypes] = useState([]);
  const [versions, setVersions] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [tests, setTests] = useState(null);

  const load = async () => {
    setLoading(true);
    const [c, n, p, vt, v, s] = await Promise.all([
      base44.entities.Country.list().catch(() => []),
      base44.entities.Nationality.list().catch(() => []),
      base44.entities.TravelPurpose.list().catch(() => []),
      base44.entities.VisaType.list().catch(() => []),
      base44.entities.VisaRequirementsVersion.list().catch(() => []),
      base44.entities.VisaSource.list().catch(() => []),
    ]);
    setCountries(c || []); setNationalities(n || []); setPurposes(p || []);
    setVisaTypes(vt || []); setVersions(v || []); setSources(s || []);
    setLoading(false);
  };

  useEffect(() => { if (user?.role === 'admin') load(); }, [user?.role]);

  const runSeed = async () => { setBusy('seed'); try { await seedDiscoveryCatalog(); await load(); } finally { setBusy(null); } };
  const runTests = async () => { setBusy('tests'); try { const r = await runDiscoveryContractTests(); setTests(r); } finally { setBusy(null); } };

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Visa Intelligence"
        description="Manage countries, visa types, rule versions, and sources. All catalog data is dev-seed until verified against official sources."
        action={
          <div className="flex gap-2">
            <button onClick={runTests} disabled={busy === 'tests'} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {busy === 'tests' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck size={15} />} Run tests
            </button>
            <button onClick={runSeed} disabled={busy === 'seed'} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700">
              {busy === 'seed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe size={15} />} Seed catalog
            </button>
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        {tests && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-900">Contract tests: {tests.passed}/{tests.total} {tests.pass ? '✓ all passing' : '✗ failures'}</p>
            <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {tests.results?.map((t) => (
                <p key={t.name} className={`text-xs ${t.pass ? 'text-orange-600' : 'text-rose-600'}`}>• {t.pass ? '✓' : '✗'} {t.name} {t.detail ? `— ${t.detail}` : ''}</p>
              ))}
            </div>
          </div>
        )}

        {loading ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" /> : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card icon={Globe} title="Countries" count={countries.length}>
              <Table rows={countries} cols={[['code', 'Code'], ['name', 'Name'], ['region', 'Region']]} />
            </Card>
            <Card icon={Globe} title="Nationalities" count={nationalities.length}>
              <Table rows={nationalities} cols={[['code', 'Code'], ['name', 'Name'], ['country_code', 'Country']]} />
            </Card>
            <Card icon={BookOpen} title="Travel Purposes" count={purposes.length}>
              <Table rows={purposes} cols={[['key', 'Key'], ['label', 'Label'], ['category', 'Category']]} />
            </Card>
            <Card icon={FileText} title="Visa Types" count={visaTypes.length}>
              <Table rows={visaTypes.slice(0, 30)} cols={[['visa_type_key', 'Key'], ['purpose', 'Purpose'], ['channel', 'Channel']]} />
            </Card>
            <Card icon={FileText} title="Rule Versions" count={versions.length}>
              <Table rows={versions.slice(0, 30)} cols={[['requirements_version', 'Version'], ['destination', 'Dest'], ['status', 'Status']]} />
            </Card>
            <Card icon={Globe} title="Sources" count={sources.length}>
              <Table rows={sources} cols={[['name', 'Name'], ['source_type', 'Type'], ['status', 'Status']]} />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, count, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon size={15} /> {title}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Table({ rows, cols }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-slate-400">{cols.map(([_, l]) => <th key={l} className="pb-1.5 font-medium">{l}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {cols.map(([k]) => <td key={k} className="py-1.5 text-slate-700">{String(r[k] ?? '—').slice(0, 48)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}