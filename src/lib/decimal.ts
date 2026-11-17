// All money and ratio math goes through decimal.js — never plain JS numbers (SRS 9.2 coding rule).
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };
export type Dec = Decimal;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

export function D(v: Decimal.Value): Decimal {
  return new Decimal(v);
}

/** Parse a cell value as a decimal. Handles "1,23,456.7", "(1,234)", "-", "", "₹ 12". Returns null when blank. */
export function parseDecimal(raw: unknown): Decimal | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    // Spreadsheet numbers arrive as doubles; take the shortest exact decimal representation.
    return new Decimal(raw.toString());
  }
  let s = String(raw).trim();
  if (s === "" || s === "-" || s === "–" || s.toLowerCase() === "na" || s.toLowerCase() === "n/a") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[₹$,\s]/g, "").replace(/^Rs\.?/i, "");
  if (s.endsWith("%")) {
    const d = new Decimal(s.slice(0, -1));
    return (neg ? d.neg() : d).div(100);
  }
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const d = new Decimal(s);
  return neg ? d.neg() : d;
}

/** Safe division: null when either side is missing or the denominator is zero. */
export function div(a: Decimal | null | undefined, b: Decimal | null | undefined): Decimal | null {
  if (!a || !b || b.isZero()) return null;
  return a.div(b);
}

export function sum(...xs: (Decimal | null | undefined)[]): Decimal | null {
  if (xs.some((x) => !x)) return null;
  return xs.reduce<Decimal>((acc, x) => acc.plus(x as Decimal), ZERO);
}

/** Sum treating missing values as zero (for optional components). */
export function sumOpt(...xs: (Decimal | null | undefined)[]): Decimal {
  return xs.reduce<Decimal>((acc, x) => (x ? acc.plus(x) : acc), ZERO);
}

export function median(xs: Decimal[]): Decimal | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a.cmp(b));
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : s[m - 1].plus(s[m]).div(2);
}

export function minD(xs: Decimal[]): Decimal | null {
  return xs.length ? Decimal.min(...xs) : null;
}
export function maxD(xs: Decimal[]): Decimal | null {
  return xs.length ? Decimal.max(...xs) : null;
}

export function toStr(d: Decimal | null | undefined): string | null {
  return d ? d.toString() : null;
}
