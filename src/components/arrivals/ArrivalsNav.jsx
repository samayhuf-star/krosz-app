import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Search, X, Menu } from "lucide-react";
import { GuaranteeBadge } from "./shared";

export default function ArrivalsNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onHome = pathname === "/" || pathname === "/arrivals";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const solid = scrolled || !onHome;

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200
      ${solid ? "bg-background/95 backdrop-blur-md border-b border-border" : "bg-transparent"}`}>
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/"
          className={`text-xl font-bold tracking-tight ${!solid ? "text-white" : "text-foreground"}`}
          style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}>
          arrivals<span className="text-[#FF6B4A]">·</span>
        </Link>

        <div className="hidden lg:flex items-center gap-1">
          <GuaranteeBadge compact onDark={!solid} />
          <div className="w-px h-4 bg-border mx-2" />
          <Link to="/"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${!solid ? "text-white" : onHome ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            Explore
          </Link>
          <Link to="/destinations"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${!solid ? "text-white" : "text-muted-foreground hover:text-foreground"}`}>
            Destinations
          </Link>
          <button onClick={() => navigate("/applications")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${!solid ? "text-white" : "text-muted-foreground hover:text-foreground"}`}>
            For Agents
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/destinations")}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-all">
            <Search className="w-3.5 h-3.5" />
            <span>Search destinations</span>
          </button>
          <button onClick={() => navigate("/applications")}
            className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground hover:bg-border transition-colors">
            P
          </button>
          <button onClick={() => setMenuOpen(!menuOpen)} className="lg:hidden w-8 h-8 flex items-center justify-center">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="lg:hidden bg-background border-b border-border px-4 pb-4 space-y-1">
          {[
            { label: "Explore", to: "/" },
            { label: "Destinations", to: "/destinations" },
            { label: "My Applications", to: "/applications" },
          ].map(({ label, to }) => (
            <Link key={label} to={to} onClick={() => setMenuOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors">
              {label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}