// VAL-02: unit and currency normalization. Values are stored in base units (INR, shares, INR/share).
import { D, Decimal } from "./decimal";

export const UNIT_FACTORS: Record<string, string> = {
  units: "1",
  rupees: "1",
  thousand: "1000",
  lakh: "100000",
  million: "1000000",
  crore: "10000000",
  billion: "1000000000",
};

export function normUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = u.toLowerCase().replace(/[^a-z]/g, "");
  if (["cr", "crore", "crores", "rscr", "inrcr", "rscrore", "inrcrore"].includes(s)) return "crore";
  if (["lakh", "lakhs", "lac", "lacs", "rslakh", "inrlakh"].includes(s)) return "lakh";
  if (["mn", "million", "millions", "m", "inrmn", "inrmillion", "usdmn", "usdmillion"].includes(s)) return "million";
  if (["bn", "billion", "billions", "b"].includes(s)) return "billion";
  if (["k", "thousand", "thousands", "000"].includes(s)) return "thousand";
  if (["", "units", "unit", "rs", "inr", "rupees", "abs", "absolute", "number", "nos"].includes(s)) return "units";
  return null;
}

/** Convert a raw value to base INR. fx = INR per 1 unit of the source currency (1 for INR). */
export function toBase(raw: Decimal, unit: string, fx: Decimal.Value = 1): Decimal {
  const f = UNIT_FACTORS[unit];
  if (!f) throw new Error(`Unknown unit: ${unit}`);
  return raw.mul(f).mul(D(fx));
}

export type DisplayUnit = "crore" | "lakh" | "million";

export function fromBase(v: Decimal, unit: DisplayUnit): Decimal {
  return v.div(UNIT_FACTORS[unit]);
}

/** Indian digit grouping: 12,34,567.89 */
export function formatIndian(v: Decimal, dp = 2): string {
  const neg = v.isNeg();
  const s = v.abs().toFixed(dp);
  const [int, frac] = s.split(".");
  let head = int;
  let out = "";
  if (head.length > 3) {
    out = "," + head.slice(-3);
    head = head.slice(0, -3);
    while (head.length > 2) {
      out = "," + head.slice(-2) + out;
      head = head.slice(0, -2);
    }
    out = head + out;
  } else out = head;
  return (neg ? "-" : "") + out + (frac ? "." + frac : "");
}

export function formatMoney(v: Decimal | null | undefined, unit: DisplayUnit = "crore", dp = 2): string {
  if (!v) return "—";
  return formatIndian(fromBase(v, unit), dp);
}

export function formatPct(v: Decimal | null | undefined, dp = 1): string {
  if (!v) return "—";
  return v.mul(100).toFixed(dp) + "%";
}

export function formatX(v: Decimal | null | undefined, dp = 1): string {
  if (!v) return "—";
  return v.toFixed(dp) + "x";
}

export const UNIT_LABEL: Record<DisplayUnit, string> = { crore: "₹ crore", lakh: "₹ lakh", million: "₹ million" };
