// VAL-03 / VAL-04: automated checks that raise flags for analyst review.
import { D, Decimal, sumOpt } from "./decimal";
import { Dataset } from "./dataset";
import { LINE_ITEMS, LINE_ITEM_BY_KEY } from "./coa";
import { annualPeriods, fyOf, isQuarter } from "./periods";

export interface Thresholds {
  /** relative tolerance for balance-sheet and cash-flow ties */
  tieTolerance: string;
  /** absolute tolerance in INR below which ties are ignored (rounding in source files) */
  tieAbsTolerance: string;
  /** YoY change beyond which a value is an outlier */
  outlierYoY: string;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  tieTolerance: "0.001", // 0.1%
  tieAbsTolerance: "10000000", // ₹1 crore
  outlierYoY: "0.5", // ±50%
};

export interface AffectedValue {
  companyId: string;
  period: string;
  lineItem: string;
  value: string | null;
  valueId: string | null;
}

export interface FlagDraft {
  signature: string;
  companyId: string;
  period: string | null;
  type: "BS_IMBALANCE" | "CF_TIE" | "MISSING_PERIOD" | "MISSING_ITEM" | "RESTATEMENT" | "SIGN" | "OUTLIER";
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
  affected: AffectedValue[];
}

interface Ctx {
  ds: Dataset;
  companyId: string;
  isSubject: boolean;
  periods: string[];
  t: Thresholds;
  companyName: string;
}

function aff(ds: Dataset, companyId: string, period: string, lineItem: string): AffectedValue {
  const c = ds.cell(companyId, period, lineItem);
  return { companyId, period, lineItem, value: c ? c.value.toString() : null, valueId: c?.id ?? null };
}

function tieFails(a: Decimal, b: Decimal, t: Thresholds): boolean {
  const diff = a.minus(b).abs();
  if (diff.lte(t.tieAbsTolerance)) return false;
  const base = Decimal.max(a.abs(), b.abs());
  if (base.isZero()) return false;
  return diff.div(base).gt(t.tieTolerance);
}

function fmtCr(v: Decimal): string {
  return v.div(1e7).toFixed(2) + " cr";
}

