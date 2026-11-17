// RAT-01..03: ratio definitions, each with a human-readable formula and its inputs for lineage.
import { D, Decimal, div, maxD, median, minD } from "./decimal";
import { Dataset } from "./dataset";
import { LINE_ITEM_BY_KEY } from "./coa";
import { fyEndDate, fyOf } from "./periods";

export const RATIO_FORMULA_VERSION = "ratios-v1";

/** A traced input: where a number in a formula came from. */
export interface TraceInput {
  name: string;
  value: string | null;
  /** lineage key: v:<companyId>:<period>:<lineItem> for stored values, d:<companyId>:<period>:<metric> for derived */
  ref: string;
}

export interface Computed {
  key: string;
  label: string;
  value: Decimal | null;
  formula: string;
  inputs: TraceInput[];
}

export type RatioFormat = "pct" | "x" | "days" | "inr";

export interface RatioDef {
  key: string;
  label: string;
  group: "Profitability" | "Growth" | "Leverage" | "Liquidity" | "Efficiency" | "Valuation";
  format: RatioFormat;
  compute: (m: MetricCtx) => Computed;
}

/** Derived (non-stored) amounts, each traceable. */
export class MetricCtx {
  constructor(public ds: Dataset, public companyId: string, public period: string) {}

  li(key: string, period = this.period): TraceInput & { d: Decimal | null } {
    const c = this.ds.cell(this.companyId, period, key);
    return {
      name: `${LINE_ITEM_BY_KEY[key]?.label ?? key}${period !== this.period ? ` (${period})` : ""}`,
      value: c ? c.value.toString() : null,
      ref: `v:${this.companyId}:${period}:${key}`,
      d: c?.value ?? null,
    };
  }

  prevPeriod(): string | null {
    const fy = fyOf(this.period);
    return fy ? `FY${fy - 1}` : null;
  }

  derived(key: string): Computed {
    const f = DERIVED[key];
    if (!f) throw new Error(`Unknown derived metric ${key}`);
    return f(this);
  }

  dIn(key: string): TraceInput & { d: Decimal | null } {
    const c = this.derived(key);
    return { name: c.label, value: c.value?.toString() ?? null, ref: `d:${this.companyId}:${this.period}:${key}`, d: c.value };
  }

  /** Price at fiscal-year end (last close on or before 31 March); latest price for the latest year. */
  price(latest: boolean): TraceInput & { d: Decimal | null; date?: string } {
    const fy = fyOf(this.period);
    const p = latest ? this.ds.latestPrice(this.companyId) : fy ? this.ds.priceOn(this.companyId, fyEndDate(fy)) : null;
    return {
      name: p ? `Share price (close ${p.date})` : "Share price",
      value: p?.value.toString() ?? null,
      ref: p ? `v:${this.companyId}:D${p.date}:price` : `v:${this.companyId}:?:price`,
      d: p?.value ?? null,
      date: p?.date,
    };
  }

  shares(): TraceInput & { d: Decimal | null } {
    const fy = fyOf(this.period);
    const s = this.ds.sharesOn(this.companyId, fy ? fyEndDate(fy) : "9999-12-31") ?? this.ds.sharesOn(this.companyId, "9999-12-31");
    const period = s ? (s.date.endsWith("-03-31") && this.ds.cell(this.companyId, `FY${s.date.slice(0, 4)}`, "shares_outstanding") ? `FY${s.date.slice(0, 4)}` : `D${s.date}`) : "?";
    return { name: "Shares outstanding", value: s?.value.toString() ?? null, ref: `v:${this.companyId}:${period}:shares_outstanding`, d: s?.value ?? null };
  }
}

function strip(x: TraceInput): TraceInput {
  return { name: x.name, value: x.value, ref: x.ref };
}

function mk(key: string, label: string, formula: string, value: Decimal | null, inputs: TraceInput[]): Computed {
  return { key, label, value, formula, inputs: inputs.map(strip) };
}

