import { useState } from "react";
import { Check, MessageCircle, Clock } from "lucide-react";
import { unsplash, formatDate, GuaranteeBadge, MetaLabel } from "./shared";

export default function DestinationCard({ dest, onApply }) {
  const [hovered, setHovered] = useState(false);
  const totalFee = dest.govFee + dest.serviceFee;

  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative bg-card rounded-2xl overflow-hidden border border-border
        transition-all duration-200 hover:shadow-[0_8px_32px_rgba(20,20,31,0.10)] hover:-translate-y-0.5 cursor-pointer"
      onClick={onApply}
    >
      <div className="relative h-44 bg-muted overflow-hidden">
        <img
          src={unsplash(dest.photo, 600, 400)}
          alt={dest.country}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute top-3 left-3 text-xl leading-none bg-white/90 backdrop-blur-sm rounded-full w-8 h-8 flex items-center justify-center shadow-sm">
          {dest.flag}
        </span>
        {dest.popular && (
          <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-[#FF6B4A] text-white text-[10px] font-semibold tracking-wide uppercase"
            style={{ fontFamily: "var(--font-data)" }}>
            Popular
          </span>
        )}
        <div className={`absolute inset-0 bg-[#14141F]/80 backdrop-blur-[2px] flex flex-col justify-center px-4 transition-opacity duration-200 ${hovered ? "opacity-100" : "opacity-0"}`}>
          <p className="text-white text-xs font-semibold mb-2 uppercase tracking-wider" style={{ fontFamily: "var(--font-data)" }}>
            Checklist
          </p>
          {["Valid passport (6+ months)", "Recent bank statement", "Passport-size photograph", "Return flight booking"].map((doc) => (
            <div key={doc} className="flex items-center gap-2 py-0.5">
              <Check className="w-3 h-3 text-[#1E9E64] shrink-0" />
              <span className="text-white/80 text-xs">{doc}</span>
            </div>
          ))}
          <div className="mt-3 flex items-center gap-1.5 text-[#FF6B4A] text-xs font-medium">
            <MessageCircle className="w-3 h-3" /> Need help? Chat now
          </div>
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-semibold text-[15px] text-foreground leading-tight mb-1"
          style={{ fontFamily: "var(--font-body)" }}>
          {dest.country}
        </h3>

        <div className="flex items-center gap-3 mb-3">
          {[
            { label: "TYPE", value: dest.type },
            { label: "STAY", value: dest.stay },
            { label: "ENTRY", value: dest.entries },
          ].map(({ label, value }) => (
            <div key={label}>
              <MetaLabel>{label}</MetaLabel>
              <p className="text-xs font-medium text-foreground mt-0.5" style={{ fontFamily: "var(--font-data)" }}>{value}</p>
            </div>
          ))}
        </div>

        <div className="bg-muted rounded-xl p-3 mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <MetaLabel>Fees</MetaLabel>
            <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-data)" }}>No hidden charges</span>
          </div>
          <div className="flex items-center gap-3 text-xs" style={{ fontFamily: "var(--font-data)" }}>
            <span>
              <span className="text-muted-foreground">Gov </span>
              <span className="font-semibold">{dest.govFee === 0 ? "Free" : `$${dest.govFee}`}</span>
            </span>
            <span className="text-border">+</span>
            <span>
              <span className="text-muted-foreground">Service </span>
              <span className="font-semibold">${dest.serviceFee}</span>
            </span>
            <span className="text-border">=</span>
            <span className="text-[#FF6B4A] font-bold">Total ${totalFee}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Service fee charged only after approval
          </p>
        </div>

        <div className="flex items-center justify-between">
          <GuaranteeBadge compact />
          <div className="flex items-center gap-1 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-data)" }}>
            <Clock className="w-3 h-3" />
            {dest.processingDays === 1 ? "Same day" : `${dest.processingDays} days`}
          </div>
        </div>

        <p className="mt-2 text-[11px] text-[#1E9E64] font-medium" style={{ fontFamily: "var(--font-data)" }}>
          ✓ Guaranteed by {formatDate(dest.processingDays + 1)} if you apply now
        </p>
      </div>
    </article>
  );
}