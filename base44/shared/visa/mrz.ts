// Worldz Visa (Phase 5) — Deterministic TD3 (2-line) Machine Readable Zone parser.
// Pure code: no AI. Validates ICAO check digits, document number, DOB, expiry,
// nationality. Used by the passport extractor as the highest-confidence source;
// the pipeline never trusts OCR alone when an MRZ is present.

// ICAO 9303 check-digit weights cycle 7,3,1.
const WEIGHTS = [7, 3, 1];
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function charValue(ch: string): number {
  if (ch === "<") return 0;
  const v = CHARSET.indexOf(ch);
  return v < 0 ? 0 : v;
}
function checkDigit(input: string): number {
  const s = input.replace(/</g, "0");
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += charValue(s[i]) * WEIGHTS[i % 3];
  return sum % 10;
}

function normalizeMrz(raw: string): string[] {
  // Strip everything that isn't uppercase alnum or < — join two 44-char lines.
  const lines = raw
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/[^A-Z0-9<]/g, "").trim())
    .filter((l) => l.length > 0);
  // Prefer two lines, each >= 40 chars (some scans trim trailing <'s).
  const candidates = lines.filter((l) => l.length >= 40).slice(0, 2);
  if (candidates.length < 2) return [];
  // Pad each line to 44 chars with '<'.
  return candidates.map((l) => (l + "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<").slice(0, 44));
}

function parseDate6(yyMmDd: string, pivotYear = 2026): string | null {
  const yy = parseInt(yyMmDd.slice(0, 2), 10);
  const mm = parseInt(yyMmDd.slice(2, 4), 10);
  const dd = parseInt(yyMmDd.slice(4, 6), 10);
  if (Number.isNaN(yy) || Number.isNaN(mm) || Number.isNaN(dd)) return null;
  // ICAO 9303 leaves the century to the reader. Use a sliding window that allows
  // ~20 years into the future (passport expiry) and ~80 years into the past (DOB).
  // The previous `yy + 2000 > pivotYear ? 1900 : 2000` rule inverted future
  // expiries (yy=34 → 1934 instead of 2034), marking valid passports EXPIRED.
  const year = yy + (yy + 2000 > pivotYear + 20 ? 1900 : 2000);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const m = String(mm).padStart(2, "0");
  const d = String(dd).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export interface MrzParseResult {
  valid: boolean;
  line1: string;
  line2: string;
  document_number: string;
  document_number_check_valid: boolean;
  passport_number: string;
  nationality: string;
  surname: string;
  given_names: string;
  date_of_birth: string;
  dob_check_valid: boolean;
  sex: string;
  expiry_date: string;
  expiry_check_valid: boolean;
  issuing_country: string;
  personal_number: string;
  personal_number_check_valid: boolean;
  composite_check_valid: boolean;
  errors: string[];
}

export function parseMrz(raw: string): MrzParseResult | null {
  const lines = normalizeMrz(raw);
  if (lines.length < 2) return null;
  const [line1, line2] = lines;
  const errors: string[] = [];

  // Line 1: P<COUNTRY<<SURNAME<<GIVEN
  // [0]=P, [1:3]=issuing country, then names separated by <<
  const docType = line1[0];
  const issuingCountry = line1.slice(2, 5).replace(/</g, "");
  const namePart = line1.slice(5);
  const nameParts = namePart.split("<<").map((p) => p.replace(/</g, " ").trim()).filter(Boolean);
  const surname = (nameParts[0] || "").toUpperCase();
  const given_names = (nameParts.slice(1).join(" ") || "").toUpperCase();

  // Line 2: docnum(9) check(1) nat(3) dob(6) check(1) sex(1) expiry(6) check(1) personal(14) check(1) finalcheck(1)
  const document_number = line2.slice(0, 9).replace(/</g, "");
  const docCheck = line2[9] === "<" ? "0" : line2[9];
  const nationality = line2.slice(10, 13).replace(/</g, "");
  const dob = line2.slice(13, 19);
  const dobCheck = line2[19] === "<" ? "0" : line2[19];
  const sex = (line2[20] === "<" ? "" : line2[20]);
  const expiry = line2.slice(21, 27);
  const expiryCheck = line2[27] === "<" ? "0" : line2[27];
  const personal = line2.slice(28, 42);
  const personalCheck = line2[42] === "<" ? "0" : line2[42];
  const finalCheck = line2[43] === "<" ? "0" : line2[43];

  const document_number_check_valid = checkDigit(line2.slice(0, 9)) === parseInt(docCheck, 10);
  const dob_check_valid = checkDigit(dob) === parseInt(dobCheck, 10);
  const expiry_check_valid = checkDigit(expiry) === parseInt(expiryCheck, 10);
  const personal_number_check_valid = checkDigit(personal) === parseInt(personalCheck, 10);
  const composite_check_valid = checkDigit(
    line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43)
  ) === parseInt(finalCheck, 10);

  if (!document_number_check_valid) errors.push("document_number_check");
  if (!dob_check_valid) errors.push("dob_check");
  if (!expiry_check_valid) errors.push("expiry_check");
  if (!personal_number_check_valid) errors.push("personal_number_check");
  if (!composite_check_valid) errors.push("composite_check");
  if (docType !== "P") errors.push("not_passport_type");

  return {
    valid: errors.length === 0,
    line1, line2,
    document_number,
    document_number_check_valid,
    passport_number: document_number,
    nationality,
    surname,
    given_names,
    date_of_birth: parseDate6(dob) || "",
    dob_check_valid,
    sex: sex === "M" || sex === "F" ? sex : "",
    expiry_date: parseDate6(expiry) || "",
    expiry_check_valid,
    issuing_country: issuingCountry,
    personal_number: personal.replace(/</g, ""),
    personal_number_check_valid,
    composite_check_valid,
    errors,
  };
}

// Heuristic MRZ detector for free text: an MRZ looks like two long lines of
// alnum + '<'. Used to decide whether to trust MRZ over OCR field reads.
export function looksLikeMrz(text: string): boolean {
  if (!text) return false;
  const lines = text.toUpperCase().split(/\r?\n/).map((l) => l.replace(/[^A-Z0-9<]/g, "").trim()).filter((l) => l.length >= 40);
  return lines.length >= 2 && lines[0].startsWith("P<");
}