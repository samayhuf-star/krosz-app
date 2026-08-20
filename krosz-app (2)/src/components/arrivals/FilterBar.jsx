import { Filter } from "lucide-react";
import { Pill } from "./shared";

const FILTERS = [
  "All",
  "⚡ Instant (1 day)",
  "🗺 E-Visa",
  "🏷 Sticker Visa",
  "🆓 Free / On Arrival",
  "🌍 Africa",
  "🌏 Asia Pacific",
  "🇪🇺 Europe",
  "🌎 Americas",
  "🌍 Middle East",
];

export default function FilterBar({ activeFilter, setActiveFilter }) {
  return (
    <div className="sticky top-16 z-40 bg-background/95 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 py-3 overflow-x-auto scrollbar-none">
          <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
          {FILTERS.map((f) => (
            <Pill key={f} active={activeFilter === f} onClick={() => setActiveFilter(f)}>
              {f}
            </Pill>
          ))}
        </div>
      </div>
    </div>
  );
}