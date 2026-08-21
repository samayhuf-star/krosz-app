import { ShieldCheck } from "lucide-react";

export const unsplash = (id, w = 800, h = 500) =>
  `https://images.unsplash.com/${id}?w=${w}&h=${h}&fit=crop&auto=format&q=80`;

export const formatDate = (daysFromNow) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function Pill({ children, active, onClick, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 border whitespace-nowrap
        ${active
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
        } ${className}`}
    >
      {children}
    </button>
  );
}

export function GuaranteeBadge({ compact = false, onDark = false }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium border
      ${onDark ? "bg-white/10 text-white border-white/25" : "bg-[#1E9E64]/10 text-[#1E9E64] border-[#1E9E64]/20"}
      ${compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"}`}>
      <ShieldCheck className={compact ? "w-3 h-3" : "w-4 h-4"} strokeWidth={2.5} />
      {compact ? "Guaranteed" : "On-time guaranteed · Delayed = no fee · Rejected = full refund"}
    </span>
  );
}

export function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF6B4A] opacity-60" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FF6B4A]" />
    </span>
  );
}

export function MetaLabel({ children }) {
  return (
    <span style={{ fontFamily: "var(--font-data)" }}
      className="text-[10px] font-medium tracking-[0.12em] uppercase text-muted-foreground">
      {children}
    </span>
  );
}