export function validateCompany(ctx: Ctx): FlagDraft[] {
  const { ds, companyId, periods, t, companyName, isSubject } = ctx;
  const out: FlagDraft[] = [];

  for (const p of periods) {
    const any = LINE_ITEMS.some((li) => li.statement !== "MKT" && ds.get(companyId, p, li.key));
    if (!any) {
      out.push({
        signature: `MISSING_PERIOD|${companyId}|${p}`,
        companyId,
        period: p,
        type: "MISSING_PERIOD",
        severity: isSubject ? "HIGH" : "MEDIUM",
        message: `${companyName}: no financial data uploaded for ${p}.`,
        affected: [],
      });
      continue;
    }
    // core items missing
    // quarterly uploads carry only the income statement
    const missing = LINE_ITEMS.filter((li) => li.core && (!isQuarter(p) || li.statement === "IS") && !ds.get(companyId, p, li.key));
    if (missing.length) {
      out.push({
        signature: `MISSING_ITEM|${companyId}|${p}|${missing.map((m) => m.key).join(",")}`,
        companyId,
        period: p,
        type: "MISSING_ITEM",
        severity: isSubject ? "HIGH" : "MEDIUM",
        message: `${companyName} ${p}: missing ${missing.map((m) => m.label).join(", ")}.`,
        affected: missing.map((m) => aff(ds, companyId, p, m.key)),
      });
    }

    // VAL-03 balance sheet balances
    const ta = ds.get(companyId, p, "total_assets");
    const tel = ds.get(companyId, p, "total_equity_liabilities");
    if (ta && tel && tieFails(ta, tel, t)) {
      out.push({
        signature: `BS_IMBALANCE|${companyId}|${p}`,
        companyId,
        period: p,
        type: "BS_IMBALANCE",
        severity: "HIGH",
        message: `${companyName} ${p}: total assets ${fmtCr(ta)} ≠ total equity and liabilities ${fmtCr(tel)} (difference ${fmtCr(ta.minus(tel))}).`,
        affected: [aff(ds, companyId, p, "total_assets"), aff(ds, companyId, p, "total_equity_liabilities")],
      });
    }
    // asset components sum to total
    const assetKeys = ["cash", "receivables", "inventory", "other_current_assets", "net_fixed_assets", "investments", "other_non_current_assets"];
    const haveComponents = assetKeys.filter((k) => ds.get(companyId, p, k));
    if (ta && haveComponents.length >= 4) {
      const s = sumOpt(...assetKeys.map((k) => ds.get(companyId, p, k)));
      if (tieFails(s, ta, t)) {
        out.push({
          signature: `BS_IMBALANCE|${companyId}|${p}|assets`,
          companyId,
          period: p,
          type: "BS_IMBALANCE",
          severity: "MEDIUM",
          message: `${companyName} ${p}: asset line items add up to ${fmtCr(s)} but total assets is ${fmtCr(ta)}. A line item may be unmapped.`,
          affected: [...assetKeys.map((k) => aff(ds, companyId, p, k)), aff(ds, companyId, p, "total_assets")],
        });
      }
    }
    const liabKeys = ["equity", "minority_interest", "borrowings_long", "borrowings_short", "payables", "other_current_liabilities", "other_non_current_liabilities"];
    if (tel && liabKeys.filter((k) => ds.get(companyId, p, k)).length >= 4) {
      const s = sumOpt(...liabKeys.map((k) => ds.get(companyId, p, k)));
      if (tieFails(s, tel, t)) {
        out.push({
          signature: `BS_IMBALANCE|${companyId}|${p}|liabilities`,
          companyId,
          period: p,
          type: "BS_IMBALANCE",
          severity: "MEDIUM",
          message: `${companyName} ${p}: equity and liability line items add up to ${fmtCr(s)} but the total is ${fmtCr(tel)}. A line item may be unmapped.`,
          affected: [...liabKeys.map((k) => aff(ds, companyId, p, k)), aff(ds, companyId, p, "total_equity_liabilities")],
        });
      }
    }

    // VAL-03 cash flow ties to the change in cash
    const cfo = ds.get(companyId, p, "cfo");
    const cfi = ds.get(companyId, p, "cfi");
    const cff = ds.get(companyId, p, "cff");
    const net = ds.get(companyId, p, "net_change_cash");
    const open = ds.get(companyId, p, "opening_cash");
    const close = ds.get(companyId, p, "closing_cash");
    if (cfo && cfi && cff) {
      const computed = cfo.plus(cfi).plus(cff);
      let target: Decimal | null = net;
      let targetLabel = "net change in cash";
      const items = ["cfo", "cfi", "cff", "net_change_cash"];
      if (!target && open && close) {
        target = close.minus(open);
        targetLabel = "closing minus opening cash";
        items.splice(3, 1, "opening_cash", "closing_cash");
      }
      if (!target) {
        // fall back to balance sheet cash movement
        const fy = fyOf(p);
        const prevCash = fy ? ds.get(companyId, `FY${fy - 1}`, "cash") : null;
        const cash = ds.get(companyId, p, "cash");
        if (prevCash && cash) {
          target = cash.minus(prevCash);
          targetLabel = "change in balance-sheet cash";
          items.splice(3, 1, "cash");
        }
      }
      if (target && tieFails(computed, target, t)) {
        out.push({
          signature: `CF_TIE|${companyId}|${p}`,
          companyId,
          period: p,
          type: "CF_TIE",
          severity: "HIGH",
          message: `${companyName} ${p}: CFO + CFI + CFF = ${fmtCr(computed)} but ${targetLabel} = ${fmtCr(target)}.`,
          affected: items.map((k) => aff(ds, companyId, p, k)),
        });
      }
    }
    if (net && open && close && tieFails(close.minus(open), net, t)) {
      out.push({
        signature: `CF_TIE|${companyId}|${p}|cash`,
        companyId,
        period: p,
        type: "CF_TIE",
        severity: "HIGH",
        message: `${companyName} ${p}: closing cash − opening cash = ${fmtCr(close.minus(open))} but net change in cash = ${fmtCr(net)}.`,
        affected: ["opening_cash", "closing_cash", "net_change_cash"].map((k) => aff(ds, companyId, p, k)),
      });
    }

    // sign errors
    for (const li of LINE_ITEMS) {
      const v = ds.get(companyId, p, li.key);
      if (!v) continue;
      const bad = (li.sign === "pos" && v.isNeg() && !v.isZero()) || (li.sign === "neg" && v.isPos() && !v.isZero());
      if (bad) {
        out.push({
          signature: `SIGN|${companyId}|${p}|${li.key}`,
          companyId,
          period: p,
          type: "SIGN",
          severity: "MEDIUM",
          message: `${companyName} ${p}: ${li.label} is ${v.isNeg() ? "negative" : "positive"}; expected ${li.sign === "pos" ? "positive" : "negative (outflow)"}.`,
          affected: [aff(ds, companyId, p, li.key)],
        });
      }
    }
  }

  // outliers: YoY change on key items, annual periods only
  const annual = periods.filter((p) => fyOf(p) !== null);
  for (const key of ["revenue", "pat", "total_assets", "depreciation", "equity"]) {
    for (let i = 1; i < annual.length; i++) {
      const prev = ds.get(companyId, annual[i - 1], key);
      const cur = ds.get(companyId, annual[i], key);
      if (!prev || !cur || prev.isZero()) continue;
      const ch = cur.minus(prev).div(prev.abs());
      if (ch.abs().gt(t.outlierYoY)) {
        out.push({
          signature: `OUTLIER|${companyId}|${annual[i]}|${key}`,
          companyId,
          period: annual[i],
          type: "OUTLIER",
          severity: "LOW",
          message: `${companyName} ${annual[i]}: ${LINE_ITEM_BY_KEY[key].label} changed ${ch.mul(100).toFixed(1)}% vs ${annual[i - 1]} (threshold ±${D(t.outlierYoY).mul(100).toFixed(0)}%).`,
          affected: [aff(ds, companyId, annual[i - 1], key), aff(ds, companyId, annual[i], key)],
        });
      }
    }
  }

  // restatements: the same number uploaded with different values from different sources
  const fmtV = (li: string, v: string) => (LINE_ITEM_BY_KEY[li]?.kind && LINE_ITEM_BY_KEY[li].kind !== "money" ? D(v).toFixed(2) : fmtCr(D(v)));
  const conflicts = ds.conflicts().filter((c) => c.key.startsWith(companyId + "|"));
  const market = conflicts.filter((c) => LINE_ITEM_BY_KEY[c.key.split("|")[2]]?.statement === "MKT");
  for (const c of conflicts.filter((x) => !market.includes(x))) {
    const [cid, p, li] = c.key.split("|");
    out.push({
      signature: `RESTATEMENT|${c.key}`,
      companyId,
      period: p,
      type: "RESTATEMENT",
      severity: "MEDIUM",
      message: `${companyName} ${p}: ${LINE_ITEM_BY_KEY[li]?.label ?? li} differs between sources (${c.rows.map((r) => fmtV(li, r.value)).join(" vs ")}). The latest upload is used unless you correct it.`,
      affected: c.rows.map((r) => ({ companyId: cid, period: p, lineItem: li, value: r.value, valueId: r.id })),
    });
  }
  if (market.length) {
    const dates = market.map((c) => c.key.split("|")[1].replace(/^D/, "")).sort();
    out.push({
      signature: `RESTATEMENT|${companyId}|market|${dates[0]}|${dates[dates.length - 1]}|${market.length}`,
      companyId,
      period: null,
      type: "RESTATEMENT",
      severity: "MEDIUM",
      message: `${companyName}: prices or share counts differ between sources on ${market.length} date(s) from ${dates[0]} to ${dates[dates.length - 1]}. The latest upload is used unless you correct it.`,
      affected: market.slice(0, 12).flatMap((c) => {
        const [cid, p, li] = c.key.split("|");
        return c.rows.map((r) => ({ companyId: cid, period: p, lineItem: li, value: r.value, valueId: r.id }));
      }),
    });
  }

  return out;
}

export function validateAnalysis(args: {
  ds: Dataset;
  subjectId: string;
  peerIds: string[];
  fyFrom: number;
  fyTo: number;
  quarters: string[];
  names: Record<string, string>;
  thresholds?: Thresholds;
}): FlagDraft[] {
  const t = args.thresholds ?? DEFAULT_THRESHOLDS;
  const annual = annualPeriods(args.fyFrom, args.fyTo);
  const out: FlagDraft[] = [];
  for (const cid of [args.subjectId, ...args.peerIds]) {
    const isSubject = cid === args.subjectId;
    // quarters are only required for the subject company
    const periods = isSubject ? [...annual, ...args.quarters] : annual;
    const flags = validateCompany({ ds: args.ds, companyId: cid, isSubject, periods, t, companyName: args.names[cid] ?? cid });
    out.push(...flags);
  }
  return out;
}