export const DERIVED: Record<string, (m: MetricCtx) => Computed> = {
  ebitda: (m) => {
    const r = m.li("revenue"), c = m.li("cogs"), e = m.li("employee_cost"), o = m.li("other_expenses");
    // When costs are not broken out, fall back to EBIT + D&A from PBT
    if (r.d && (c.d || e.d || o.d)) {
      const v = r.d.minus(c.d ?? 0).minus(e.d ?? 0).minus(o.d ?? 0);
      return mk("ebitda", "EBITDA", "Revenue − COGS − Employee cost − Other expenses", v, [r, c, e, o]);
    }
    const pbt = m.li("pbt"), fc = m.li("finance_cost"), oi = m.li("other_income"), dep = m.li("depreciation");
    const v = pbt.d && dep.d ? pbt.d.plus(fc.d ?? 0).minus(oi.d ?? 0).plus(dep.d) : null;
    return mk("ebitda", "EBITDA", "PBT + Finance costs − Other income + D&A", v, [pbt, fc, oi, dep]);
  },
  ebit: (m) => {
    const e = m.dIn("ebitda"), dep = m.li("depreciation");
    return mk("ebit", "EBIT", "EBITDA − D&A", e.d && dep.d ? e.d.minus(dep.d) : null, [e, dep]);
  },
  total_debt: (m) => {
    const l = m.li("borrowings_long"), s = m.li("borrowings_short");
    const v = l.d || s.d ? D(0).plus(l.d ?? 0).plus(s.d ?? 0) : D(0);
    return mk("total_debt", "Total debt", "Long-term borrowings + Short-term borrowings", v, [l, s]);
  },
  net_debt: (m) => {
    const d = m.dIn("total_debt"), c = m.li("cash");
    return mk("net_debt", "Net debt", "Total debt − Cash", d.d && c.d ? d.d.minus(c.d) : null, [d, c]);
  },
  current_assets: (m) => {
    const xs = ["cash", "receivables", "inventory", "other_current_assets"].map((k) => m.li(k));
    const v = xs.some((x) => x.d) ? xs.reduce((a, x) => a.plus(x.d ?? 0), D(0)) : null;
    return mk("current_assets", "Current assets", "Cash + Receivables + Inventory + Other current assets", v, xs);
  },
  current_liabilities: (m) => {
    const xs = ["payables", "other_current_liabilities", "borrowings_short"].map((k) => m.li(k));
    const v = xs.some((x) => x.d) ? xs.reduce((a, x) => a.plus(x.d ?? 0), D(0)) : null;
    return mk("current_liabilities", "Current liabilities", "Payables + Other current liabilities + Short-term borrowings", v, xs);
  },
  nwc: (m) => {
    const ca = ["receivables", "inventory", "other_current_assets"].map((k) => m.li(k));
    const cl = ["payables", "other_current_liabilities"].map((k) => m.li(k));
    const v = [...ca, ...cl].some((x) => x.d) ? ca.reduce((a, x) => a.plus(x.d ?? 0), D(0)).minus(cl.reduce((a, x) => a.plus(x.d ?? 0), D(0))) : null;
    return mk("nwc", "Net working capital", "Receivables + Inventory + Other current assets − Payables − Other current liabilities", v, [...ca, ...cl]);
  },
  eps: (m) => {
    const p = m.li("pat"), s = m.shares();
    return mk("eps", "EPS (₹)", "PAT ÷ Shares outstanding", div(p.d, s.d), [p, s]);
  },
  bvps: (m) => {
    const e = m.li("equity"), s = m.shares();
    return mk("bvps", "Book value per share (₹)", "Total equity ÷ Shares outstanding", div(e.d, s.d), [e, s]);
  },
};

const ratio = (key: string, label: string, group: RatioDef["group"], format: RatioFormat, compute: (m: MetricCtx) => { formula: string; value: Decimal | null; inputs: TraceInput[] }): RatioDef => ({
  key,
  label,
  group,
  format,
  compute: (m) => {
    const r = compute(m);
    return { key, label, ...r, inputs: r.inputs.map(strip) };
  },
});

