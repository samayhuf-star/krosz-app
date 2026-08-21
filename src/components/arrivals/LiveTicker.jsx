import { useState, useEffect } from "react";
import { Clock, TrendingUp, ShieldCheck } from "lucide-react";
import { LiveDot } from "./shared";

export default function LiveTicker() {
  const [count, setCount] = useState(1204);
  const [avgTime] = useState("4h 12m");

  useEffect(() => {
    const t = setInterval(() => {
      setCount((c) => c + Math.floor(Math.random() * 3));
    }, 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="bg-[#14141F] text-white/80 text-xs py-2.5 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-6 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-2 shrink-0">
          <LiveDot />
          <span style={{ fontFamily: "var(--font-data)" }}>
            <span className="text-white font-medium">{count.toLocaleString()}</span> visas issued today
          </span>
        </div>
        <span className="text-white/30">·</span>
        <div className="flex items-center gap-2 shrink-0" style={{ fontFamily: "var(--font-data)" }}>
          <Clock className="w-3 h-3 text-[#FF6B4A]" />
          avg processing <span className="text-white font-medium ml-1">{avgTime}</span>
        </div>
        <span className="text-white/30">·</span>
        <div className="flex items-center gap-2 shrink-0" style={{ fontFamily: "var(--font-data)" }}>
          <TrendingUp className="w-3 h-3 text-[#1E9E64]" />
          approval rate <span className="text-white font-medium ml-1">97.8%</span> this month
        </div>
        <span className="text-white/30">·</span>
        <div className="flex items-center gap-2 shrink-0 text-white/50">
          <ShieldCheck className="w-3 h-3" />
          <span>Delayed = no fee · Rejected = full refund</span>
        </div>
      </div>
    </div>
  );
}