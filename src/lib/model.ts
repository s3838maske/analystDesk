// MOD-01..05: assumptions, 3-statement forecast, DCF, sensitivity and trading comps.
// runModel() is a pure function of ModelInputs, so a saved run is reproducible (NFR-02).
import { D, Decimal, median, minD, maxD } from "./decimal";
import { Dataset } from "./dataset";
import { MetricCtx, computeRatios } from "./ratios";
import { fyOf } from "./periods";

export const MODEL_FORMULA_VERSION = "model-v1";
export const FORECAST_YEARS = 5;

export interface AssumptionDef {
  key: string;
  label: string;
  format: "pct" | "inr";
  key_: boolean; // key assumption: must be confirmed before the model runs
  help: string;
}

export const ASSUMPTIONS: AssumptionDef[] = [
  { key: "revenue_growth", label: "Revenue growth (per year)", format: "pct", key_: true, help: "Applied to each forecast year" },
  { key: "ebitda_margin", label: "EBITDA margin", format: "pct", key_: true, help: "EBITDA ÷ Revenue" },
  { key: "dep_pct_revenue", label: "D&A as % of revenue", format: "pct", key_: false, help: "Depreciation and amortisation ÷ Revenue" },
  { key: "tax_rate", label: "Tax rate", format: "pct", key_: false, help: "Tax ÷ PBT" },
  { key: "capex_pct_revenue", label: "Capex as % of revenue", format: "pct", key_: true, help: "Capital expenditure ÷ Revenue" },
  { key: "nwc_pct_revenue", label: "Net working capital as % of revenue", format: "pct", key_: true, help: "NWC ÷ Revenue at year end" },
  { key: "interest_rate", label: "Interest rate on debt", format: "pct", key_: false, help: "Finance costs ÷ Total debt" },
  { key: "payout_ratio", label: "Dividend payout ratio", format: "pct", key_: false, help: "Dividends ÷ PAT" },
  { key: "wacc", label: "WACC", format: "pct", key_: true, help: "Discount rate for free cash flow to the firm" },
  { key: "terminal_growth", label: "Terminal growth", format: "pct", key_: true, help: "Perpetual growth after year 5; must be below WACC" },
];

export interface AssumptionDefault {
  key: string;
  value: string;
  basis: string;
}

function avg(xs: Decimal[]): Decimal | null {
  return xs.length ? xs.reduce((a, x) => a.plus(x), D(0)).div(xs.length) : null;
}

