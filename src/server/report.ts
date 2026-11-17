import "server-only";
import { prisma } from "./db";
import { LoadedAnalysis, latestRun, loadDataset } from "./analysis";
import { D, Decimal } from "@/lib/decimal";
import { Dataset } from "@/lib/dataset";
import { annualPeriods } from "@/lib/periods";
import { MetricCtx, RATIOS, computeRatios, formatRatio, peerComparison } from "@/lib/ratios";
import { formatIndian, formatMoney } from "@/lib/units";
import { DEFAULT_SECTIONS, RenderContext, Section, TableBlock, TokenValue, renderReport, sectionText } from "@/lib/report";
import { ASSUMPTIONS } from "@/lib/model";

const cr = (v: Decimal | string | null | undefined) => (v === null || v === undefined ? "—" : formatMoney(D(v), "crore", 0));
const rs = (v: string | null | undefined) => (v ? formatIndian(D(v), 2) : "—");
const pct = (v: string | Decimal | null | undefined) => (v === null || v === undefined ? "—" : D(v).mul(100).toFixed(1) + "%");
const xx = (v: string | null | undefined) => (v ? D(v).toFixed(1) + "x" : "—");

export async function ensureReport(analysisId: string) {
  const r = await prisma.report.findUnique({ where: { analysisId } });
  if (r) return r;
  return prisma.report.create({ data: { analysisId, sections: JSON.stringify(DEFAULT_SECTIONS) } });
}

