import { Search, ArrowRight, ShieldCheck, BadgeCheck } from "lucide-react";
import { unsplash, GuaranteeBadge, LiveDot } from "./shared";

export default function HeroSection({ onFindVisa }) {
  return (
    <section className="relative min-h-[92vh] flex items-center overflow-hidden bg-[#14141F]">
      <img
        src={unsplash("photo-1488085061387-422e29b40080", 1800, 1000)}
        alt="Traveller at a city overlook at dusk"
        className="absolute inset-0 w-full h-full object-cover opacity-40"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#14141F]/90 via-[#14141F]/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#14141F]/80 via-transparent to-transparent" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-24 pb-16">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/20 text-white/70 text-xs mb-6"
            style={{ fontFamily: "var(--font-data)" }}>
            <LiveDot />
            Issuing visas to 100+ destinations
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl text-white leading-[1.08] mb-6"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 700 }}>
            Your visa,<br />
            on the day<br />
            <span className="text-[#FF6B4A]">we said.</span>
          </h1>

          <p className="text-white/70 text-lg mb-8 leading-relaxed max-w-lg">
            E-visas, sticker visas, and arrival cards across 100+ countries.
            Fee breakdown before you click in. On-time guaranteed or your money back.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Where are you going?"
                onFocus={onFindVisa}
                className="w-full bg-white rounded-xl pl-11 pr-4 py-3.5 text-foreground placeholder:text-muted-foreground border-0 outline-none focus:ring-2 focus:ring-[#FF6B4A] text-sm"
              />
            </div>
            <button
              onClick={onFindVisa}
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-[#FF6B4A] hover:bg-[#e85a38] text-white font-semibold rounded-xl transition-colors duration-150 shrink-0 text-sm"
            >
              Find visa <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <GuaranteeBadge compact />
            <div className="flex items-center gap-1.5 text-white/60 text-xs" style={{ fontFamily: "var(--font-data)" }}>
              <ShieldCheck className="w-3 h-3 text-[#2A2A72]" />
              Bank-grade encryption
            </div>
            <div className="flex items-center gap-1.5 text-white/60 text-xs" style={{ fontFamily: "var(--font-data)" }}>
              <BadgeCheck className="w-3 h-3 text-[#1E9E64]" />
              Govt-approved processor
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}