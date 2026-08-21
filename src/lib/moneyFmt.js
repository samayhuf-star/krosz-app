// Worldz Visa (Phase 18) — money formatting for the frontend. Integer minor
// units → display string. Mirrors the server currency catalog's 2-decimal
// assumption for INR/USD/EUR/GBP; JPY (0 decimals) is handled by Intl.
export function formatMoney(minor, currency = 'INR') {
  const code = String(currency || 'INR').toUpperCase();
  const frac = code === 'JPY' ? 0 : 2;
  const v = Number(minor || 0) / Math.pow(10, frac);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, minimumFractionDigits: frac, maximumFractionDigits: frac }).format(v); }
  catch { return `${minor} ${code}`; }
}