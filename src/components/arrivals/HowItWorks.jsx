export default function HowItWorks() {
  const steps = [
    { n: "01", title: "Find & confirm fees", desc: "See the exact government fee and our service fee on every card — before you click. No surprise totals at checkout." },
    { n: "02", title: "Apply in minutes", desc: "Upload your passport for instant OCR autofill. Field-level confidence scores so you can trust — and verify — every entry." },
    { n: "03", title: "Receive, on time", desc: "We guarantee delivery by the date we show. If we're late, the service fee is waived. If rejected, full refund — automatic, 24-hour." },
  ];

  return (
    <section className="bg-muted py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-lg mb-12">
          <h2 className="text-4xl" style={{ fontFamily: "var(--font-display)" }}>
            How arrivals works
          </h2>
          <p className="text-muted-foreground mt-3">Three steps. One guarantee.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map(({ n, title, desc }) => (
            <div key={n} className="relative">
              <div className="text-6xl font-bold text-border/60 mb-4 leading-none"
                style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}>
                {n}
              </div>
              <h3 className="text-xl mb-3" style={{ fontFamily: "var(--font-display)" }}>
                {title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}