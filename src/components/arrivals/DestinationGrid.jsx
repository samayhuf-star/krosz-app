import { useState, useEffect } from "react";
import { Globe, Layers, ChevronDown } from "lucide-react";
import { listDestinations } from "@/lib/visaApi";
import FilterBar from "./FilterBar";
import DestinationCard from "./DestinationCard";

// Curated overlay for the destinations the design calls out — exact fees/timings.
// Catalog drives WHICH destinations show; this fills the gaps the catalog doesn't own.
const META = {
  AE: { photo: "photo-1512453979798-5ea266f8880c", type: "E-Visa", validity: "60 days", stay: "30 days", govFee: 35, serviceFee: 29, processingDays: 3, approvalRate: 98, entries: "Single", method: "Electronic", popular: true },
  JP: { photo: "photo-1528360983277-13d401cdc186", type: "Sticker Visa", validity: "90 days", stay: "30 days", govFee: 28, serviceFee: 39, processingDays: 5, approvalRate: 94, entries: "Single", method: "Embassy" },
  FR: { photo: "photo-1502602898657-3e91760cbb34", type: "Schengen Visa", validity: "90 days", stay: "90 days", govFee: 80, serviceFee: 59, processingDays: 10, approvalRate: 91, entries: "Multiple", method: "VFS" },
  TH: { photo: "photo-1552465011-b4e21bf6e79a", type: "E-Visa (eTV)", validity: "60 days", stay: "60 days", govFee: 0, serviceFee: 38, processingDays: 1, approvalRate: 99, entries: "Single", method: "Electronic", popular: true },
  MV: { photo: "photo-1514282401047-d79a71a590e8", type: "Arrival Visa", validity: "30 days", stay: "30 days", govFee: 0, serviceFee: 19, processingDays: 1, approvalRate: 99, entries: "Single", method: "Electronic" },
  TR: { photo: "photo-1524231757912-21f4fe3a7200", type: "E-Visa", validity: "180 days", stay: "90 days", govFee: 50, serviceFee: 25, processingDays: 1, approvalRate: 97, entries: "Multiple", method: "Electronic" },
  US: { photo: "photo-1501594907352-04cda38ebc29", type: "ESTA", validity: "2 years", stay: "90 days", govFee: 14, serviceFee: 29, processingDays: 1, approvalRate: 96, entries: "Multiple", method: "Electronic" },
  IT: { photo: "photo-1529260830199-42c24126f198", type: "Schengen Visa", validity: "90 days", stay: "90 days", govFee: 80, serviceFee: 59, processingDays: 12, approvalRate: 89, entries: "Multiple", method: "VFS" },
};

const FALLBACK = {
  photo: "photo-1488085061387-422e29b40080",
  govFee: 0, serviceFee: 29, processingDays: 3, approvalRate: 95,
  entries: "Single", method: "Electronic",
};

const channelType = (d) =>
  d.is_schengen ? "Schengen Visa"
  : ({ evisa: "E-Visa", vac: "VAC Visa", embassy: "Sticker Visa", onsite: "Onsite Visa" }[d.channel] || "Visa");

const toCard = (d) => {
  const m = META[d.code] || {};
  const dur = d.typical_duration_days || 30;
  return {
    id: d.code,
    country: d.name,
    flag: d.flag_emoji || "🌍",
    photo: m.photo || FALLBACK.photo,
    type: m.type || channelType(d),
    validity: m.validity || `${dur} days`,
    stay: m.stay || `${dur} days`,
    govFee: m.govFee ?? FALLBACK.govFee,
    serviceFee: m.serviceFee ?? FALLBACK.serviceFee,
    processingDays: m.processingDays ?? FALLBACK.processingDays,
    approvalRate: m.approvalRate ?? FALLBACK.approvalRate,
    entries: m.entries || FALLBACK.entries,
    method: m.method || FALLBACK.method,
    popular: m.popular || false,
    region: d.region,
    channel: d.channel,
  };
};

const matchesFilter = (c, f) => {
  if (f === "All") return true;
  if (f === "⚡ Instant (1 day)") return c.processingDays <= 1;
  if (f === "🗺 E-Visa") return c.channel === "evisa";
  if (f === "🏷 Sticker Visa") return c.channel !== "evisa";
  if (f === "🆓 Free / On Arrival") return c.govFee === 0;
  if (f.includes("Africa")) return c.region === "Africa";
  if (f.includes("Asia")) return c.region === "Asia";
  if (f.includes("Europe")) return c.region === "Europe";
  if (f.includes("Americas")) return c.region === "Americas";
  if (f.includes("Middle East")) return c.region === "Middle East";
  return true;
};

function SkeletonCard() {
  return (
    <div className="bg-card rounded-2xl overflow-hidden border border-border">
      <div className="h-44 bg-muted animate-pulse" />
      <div className="p-4 space-y-3">
        <div className="h-4 w-1/2 bg-muted rounded animate-pulse" />
        <div className="h-16 bg-muted rounded-xl animate-pulse" />
        <div className="h-4 w-2/3 bg-muted rounded animate-pulse" />
      </div>
    </div>
  );
}

export default function DestinationGrid({ onApply }) {
  const [activeFilter, setActiveFilter] = useState("All");
  const [showAll, setShowAll] = useState(false);
  const [dests, setDests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await listDestinations();
        setDests(res?.destinations || []);
      } catch {
        setDests([]);
      }
      setLoading(false);
    })();
  }, []);

  const cards = dests.map(toCard);
  const filtered = cards.filter((c) => matchesFilter(c, activeFilter));
  const visible = showAll ? filtered : filtered.slice(0, 8);

  return (
    <>
      <FilterBar activeFilter={activeFilter} setActiveFilter={setActiveFilter} />
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl text-foreground" style={{ fontFamily: "var(--font-display)" }}>
              Popular destinations
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              All fees shown upfront. Government and service fees, separated.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <button className="p-2 rounded-lg border border-border hover:bg-muted transition-colors">
              <Layers className="w-4 h-4 text-muted-foreground" />
            </button>
            <button className="p-2 rounded-lg bg-foreground text-background">
              <Globe className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
            : visible.map((dest) => (
                <DestinationCard key={dest.id} dest={dest} onApply={onApply} />
              ))}
        </div>

        {!loading && !showAll && filtered.length > 8 && (
          <div className="text-center mt-10">
            <button onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border text-sm font-medium hover:border-foreground/40 hover:bg-muted transition-all">
              Show all {filtered.length} destinations <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>
    </>
  );
}