/** MOD-01: defaults from the last 3 fiscal years. */
export function defaultAssumptions(ds: Dataset, companyId: string, fyTo: number): AssumptionDefault[] {
  const years = [fyTo - 2, fyTo - 1, fyTo].map((y) => `FY${y}`);
  const yr = `${years[0]}–${years[2]}`;
  const series = (fn: (m: MetricCtx) => Decimal | null) =>
    years.map((p) => fn(new MetricCtx(ds, companyId, p))).filter((x): x is Decimal => !!x);
  const ratios = years.map((p) => computeRatios(ds, companyId, p));

  const out: AssumptionDefault[] = [];
  const push = (key: string, v: Decimal | null, basis: string, fallback: string, fallbackBasis: string) =>
    out.push(v ? { key, value: v.toDecimalPlaces(4).toString(), basis } : { key, value: fallback, basis: fallbackBasis });

  push("revenue_growth", avg(ratios.map((r) => r.revenue_growth.value).filter((x): x is Decimal => !!x)), `3-year average revenue growth, ${yr}`, "0.10", "No history; placeholder 10%");
  push("ebitda_margin", avg(ratios.map((r) => r.ebitda_margin.value).filter((x): x is Decimal => !!x)), `3-year average EBITDA margin, ${yr}`, "0.15", "No history; placeholder 15%");
  push(
    "dep_pct_revenue",
    avg(series((m) => (m.li("depreciation").d && m.li("revenue").d ? m.li("depreciation").d!.div(m.li("revenue").d!) : null))),
    `3-year average D&A ÷ revenue, ${yr}`,
    "0.03",
    "No history; placeholder 3%",
  );
  push(
    "tax_rate",
    avg(series((m) => (m.li("tax").d && m.li("pbt").d && m.li("pbt").d!.isPos() ? m.li("tax").d!.div(m.li("pbt").d!) : null))),
    `3-year average effective tax rate, ${yr}`,
    "0.2517",
    "No history; Indian corporate rate 25.17%",
  );
  push(
    "capex_pct_revenue",
    avg(series((m) => (m.li("capex").d && m.li("revenue").d ? m.li("capex").d!.abs().div(m.li("revenue").d!) : null))),
    `3-year average capex ÷ revenue, ${yr}`,
    "0.05",
    "No history; placeholder 5%",
  );
  push(
    "nwc_pct_revenue",
    avg(series((m) => (m.dIn("nwc").d && m.li("revenue").d ? m.dIn("nwc").d!.div(m.li("revenue").d!) : null))),
    `3-year average NWC ÷ revenue, ${yr}`,
    "0.10",
    "No history; placeholder 10%",
  );
  push(
    "interest_rate",
    avg(series((m) => (m.li("finance_cost").d && m.dIn("total_debt").d?.isPos() ? m.li("finance_cost").d!.div(m.dIn("total_debt").d!) : null))),
    `3-year average finance costs ÷ total debt, ${yr}`,
    "0.09",
    "No debt history; placeholder 9%",
  );
  out.push({ key: "payout_ratio", value: "0", basis: "No dividend data in uploads; set if the company pays dividends" });
  out.push({ key: "wacc", value: "0.12", basis: "Placeholder 12%: set from the team's risk-free rate, beta and market risk premium" });
  out.push({ key: "terminal_growth", value: "0.05", basis: "Placeholder 5% nominal long-run growth" });
  return out;
}

export interface TracedNumber {
  value: string;
  ref: string; // lineage key
}

export interface PeerMultiple {
  companyId: string;
  name: string;
  pe: string | null;
  ev_ebitda: string | null;
}

export interface ModelInputs {
  formulaVersion: string;
  baseYear: string;
  assumptions: Record<string, string>;
  base: {
    revenue: TracedNumber;
    nwc: TracedNumber;
    net_fixed_assets: TracedNumber;
    total_debt: TracedNumber;
    cash: TracedNumber;
    equity: TracedNumber;
    other_income: TracedNumber;
    shares: TracedNumber;
    price: TracedNumber;
    ebitda: TracedNumber;
    pat: TracedNumber;
  };
  peers: PeerMultiple[];
}

const traced = (x: { value: string | null; ref: string; name?: string }, label: string): TracedNumber => {
  if (x.value === null) throw new MissingInputError(label);
  return { value: x.value, ref: x.ref };
};

export class MissingInputError extends Error {
  constructor(public item: string) {
    super(`The model needs \u201c${item}\u201d for the latest year, but it is not in the uploaded data yet. Add it on the Upload data step (the upload template has a row for it, and share price has its own box), then run the model again.`);
  }
}