export async function buildRenderContext(a: LoadedAnalysis, ds?: Dataset): Promise<RenderContext> {
  ds = ds ?? (await loadDataset(a.id));
  const run = await latestRun(a.id);
  const base = `FY${a.fyTo}`;
  const periods = annualPeriods(a.fyFrom, a.fyTo);
  const v: Record<string, TokenValue> = {};
  const tables: Record<string, TableBlock> = {};
  const charts: RenderContext["charts"] = {};
  const cid = a.companyId;
  const ref = (p: string, li: string) => `v:${cid}:${p}:${li}`;

  v["company.name"] = { text: a.company.name };
  v["company.nse"] = { text: a.company.nse };
  v["company.sector"] = { text: a.company.sector };
  v["peers.list"] = { text: a.peers.length ? a.peers.map((p) => p.name).join(", ") : "no peers" };
  v["period.range"] = { text: `${periods[0]}–${base}` };
  v["period.first"] = { text: periods[0] };
  v["base.year"] = { text: base };
  v["analyst.name"] = { text: a.owner.name };
  v["approval"] = { text: a.status === "APPROVED" && a.approvedAt ? `Approved by ${a.reviewer.name} on ${a.approvedAt.toISOString().slice(0, 10)}.` : "Not yet approved." };

  const m = new MetricCtx(ds, cid, base);
  v["fin.revenue"] = { text: cr(m.li("revenue").d), ref: ref(base, "revenue") };
  v["fin.ebitda"] = { text: cr(m.dIn("ebitda").d), ref: `d:${cid}:${base}:ebitda` };
  v["fin.pat"] = { text: cr(m.li("pat").d), ref: ref(base, "pat") };
  const r0 = ds.get(cid, periods[0], "revenue"), r1 = ds.get(cid, base, "revenue");
  const years = periods.length - 1;
  v["fin.revenue_cagr"] = { text: r0 && r1 && r0.isPos() && years > 0 ? pct(r1.div(r0).pow(D(1).div(years)).minus(1)) : "—" };

  const own = computeRatios(ds, cid, base);
  const pc = peerComparison(ds, cid, a.peerIdsArr, base);
  for (const r of RATIOS) {
    v[`ratio.${r.key}`] = { text: formatRatio(own[r.key].value, r.format), ref: `r:${cid}:${base}:${r.key}` };
    v[`peer.${r.key}.median`] = { text: formatRatio(pc[r.key].median, r.format) };
  }

  // Financial summary table (₹ crore)
  const fin: [string, (p: string) => TokenValue][] = [
    ["Revenue", (p) => ({ text: cr(ds.get(cid, p, "revenue")), ref: ref(p, "revenue") })],
    ["EBITDA", (p) => ({ text: cr(new MetricCtx(ds, cid, p).dIn("ebitda").d), ref: `d:${cid}:${p}:ebitda` })],
    ["EBITDA margin", (p) => ({ text: formatRatio(computeRatios(ds, cid, p).ebitda_margin.value, "pct"), ref: `r:${cid}:${p}:ebitda_margin` })],
    ["PAT", (p) => ({ text: cr(ds.get(cid, p, "pat")), ref: ref(p, "pat") })],
    ["Total assets", (p) => ({ text: cr(ds.get(cid, p, "total_assets")), ref: ref(p, "total_assets") })],
    ["Total equity", (p) => ({ text: cr(ds.get(cid, p, "equity")), ref: ref(p, "equity") })],
    ["Cash flow from operations", (p) => ({ text: cr(ds.get(cid, p, "cfo")), ref: ref(p, "cfo") })],
  ];
  tables.financials = {
    type: "table",
    title: "Financial summary (₹ crore)",
    header: ["", ...periods],
    rows: fin.map(([label, f]) => ({ cells: [{ text: label }, ...periods.map(f)] })),
  };

  tables.ratios = {
    type: "table",
    title: `Key ratios, ${a.company.name}`,
    header: ["Ratio", ...periods],
    rows: RATIOS.map((r) => ({
      cells: [{ text: r.label }, ...periods.map((p) => ({ text: formatRatio(computeRatios(ds!, cid, p)[r.key].value, r.format), ref: `r:${cid}:${p}:${r.key}` }))],
    })),
  };

  tables.peers = {
    type: "table",
    title: `Peer comparison, ${base}`,
    header: ["Ratio", a.company.name, "Peer median", "Peer min", "Peer max"],
    rows: RATIOS.map((r) => ({
      cells: [
        { text: r.label },
        { text: formatRatio(pc[r.key].company, r.format), ref: `r:${cid}:${base}:${r.key}` },
        { text: formatRatio(pc[r.key].median, r.format) },
        { text: formatRatio(pc[r.key].min, r.format) },
        { text: formatRatio(pc[r.key].max, r.format) },
      ],
    })),
    note: `Peers: ${a.peers.map((p) => p.name).join(", ") || "none"}.`,
  };

  const revSeries = periods.map((p) => ds!.get(cid, p, "revenue"));
  const patSeries = periods.map((p) => ds!.get(cid, p, "pat"));
  charts.revenue_pat = {
    title: "Revenue and PAT (₹ crore)",
    kind: "bar",
    unit: "₹ crore",
    labels: periods,
    series: [
      { name: "Revenue", values: revSeries.map((x) => (x ? Number(x.div(1e7).toFixed(2)) : null)) },
      { name: "PAT", values: patSeries.map((x) => (x ? Number(x.div(1e7).toFixed(2)) : null)) },
    ],
  };

  if (run) {
    const o = run.outputs;
    const mref = (k: string) => `m:${run.id}:${k}`;
    v["dcf.per_share"] = { text: rs(o.dcf.per_share), ref: mref("dcf.per_share") };
    v["dcf.ev"] = { text: cr(o.dcf.enterprise_value), ref: mref("dcf.enterprise_value") };
    v["dcf.equity_value"] = { text: cr(o.dcf.equity_value), ref: mref("dcf.equity_value") };
    v["dcf.upside"] = { text: (D(o.dcf.upside).isPos() ? "+" : "") + pct(o.dcf.upside), ref: mref("dcf.upside") };
    v["price.current"] = { text: rs(o.dcf.price), ref: run.inputs.base.price.ref };
    v["comps.low"] = { text: rs(o.comps.low), ref: mref("comps.low") };
    v["comps.high"] = { text: rs(o.comps.high), ref: mref("comps.high") };
    v["comps.pe_median"] = { text: xx(o.comps.pe?.median), ref: mref("comps.pe.median") };
    v["comps.ev_ebitda_median"] = { text: xx(o.comps.ev_ebitda?.median), ref: mref("comps.ev_ebitda.median") };
    for (const d of ASSUMPTIONS) v[`asm.${d.key}`] = { text: pct(run.inputs.assumptions[d.key]), ref: `a:${a.id}:${d.key}` };

    tables.dcf = {
      type: "table",
      title: "DCF summary",
      header: ["", ...o.years],
      rows: [
        ...(["revenue", "ebitda", "ebit", "capex", "delta_nwc", "fcff", "pv_fcff"] as const).map((k) => ({
          cells: [{ text: { revenue: "Revenue", ebitda: "EBITDA", ebit: "EBIT", capex: "Capex", delta_nwc: "Change in NWC", fcff: "Free cash flow to firm", pv_fcff: "PV of FCFF" }[k] + " (₹ cr)" }, ...o.years.map((y) => ({ text: cr(o.forecast[y][k]), ref: mref(`forecast.${y}.${k}`) }))],
        })),
      ],
      note: `Enterprise value ₹${cr(o.dcf.enterprise_value)} cr (terminal value ${pct(o.dcf.tv_share_of_ev)} of EV) − debt ₹${cr(o.dcf.less_debt)} cr + cash ₹${cr(o.dcf.plus_cash)} cr = equity value ₹${cr(o.dcf.equity_value)} cr; ÷ ${formatIndian(D(o.dcf.shares).div(1e7), 2)} crore shares = ₹${rs(o.dcf.per_share)} per share.`,
    };
    tables.sensitivity = {
      type: "table",
      title: "DCF value per share (₹): WACC vs terminal growth",
      header: ["WACC \\ g", ...o.sensitivity.growths.map((g) => pct(g))],
      rows: o.sensitivity.waccs.map((w, i) => ({
        cells: [{ text: pct(w) }, ...o.sensitivity.grid[i].map((c, j) => ({ text: c ? rs(c) : "n/a", ref: mref(`sensitivity.${i}.${j}`) }))],
        emphasis: i === 2,
      })),
    };
    const compRow = (label: string, r: typeof o.comps.pe, key: string) =>
      r ? { cells: [{ text: label }, { text: xx(r.min) }, { text: xx(r.median) }, { text: xx(r.max) }, { text: `₹${rs(r.implied_low)} – ₹${rs(r.implied_high)}`, ref: mref(`comps.${key}.implied_mid`) }] } : { cells: [{ text: label }, { text: "—" }, { text: "—" }, { text: "—" }, { text: "Not enough peer data" }] };
    tables.comps = {
      type: "table",
      title: "Trading comparables",
      header: ["Multiple", "Peer min", "Peer median", "Peer max", "Implied value per share"],
      rows: [compRow("P/E", o.comps.pe, "pe"), compRow("EV/EBITDA", o.comps.ev_ebitda, "ev_ebitda")],
      note: run.inputs.peers.map((p) => `${p.name}: P/E ${xx(p.pe)}, EV/EBITDA ${xx(p.ev_ebitda)}`).join("; "),
    };
    const ranges: { label: string; low: number; high: number }[] = [];
    if (o.comps.pe) ranges.push({ label: "P/E comps", low: Number(o.comps.pe.implied_low), high: Number(o.comps.pe.implied_high) });
    if (o.comps.ev_ebitda) ranges.push({ label: "EV/EBITDA comps", low: Number(o.comps.ev_ebitda.implied_low), high: Number(o.comps.ev_ebitda.implied_high) });
    const flat = o.sensitivity.grid.flat().filter((x): x is string => !!x).map(Number);
    ranges.unshift({ label: "DCF (sensitivity range)", low: Math.min(...flat), high: Math.max(...flat) });
    charts.valuation = {
      title: "Valuation range (₹ per share)",
      kind: "range",
      unit: "₹/share",
      labels: ranges.map((r) => r.label),
      series: [],
      ranges,
      marker: { label: `Current price ₹${rs(o.dcf.price)}`, value: Number(o.dcf.price) },
    };
  }
  return { values: v, tables, charts };
}