export const RATIOS: RatioDef[] = [
  ratio("ebitda_margin", "EBITDA margin", "Profitability", "pct", (m) => {
    const e = m.dIn("ebitda"), r = m.li("revenue");
    return { formula: "EBITDA ÷ Revenue", value: div(e.d, r.d), inputs: [e, r] };
  }),
  ratio("net_margin", "Net profit margin", "Profitability", "pct", (m) => {
    const p = m.li("pat"), r = m.li("revenue");
    return { formula: "PAT ÷ Revenue", value: div(p.d, r.d), inputs: [p, r] };
  }),
  ratio("roe", "Return on equity", "Profitability", "pct", (m) => {
    const p = m.li("pat"), e = m.li("equity");
    return { formula: "PAT ÷ Total equity (closing)", value: div(p.d, e.d), inputs: [p, e] };
  }),
  ratio("roce", "Return on capital employed", "Profitability", "pct", (m) => {
    const ebit = m.dIn("ebit"), e = m.li("equity"), d = m.dIn("total_debt");
    const ce = e.d && d.d ? e.d.plus(d.d) : null;
    return { formula: "EBIT ÷ (Total equity + Total debt)", value: div(ebit.d, ce), inputs: [ebit, e, d] };
  }),
  ratio("revenue_growth", "Revenue growth (YoY)", "Growth", "pct", (m) => {
    const prev = m.prevPeriod();
    const r = m.li("revenue"), rp = prev ? m.li("revenue", prev) : { name: "Revenue (prior year)", value: null, ref: "", d: null };
    return { formula: "Revenue ÷ Revenue (prior year) − 1", value: r.d && rp.d && !rp.d.isZero() ? r.d.div(rp.d).minus(1) : null, inputs: [r, rp] };
  }),
  ratio("ebitda_growth", "EBITDA growth (YoY)", "Growth", "pct", (m) => {
    const prev = m.prevPeriod();
    const e = m.dIn("ebitda");
    const ep = prev ? new MetricCtx(m.ds, m.companyId, prev).dIn("ebitda") : null;
    const epIn = ep ? { ...ep, name: `EBITDA (${prev})`, ref: `d:${m.companyId}:${prev}:ebitda` } : { name: "EBITDA (prior year)", value: null, ref: "", d: null };
    return { formula: "EBITDA ÷ EBITDA (prior year) − 1", value: e.d && epIn.d && epIn.d.isPos() ? e.d.div(epIn.d).minus(1) : null, inputs: [e, epIn] };
  }),
  ratio("pat_growth", "PAT growth (YoY)", "Growth", "pct", (m) => {
    const prev = m.prevPeriod();
    const p = m.li("pat"), pp = prev ? m.li("pat", prev) : { name: "PAT (prior year)", value: null, ref: "", d: null };
    return { formula: "PAT ÷ PAT (prior year) − 1", value: p.d && pp.d && pp.d.isPos() ? p.d.div(pp.d).minus(1) : null, inputs: [p, pp] };
  }),
  ratio("debt_equity", "Debt to equity", "Leverage", "x", (m) => {
    const d = m.dIn("total_debt"), e = m.li("equity");
    return { formula: "Total debt ÷ Total equity", value: div(d.d, e.d), inputs: [d, e] };
  }),
  ratio("interest_coverage", "Interest coverage", "Leverage", "x", (m) => {
    const ebit = m.dIn("ebit"), f = m.li("finance_cost");
    return { formula: "EBIT ÷ Finance costs", value: div(ebit.d, f.d), inputs: [ebit, f] };
  }),
  ratio("current_ratio", "Current ratio", "Liquidity", "x", (m) => {
    const a = m.dIn("current_assets"), l = m.dIn("current_liabilities");
    return { formula: "Current assets ÷ Current liabilities", value: div(a.d, l.d), inputs: [a, l] };
  }),
  ratio("asset_turnover", "Asset turnover", "Efficiency", "x", (m) => {
    const r = m.li("revenue"), a = m.li("total_assets");
    return { formula: "Revenue ÷ Total assets", value: div(r.d, a.d), inputs: [r, a] };
  }),
  ratio("receivable_days", "Receivable days", "Efficiency", "days", (m) => {
    const rec = m.li("receivables"), r = m.li("revenue");
    const v = div(rec.d, r.d);
    return { formula: "Receivables ÷ Revenue × 365", value: v ? v.mul(365) : null, inputs: [rec, r] };
  }),
  ratio("inventory_days", "Inventory days", "Efficiency", "days", (m) => {
    const inv = m.li("inventory"), c = m.li("cogs");
    const v = div(inv.d, c.d);
    return { formula: "Inventory ÷ COGS × 365", value: v ? v.mul(365) : null, inputs: [inv, c] };
  }),
  ratio("pe", "P/E", "Valuation", "x", (m) => {
    const p = m.price(false), e = m.dIn("eps");
    return { formula: "Share price at year end ÷ EPS", value: e.d && e.d.isPos() ? div(p.d, e.d) : null, inputs: [p, e] };
  }),
  ratio("pb", "P/B", "Valuation", "x", (m) => {
    const p = m.price(false), b = m.dIn("bvps");
    return { formula: "Share price at year end ÷ Book value per share", value: b.d && b.d.isPos() ? div(p.d, b.d) : null, inputs: [p, b] };
  }),
  ratio("ev_ebitda", "EV/EBITDA", "Valuation", "x", (m) => {
    const p = m.price(false), s = m.shares(), nd = m.dIn("net_debt"), e = m.dIn("ebitda");
    const ev = p.d && s.d && nd.d ? p.d.mul(s.d).plus(nd.d) : null;
    return { formula: "(Share price × Shares outstanding + Net debt) ÷ EBITDA", value: e.d && e.d.isPos() ? div(ev, e.d) : null, inputs: [p, s, nd, e] };
  }),
];

export const RATIO_BY_KEY = Object.fromEntries(RATIOS.map((r) => [r.key, r]));

export function computeRatios(ds: Dataset, companyId: string, period: string): Record<string, Computed> {
  const m = new MetricCtx(ds, companyId, period);
  return Object.fromEntries(RATIOS.map((r) => [r.key, r.compute(m)]));
}

export interface PeerStat {
  company: Decimal | null;
  median: Decimal | null;
  min: Decimal | null;
  max: Decimal | null;
  n: number;
}

/** RAT-02: company vs. peer median, min and max for one period. */
export function peerComparison(ds: Dataset, companyId: string, peerIds: string[], period: string): Record<string, PeerStat> {
  const own = computeRatios(ds, companyId, period);
  const peers = peerIds.map((p) => computeRatios(ds, p, period));
  const out: Record<string, PeerStat> = {};
  for (const r of RATIOS) {
    const xs = peers.map((p) => p[r.key].value).filter((x): x is Decimal => !!x);
    out[r.key] = { company: own[r.key].value, median: median(xs), min: minD(xs), max: maxD(xs), n: xs.length };
  }
  return out;
}

export function formatRatio(v: Decimal | null | undefined, f: RatioFormat): string {
  if (!v) return "—";
  if (f === "pct") return v.mul(100).toFixed(1) + "%";
  if (f === "x") return v.toFixed(2) + "x";
  if (f === "days") return v.toFixed(0) + " d";
  return v.toFixed(2);
}