export function buildModelInputs(args: {
  ds: Dataset;
  companyId: string;
  peerIds: string[];
  names: Record<string, string>;
  fyTo: number;
  assumptions: Record<string, string>;
}): ModelInputs {
  const { ds, companyId, fyTo } = args;
  const base = `FY${fyTo}`;
  const m = new MetricCtx(ds, companyId, base);
  const latestPrice = ds.latestPrice(companyId);
  const latestShares = ds.sharesOn(companyId, "9999-12-31");
  const tracedOther = m.li("other_income");
  const inputs: ModelInputs = {
    formulaVersion: MODEL_FORMULA_VERSION,
    baseYear: base,
    assumptions: args.assumptions,
    base: {
      revenue: traced(m.li("revenue"), `Revenue ${base}`),
      nwc: traced(m.dIn("nwc"), `Net working capital ${base}`),
      net_fixed_assets: traced(m.li("net_fixed_assets"), `Net fixed assets ${base}`),
      total_debt: traced(m.dIn("total_debt"), `Total debt ${base}`),
      cash: traced(m.li("cash"), `Cash ${base}`),
      equity: traced(m.li("equity"), `Total equity ${base}`),
      other_income: { value: tracedOther.value ?? "0", ref: tracedOther.ref },
      shares: latestShares
        ? { value: latestShares.value.toString(), ref: `v:${companyId}:${ds.cell(companyId, `FY${latestShares.date.slice(0, 4)}`, "shares_outstanding")?.id === latestShares.id ? `FY${latestShares.date.slice(0, 4)}` : `D${latestShares.date}`}:shares_outstanding` }
        : (() => { throw new MissingInputError("Shares outstanding"); })(),
      price: latestPrice ? { value: latestPrice.value.toString(), ref: `v:${companyId}:D${latestPrice.date}:price` } : (() => { throw new MissingInputError("Share price"); })(),
      ebitda: traced(m.dIn("ebitda"), `EBITDA ${base}`),
      pat: traced(m.li("pat"), `PAT ${base}`),
    },
    peers: args.peerIds.map((pid) => {
      const latest = latestAnnual(ds, pid) ?? base;
      const pm = new MetricCtx(ds, pid, latest);
      const price = ds.latestPrice(pid);
      const shares = ds.sharesOn(pid, "9999-12-31");
      const eps = pm.dIn("eps").d;
      const nd = pm.dIn("net_debt").d;
      const ebitda = pm.dIn("ebitda").d;
      const pe = price && eps && eps.isPos() ? price.value.div(eps) : null;
      const ev = price && shares && nd ? price.value.mul(shares.value).plus(nd) : null;
      const evE = ev && ebitda && ebitda.isPos() ? ev.div(ebitda) : null;
      return { companyId: pid, name: args.names[pid] ?? pid, pe: pe?.toString() ?? null, ev_ebitda: evE?.toString() ?? null };
    }),
  };
  return inputs;
}

function latestAnnual(ds: Dataset, companyId: string): string | null {
  const fys = ds.periods(companyId).map(fyOf).filter((x): x is number => x !== null);
  return fys.length ? `FY${Math.max(...fys)}` : null;
}

export type Row = Record<string, string>;

export interface ModelOutputs {
  years: string[];
  forecast: Record<string, Row>;
  dcf: Row;
  sensitivity: { waccs: string[]; growths: string[]; grid: (string | null)[][] };
  comps: {
    pe: Row | null;
    ev_ebitda: Row | null;
    low: string | null;
    high: string | null;
  };
  checks: { balanced: boolean; maxImbalance: string };
}

