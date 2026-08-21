import { Link } from "react-router-dom";
import { GuaranteeBadge } from "./shared";

const LINK_GROUPS = {
  Explore: ["All Destinations", "Popular Visas", "Last-Minute Visas", "Events Calendar"],
  Products: ["E-Visa Service", "Sticker Visas", "Arrival Cards", "For Travel Agents"],
  Trust: ["Our Guarantee", "Refund Policy", "Security Practices", "Engineering Blog"],
  Company: ["About", "Careers", "Press", "Contact"],
};

export default function ArrivalsFooter() {
  return (
    <footer className="bg-[#14141F] text-white/60 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          <div className="col-span-2 md:col-span-1">
            <Link to="/arrivals"
              className="text-xl font-bold text-white mb-3 block"
              style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}>
              arrivals<span className="text-[#FF6B4A]">·</span>
            </Link>
            <p className="text-sm leading-relaxed mb-4">
              Visa applications that feel like a concierge, not a form.
            </p>
            <GuaranteeBadge compact />
          </div>
          {Object.entries(LINK_GROUPS).map(([category, items]) => (
            <div key={category}>
              <p className="text-white text-xs font-semibold uppercase tracking-widest mb-4"
                style={{ fontFamily: "var(--font-data)" }}>
                {category}
              </p>
              <ul className="space-y-2.5">
                {items.map((item) => (
                  <li key={item}>
                    <button type="button"
                      className="text-sm hover:text-white transition-colors text-left">
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs" style={{ fontFamily: "var(--font-data)" }}>
            © 2025 Arrivals Technologies Ltd. · Regulated under IATA standards.
          </p>
          <div className="flex items-center gap-4 text-xs" style={{ fontFamily: "var(--font-data)" }}>
            <span>Privacy</span>
            <span>·</span>
            <span>Terms</span>
            <span>·</span>
            <span>Cookies</span>
            <span>·</span>
            <Link to="/applications" className="hover:text-white transition-colors">
              Trust Center
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}