// Worldz Visa (Phase 10) — Money + currency catalog (§25/§26).
//
// All money is integer minor units. Never floating-point arithmetic. The
// currency catalog is the single source of truth for supported currencies and
// their minor-unit exponents; the UI reads it instead of hard-coding a list.

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  minor: number; // number of decimal places (0 for JPY)
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  INR: { code: "INR", symbol: "₹", name: "Indian Rupee", minor: 2 },
  USD: { code: "USD", symbol: "$", name: "US Dollar", minor: 2 },
  EUR: { code: "EUR", symbol: "€", name: "Euro", minor: 2 },
  GBP: { code: "GBP", symbol: "£", name: " Pound Sterling", minor: 2 },
  JPY: { code: "JPY", symbol: "¥", name: "Japanese Yen", minor: 0 },
};

export const CURRENCY_CODES: string[] = Object.keys(CURRENCIES);

export function isSupportedCurrency(code: string): boolean {
  return !!CURRENCIES[String(code || "").toUpperCase()];
}

// Decimal-string → minor units. Throws on non-numeric input (never silently coerce).
export function toMinor(decimalStr: string, currency: string): number {
  const info = CURRENCIES[String(currency || "").toUpperCase()];
  if (!info) throw Object.assign(new Error(`Unsupported currency: ${currency}`), { code: "BAD_CURRENCY" });
  const s = String(decimalStr ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw Object.assign(new Error(`Invalid money value: ${decimalStr}`), { code: "BAD_MONEY" });
  const neg = s.startsWith("-");
  const [w, f = ""] = s.replace("-", "").split(".");
  const frac = (f + "0".repeat(info.minor)).slice(0, info.minor);
  const value = parseInt(w + frac, 10);
  return neg ? -value : value;
}

// Minor units → decimal string (no rounding errors; integer math only).
export function fromMinor(minor: number, currency: string): string {
  const info = CURRENCIES[String(currency || "").toUpperCase()];
  if (!info) throw Object.assign(new Error(`Unsupported currency: ${currency}`), { code: "BAD_CURRENCY" });
  const neg = minor < 0;
  const v = Math.abs(Math.trunc(minor));
  const s = String(v).padStart(info.minor + 1, "0");
  const intPart = s.slice(0, s.length - info.minor);
  const fracPart = info.minor ? "." + s.slice(s.length - info.minor) : "";
  return (neg ? "-" : "") + intPart + fracPart;
}

// Human display, e.g. 500000 INR → "₹5,000.00".
export function formatMoney(minor: number, currency: string): string {
  const info = CURRENCIES[String(currency || "").toUpperCase()];
  if (!info) return `${minor} ${currency}`;
  const dec = fromMinor(minor, currency);
  const [intPart, frac = ""] = dec.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${info.symbol}${grouped}${frac ? "." + frac : ""}`;
}

// Sum of an array of minor-unit amounts (integer add only).
export function sumMinor(values: number[]): number {
  return values.reduce((a, b) => a + Math.trunc(b || 0), 0);
}