export function runModel(inp: ModelInputs): ModelOutputs {
  const a = Object.fromEntries(Object.entries(inp.assumptions).map(([k, v]) => [k, D(v)]));
  const b = Object.fromEntries(Object.entries(inp.base).map(([k, v]) => [k, D(v.value)])) as Record<keyof ModelInputs["base"], Decimal>;
  const fy0 = fyOf(inp.baseYear)!;
  const years = Array.from({ length: FORECAST_YEARS }, (_, i) => `FY${fy0 + i + 1}E`);

  if (a.wacc.lte(a.terminal_growth)) throw new Error("WACC must be greater than terminal growth");

  // Opening "other net" balances the opening balance sheet; held constant through the forecast.
  const otherNet = b.equity.plus(b.total_debt).minus(b.cash).minus(b.nwc).minus(b.net_fixed_assets);

  const forecast: Record<string, Row> = {};
  let prev = { revenue: b.revenue, nwc: b.nwc, nfa: b.net_fixed_assets, cash: b.cash, equity: b.equity, debt: b.total_debt };
  let maxImb = D(0);
  const fcffs: Decimal[] = [];

  years.forEach((y, i) => {
    const revenue = prev.revenue.mul(a.revenue_growth.plus(1));
    const ebitda = revenue.mul(a.ebitda_margin);
    const dep = revenue.mul(a.dep_pct_revenue);
    const ebit = ebitda.minus(dep);
    const interest = prev.debt.mul(a.interest_rate);
    const otherIncome = b.other_income;
    const pbt = ebit.plus(otherIncome).minus(interest);
    const tax = pbt.isPos() ? pbt.mul(a.tax_rate) : D(0);
    const pat = pbt.minus(tax);
    const dividends = pat.isPos() ? pat.mul(a.payout_ratio) : D(0);

    const nwc = revenue.mul(a.nwc_pct_revenue);
    const deltaNwc = nwc.minus(prev.nwc);
    const capex = revenue.mul(a.capex_pct_revenue);
    const nfa = prev.nfa.plus(capex).minus(dep);
    const debt = prev.debt;
    const equity = prev.equity.plus(pat).minus(dividends);

    const cfo = pat.plus(dep).minus(deltaNwc);
    const cfi = capex.neg();
    const cff = dividends.neg();
    const netCash = cfo.plus(cfi).plus(cff);
    const cash = prev.cash.plus(netCash);

    const assets = cash.plus(nwc).plus(nfa).plus(otherNet);
    const funding = equity.plus(debt);
    const imb = assets.minus(funding).abs();
    if (imb.gt(maxImb)) maxImb = imb;

    const t = i + 1;
    const fcff = ebit.mul(D(1).minus(a.tax_rate)).plus(dep).minus(capex).minus(deltaNwc);
    const df = D(1).div(a.wacc.plus(1).pow(t));
    fcffs.push(fcff);

    forecast[y] = Object.fromEntries(
      Object.entries({ revenue, ebitda, dep, ebit, other_income: otherIncome, interest, pbt, tax, pat, dividends, nwc, delta_nwc: deltaNwc, capex, nfa, debt, equity, other_net: otherNet, cash, cfo, cfi, cff, net_cash: netCash, total_assets: assets, total_funding: funding, fcff, discount_factor: df, pv_fcff: fcff.mul(df) }).map(([k, v]) => [k, v.toString()]),
    );
    prev = { revenue, nwc, nfa, cash, equity, debt };
  });

  const dcfAt = (wacc: Decimal, g: Decimal) => {
    let sumPv = D(0);
    fcffs.forEach((f, i) => (sumPv = sumPv.plus(f.div(wacc.plus(1).pow(i + 1)))));
    const tv = fcffs[fcffs.length - 1].mul(g.plus(1)).div(wacc.minus(g));
    const pvTv = tv.div(wacc.plus(1).pow(fcffs.length));
    const ev = sumPv.plus(pvTv);
    const equityValue = ev.minus(b.total_debt).plus(b.cash);
    const perShare = equityValue.div(b.shares);
    return { sumPv, tv, pvTv, ev, equityValue, perShare };
  };

  const base = dcfAt(a.wacc, a.terminal_growth);
  const dcf: Row = {
    sum_pv_fcff: base.sumPv.toString(),
    terminal_value: base.tv.toString(),
    pv_terminal_value: base.pvTv.toString(),
    enterprise_value: base.ev.toString(),
    less_debt: b.total_debt.toString(),
    plus_cash: b.cash.toString(),
    equity_value: base.equityValue.toString(),
    shares: b.shares.toString(),
    per_share: base.perShare.toString(),
    price: b.price.toString(),
    upside: base.perShare.div(b.price).minus(1).toString(),
    tv_share_of_ev: base.pvTv.div(base.ev).toString(),
  };

  // MOD-05: WACC ±2pp in 1pp steps × terminal growth ±1pp in 0.5pp steps
  const waccs = [-0.02, -0.01, 0, 0.01, 0.02].map((s) => a.wacc.plus(s));
  const growths = [-0.01, -0.005, 0, 0.005, 0.01].map((s) => a.terminal_growth.plus(s));
  const grid = waccs.map((w) => growths.map((g) => (w.gt(g) ? dcfAt(w, g).perShare.toString() : null)));

  // Trading comps: peer median/min/max multiples applied to the company's base-year figures
  const eps = b.pat.div(b.shares);
  const netDebt = b.total_debt.minus(b.cash);
  const pes = inp.peers.map((p) => p.pe).filter((x): x is string => !!x).map(D);
  const evs = inp.peers.map((p) => p.ev_ebitda).filter((x): x is string => !!x).map(D);
  const peRow = (xs: Decimal[]) => {
    if (!xs.length || !eps.isPos()) return null;
    const [lo, mid, hi] = [minD(xs)!, median(xs)!, maxD(xs)!];
    return { min: lo.toString(), median: mid.toString(), max: hi.toString(), implied_low: lo.mul(eps).toString(), implied_mid: mid.mul(eps).toString(), implied_high: hi.mul(eps).toString(), n: String(xs.length) };
  };
  const evRow = (xs: Decimal[]) => {
    if (!xs.length || !b.ebitda.isPos()) return null;
    const imp = (mult: Decimal) => mult.mul(b.ebitda).minus(netDebt).div(b.shares);
    const [lo, mid, hi] = [minD(xs)!, median(xs)!, maxD(xs)!];
    return { min: lo.toString(), median: mid.toString(), max: hi.toString(), implied_low: imp(lo).toString(), implied_mid: imp(mid).toString(), implied_high: imp(hi).toString(), n: String(xs.length) };
  };
  const pe = peRow(pes);
  const ev = evRow(evs);
  const lows = [pe?.implied_low, ev?.implied_low].filter((x): x is string => !!x).map(D);
  const highs = [pe?.implied_high, ev?.implied_high].filter((x): x is string => !!x).map(D);

  return {
    years,
    forecast,
    dcf,
    sensitivity: { waccs: waccs.map(String), growths: growths.map(String), grid },
    comps: { pe, ev_ebitda: ev, low: lows.length ? Decimal.min(...lows).toString() : null, high: highs.length ? Decimal.max(...highs).toString() : null },
    checks: { balanced: maxImb.lt(1), maxImbalance: maxImb.toString() },
  };
}

