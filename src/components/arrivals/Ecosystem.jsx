import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const TOOLS = [
  {
    title: "Passport Photo Maker", desc: "AI-aligned, compliant, instant download.",
    preview: "📷", to: "/documents", badge: "Free · No signup",
  },
  {
    title: "Document Checklist", desc: "Country-specific, auto-updated list.",
    preview: "📋", to: "/destinations", badge: "Free · No signup",
  },
  {
    title: "Appointment Finder", desc: "Real-time embassy slot availability.",
    preview: "📅", to: "/ops/appointments", badge: "Free · No signup",
  },
];

export default function Ecosystem() {
  const navigate = useNavigate();
  return (
    <section className="bg-muted py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-10">
          <h2 className="text-4xl" style={{ fontFamily: "var(--font-display)" }}>
            Tools that earn your trust first
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Free to use, no account required. They exist to be genuinely useful.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TOOLS.map(({ title, desc, preview, to, badge }) => (
            <button key={title} onClick={() => navigate(to)}
              className="bg-card rounded-2xl border border-border p-6 text-left hover:border-foreground/30 hover:shadow-[0_8px_24px_rgba(20,20,31,0.07)] transition-all duration-200 group">
              <div className="h-28 bg-muted rounded-xl flex items-center justify-center text-5xl mb-5 group-hover:scale-105 transition-transform duration-200">
                {preview}
              </div>
              <span className="inline-block px-2 py-0.5 rounded-full bg-[#1E9E64]/10 text-[#1E9E64] text-[10px] font-semibold mb-3 tracking-wide"
                style={{ fontFamily: "var(--font-data)" }}>
                {badge}
              </span>
              <h3 className="font-semibold text-base mb-1.5" style={{ fontFamily: "var(--font-body)" }}>
                {title}
              </h3>
              <p className="text-muted-foreground text-sm">{desc}</p>
              <div className="mt-4 flex items-center gap-1 text-[#FF6B4A] text-sm font-medium">
                Try it free <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}