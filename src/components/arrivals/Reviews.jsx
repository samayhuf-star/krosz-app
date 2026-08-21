import { Star, BadgeCheck } from "lucide-react";

const REVIEWS = [
  {
    name: "Priya Mehta", city: "Mumbai", country: "India", rating: 5,
    date: "14 Jul 2025", text: "Visa approved in 47 minutes. I'd budgeted the full 3 days. The fee breakdown before I even clicked in meant zero surprises at checkout.",
    tripType: "Leisure · Dubai",
  },
  {
    name: "James Calloway", city: "London", country: "UK", rating: 5,
    date: "2 Jul 2025", text: "The OCR passport scan saved 10 minutes of typing and showed me exactly which fields it was confident about. Small thing, outsized difference.",
    tripType: "Business · Tokyo",
  },
  {
    name: "Amara Diallo", city: "Nairobi", country: "Kenya", rating: 4,
    date: "28 Jun 2025", text: "First time applying for a Schengen — I was anxious. The rejection-reasons list made me feel informed, not warned off. Got approved first try.",
    tripType: "Leisure · Paris",
  },
  {
    name: "Chen Wei", city: "Singapore", country: "Singapore", rating: 5,
    date: "19 Jun 2025", text: "Booked tickets the moment the guarantee date appeared on the card. Visa arrived exactly when they said. Reused the app for Thailand the next month.",
    tripType: "Leisure · Bali → Bangkok",
  },
];

const KEYWORDS = ["Fast processing", "No surprises", "Clear fees", "Great support", "Easy wizard", "On time"];

export default function Reviews() {
  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col lg:flex-row gap-12">
          <div className="lg:w-72 shrink-0">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-6xl font-bold" style={{ fontFamily: "var(--font-display)" }}>4.9</span>
              <div>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className="w-4 h-4 fill-[#FF6B4A] text-[#FF6B4A]" />
                  ))}
                </div>
                <p className="text-muted-foreground text-xs mt-1" style={{ fontFamily: "var(--font-data)" }}>2,841 verified reviews</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Every review is from a traveller who completed an application through arrivals.
            </p>
            <div className="flex flex-wrap gap-2">
              {KEYWORDS.map((k) => (
                <span key={k} className="px-2.5 py-1 rounded-full bg-muted text-foreground text-xs font-medium border border-border">
                  {k}
                </span>
              ))}
            </div>
          </div>

          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            {REVIEWS.map((r) => (
              <div key={r.name} className="bg-card rounded-2xl p-5 border border-border">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-sm">{r.name}</p>
                    <p className="text-muted-foreground text-xs mt-0.5" style={{ fontFamily: "var(--font-data)" }}>
                      {r.city}, {r.country}
                    </p>
                  </div>
                  <div className="flex gap-0.5">
                    {Array.from({ length: r.rating }).map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-[#FF6B4A] text-[#FF6B4A]" />
                    ))}
                  </div>
                </div>
                <p className="text-sm text-foreground leading-relaxed mb-3">"{r.text}"</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs px-2.5 py-1 bg-muted rounded-full text-muted-foreground">
                    {r.tripType}
                  </span>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-data)" }}>
                    <BadgeCheck className="w-3 h-3 text-[#1E9E64]" />
                    {r.date}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}