export async function renderCurrentReport(a: LoadedAnalysis) {
  const report = await ensureReport(a.id);
  const sections: Section[] = JSON.parse(report.sections);
  const ctx = await buildRenderContext(a);
  return { report, sections, ctx, rendered: renderReport(sections, ctx) };
}

/** Snapshot the current report as a submitted version (REV-06/07). */
export async function snapshotVersion(a: LoadedAnalysis, userId: string) {
  const { rendered, ctx } = await renderCurrentReport(a);
  const run = await latestRun(a.id);
  const count = await prisma.reportVersion.count({ where: { analysisId: a.id } });
  const values: Record<string, string> = {};
  for (const [k, t] of Object.entries(ctx.values)) values[k] = t.text;
  for (const [k, t] of Object.entries(ctx.tables)) for (const [i, row] of t.rows.entries()) for (const [j, c] of row.cells.entries()) if (j > 0) values[`table:${k}[${row.cells[0].text}][${t.header[j] ?? i}]`] = c.text;
  return prisma.reportVersion.create({
    data: {
      analysisId: a.id,
      number: count + 1,
      sections: JSON.stringify(rendered.map((s) => ({ key: s.key, title: s.title, text: sectionText(s), blocks: s.blocks }))),
      values: JSON.stringify(values),
      modelRunId: run?.id ?? null,
      submittedBy: userId,
    },
  });
}
