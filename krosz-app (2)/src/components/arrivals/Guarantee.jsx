import { ShieldCheck, Clock, Zap } from "lucide-react";

export default function Guarantee() {
  return (
    <section className="py-20 bg-[#14141F]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <ShieldCheck className="w-10 h-10 text-[#1E9E64] mb-6" />
            <h2 className="text-4xl lg:text-5xl text-white mb-6" style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}>
              The strongest guarantee<br />in visa services.
            </h2>
            <p className="text-white/60 text-base leading-relaxed mb-8">
              We show you a delivery date before you apply. If we miss it by even one hour,
              you pay nothing — zero service fee. If your application is rejected, every
              cent you paid comes back within 24 hours.
            </p>
            <div className="space-y-4">
              {[
                { icon: Clock, label: "On-time delivery", desc: "Guaranteed by the date shown on every card and checkout screen. SLA is contractually binding." },
                { icon: Zap, label: "Delayed? No service fee.", desc: "We waive our entire service fee automatically. No claim form, no waiting on support." },
                { icon: ShieldCheck, label: "Rejected? Full refund.", desc: "Government fee + service fee, returned within 24 hours of the rejection notice." },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex gap-4">
                  <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-[#FF6B4A]" />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{label}</p>
                    <p className="text-white/50 text-sm mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { value: "97.8%", label: "Approval rate", sub: "Rolling 30-day average" },
              { value: "4h 12m", label: "Avg processing", sub: "Across all destinations" },
              { value: "248k+", label: "Visas issued", sub: "Since January 2023" },
              { value: "24h", label: "Refund SLA", sub: "On any rejection" },
            ].map(({ value, label, sub }) => (
              <div key={label} className="bg-white/5 rounded-2xl p-6 border border-white/10">
                <div className="text-4xl font-bold text-white mb-1"
                  style={{ fontFamily: "var(--font-display)" }}>
                  {value}
                </div>
                <p className="text-white/80 text-sm font-medium">{label}</p>
                <p className="text-white/40 text-xs mt-1" style={{ fontFamily: "var(--font-data)" }}>{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}