/** Formulas behind each model output, for lineage (AUD-01). */
export const MODEL_FORMULAS: Record<string, string> = {
  revenue: "Prior-year revenue × (1 + Revenue growth)",
  ebitda: "Revenue × EBITDA margin",
  dep: "Revenue × D&A % of revenue",
  ebit: "EBITDA − D&A",
  interest: "Opening debt × Interest rate",
  pbt: "EBIT + Other income − Interest",
  tax: "PBT × Tax rate (0 if PBT ≤ 0)",
  pat: "PBT − Tax",
  nwc: "Revenue × NWC % of revenue",
  capex: "Revenue × Capex % of revenue",
  nfa: "Opening net fixed assets + Capex − D&A",
  equity: "Opening equity + PAT − Dividends",
  cash: "Opening cash + CFO + CFI + CFF",
  cfo: "PAT + D&A − Change in NWC",
  fcff: "EBIT × (1 − Tax rate) + D&A − Capex − Change in NWC",
  pv_fcff: "FCFF ÷ (1 + WACC)^t",
  terminal_value: "Year-5 FCFF × (1 + g) ÷ (WACC − g)",
  pv_terminal_value: "Terminal value ÷ (1 + WACC)^5",
  enterprise_value: "Sum of PV of FCFF + PV of terminal value",
  equity_value: "Enterprise value − Debt + Cash (base year)",
  per_share: "Equity value ÷ Shares outstanding",
  upside: "DCF value per share ÷ Current price − 1",
  pe_implied: "Peer P/E × Base-year EPS",
  ev_ebitda_implied: "(Peer EV/EBITDA × Base-year EBITDA − Net debt) ÷ Shares outstanding",
};
