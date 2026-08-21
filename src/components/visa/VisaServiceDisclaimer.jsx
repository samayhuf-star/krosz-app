// §5/§33: the canonical, non-misleading visa service disclaimer. Reusable so
// the disclosure lives at decision points (destination page, pricing, checkout)
// rather than only inside legal pages. Never claims government affiliation or
// guaranteed approval.
export default function VisaServiceDisclaimer({ compact = false, className = '' }) {
  if (compact) {
    return (
      <p className={`text-xs leading-5 text-slate-500 ${className}`}>
        Krosz is a private, independent visa and travel assistance service — not a government website, agency, embassy, consulate or immigration authority, and not affiliated with or endorsed by them unless explicitly stated. Visa eligibility and approval are decided solely by the relevant government authorities. Using Krosz does not guarantee approval. Processing times shown are estimates unless identified as official government timelines.
      </p>
    );
  }
  return (
    <div className={`rounded-2xl border border-slate-200 bg-slate-50 p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-slate-900">Important — please read</h3>
      <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-600">
        <li>Krosz is a private, independent visa and travel assistance service. Krosz is not a government website, agency, embassy, consulate or immigration authority and is not affiliated with or endorsed by them unless explicitly stated.</li>
        <li>Visa eligibility and approval are determined by the relevant government authorities. Using Krosz does not guarantee visa approval.</li>
        <li>Processing times shown by Krosz are estimates unless specifically identified as official government timelines.</li>
        <li>You are responsible for the accuracy of the information and documents you provide.</li>
      </ul>
    </div>
  );
}