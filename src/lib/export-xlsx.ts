// MOD-07: model workbook with live Excel formulas (not pasted values).
// Money is shown in ₹ crore in the workbook; shares in crore. Cached results are written so the file
// shows numbers before Excel recalculates, and Excel recalculates everything on open.
import ExcelJS from "exceljs";
import { D } from "./decimal";
import { ASSUMPTIONS, ModelInputs, ModelOutputs } from "./model";
import { LINE_ITEMS } from "./coa";
import { Dataset } from "./dataset";

const CR = 1e7;
const n = (v: string | null | undefined, scale = 1) => (v === null || v === undefined ? null : D(v).div(scale).toNumber());

export async function buildModelWorkbook(args: {
  companyName: string;
  companyId: string;
  periods: string[];
  ds: Dataset;
  inputs: ModelInputs;
  outputs: ModelOutputs;
  runId: string;
  runAt: Date;
}): Promise<Buffer> {
  const { inputs: inp, outputs: out } = args;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AnalystDesk";
  wb.calcProperties.fullCalcOnLoad = true;
  const bold = { bold: true } as const;
  const pctFmt = "0.00%";
  const crFmt = "#,##0.00";

  // --- Assumptions
  const as = wb.addWorksheet("Assumptions");
  as.columns = [{ width: 38 }, { width: 14 }, { width: 70 }];
  as.addRow(["Assumption", "Value", "Note"]).font = bold;
  const asmCell: Record<string, string> = {};
  ASSUMPTIONS.forEach((d, i) => {
    const r = as.addRow([d.label, n(inp.assumptions[d.key]), d.help]);
    r.getCell(2).numFmt = pctFmt;
    asmCell[d.key] = `Assumptions!$B$${i + 2}`;
  });
  as.addRow([]);
  as.addRow([`Model run ${args.runId}, ${args.runAt.toISOString()}, formula version ${inp.formulaVersion}`]).font = { italic: true, color: { argb: "FF6B7280" } };

  // --- Base inputs
  const bs = wb.addWorksheet("Base");
  bs.columns = [{ width: 34 }, { width: 16 }, { width: 44 }];
  bs.addRow([`Base year ${inp.baseYear}`, "Value", "Lineage key"]).font = bold;
  const baseRows: [keyof ModelInputs["base"], string, number][] = [
    ["revenue", "Revenue (₹ cr)", CR],
    ["ebitda", "EBITDA (₹ cr)", CR],
    ["pat", "PAT (₹ cr)", CR],
    ["other_income", "Other income (₹ cr)", CR],
    ["nwc", "Net working capital (₹ cr)", CR],
    ["net_fixed_assets", "Net fixed assets (₹ cr)", CR],
    ["total_debt", "Total debt (₹ cr)", CR],
    ["cash", "Cash (₹ cr)", CR],
    ["equity", "Total equity (₹ cr)", CR],
    ["shares", "Shares outstanding (crore)", CR],
    ["price", "Current share price (₹)", 1],
  ];
  const baseCell: Record<string, string> = {};
  baseRows.forEach(([k, label, scale], i) => {
    const r = bs.addRow([label, n(inp.base[k].value, scale), inp.base[k].ref]);
    r.getCell(2).numFmt = crFmt;
    baseCell[k] = `Base!$B$${i + 2}`;
  });

  // --- Historical (values as uploaded and validated)
  const hs = wb.addWorksheet("Historical");
  hs.columns = [{ width: 40 }, ...args.periods.map(() => ({ width: 14 }))];
  hs.addRow([`${args.companyName} (₹ crore)`, ...args.periods]).font = bold;
  for (const li of LINE_ITEMS.filter((l) => l.statement !== "MKT")) {
    const vals = args.periods.map((p) => args.ds.get(args.companyId, p, li.key));
    if (vals.every((v) => !v)) continue;
    const r = hs.addRow([li.label, ...vals.map((v) => (v ? v.div(CR).toNumber() : null))]);
    r.eachCell((c, i) => i > 1 && (c.numFmt = crFmt));
  }

  // --- Forecast with live formulas
  const fs = wb.addWorksheet("Forecast");
  fs.columns = [{ width: 30 }, ...Array(6).fill({ width: 14 })];
  const cols = ["B", "C", "D", "E", "F", "G"];
  fs.addRow(["₹ crore", `${inp.baseYear}A`, ...out.years]).font = bold;
  const A = asmCell;
  type RowDef = { label: string; key?: string; base?: string; f?: (c: string, p: string) => string; pct?: boolean };
  // row numbers are fixed by order below (starting at 2)
  const R = {
    revenue: 2, ebitda: 3, dep: 4, ebit: 5, other_income: 6, interest: 7, pbt: 8, tax: 9, pat: 10, dividends: 11,
    nwc: 12, delta_nwc: 13, debt: 14, capex: 15, nfa: 16, equity: 17, other_net: 18, cfo: 19, cash: 20, check: 21, fcff: 22, t: 23, df: 24, pv: 25,
  };
  const rows: RowDef[] = [
    { label: "Revenue", key: "revenue", base: `=${baseCell.revenue}`, f: (c, p) => `${p}${R.revenue}*(1+${A.revenue_growth})` },
    { label: "EBITDA", key: "ebitda", base: `=${baseCell.ebitda}`, f: (c) => `${c}${R.revenue}*${A.ebitda_margin}` },
    { label: "D&A", key: "dep", f: (c) => `${c}${R.revenue}*${A.dep_pct_revenue}` },
    { label: "EBIT", key: "ebit", f: (c) => `${c}${R.ebitda}-${c}${R.dep}` },
    { label: "Other income", key: "other_income", base: `=${baseCell.other_income}`, f: () => `${baseCell.other_income}` },
    { label: "Interest", key: "interest", f: (c, p) => `${p}${R.debt}*${A.interest_rate}` },
    { label: "PBT", key: "pbt", f: (c) => `${c}${R.ebit}+${c}${R.other_income}-${c}${R.interest}` },
    { label: "Tax", key: "tax", f: (c) => `IF(${c}${R.pbt}>0,${c}${R.pbt}*${A.tax_rate},0)` },
    { label: "PAT", key: "pat", base: `=${baseCell.pat}`, f: (c) => `${c}${R.pbt}-${c}${R.tax}` },
    { label: "Dividends", key: "dividends", f: (c) => `IF(${c}${R.pat}>0,${c}${R.pat}*${A.payout_ratio},0)` },
    { label: "Net working capital", key: "nwc", base: `=${baseCell.nwc}`, f: (c) => `${c}${R.revenue}*${A.nwc_pct_revenue}` },
    { label: "Change in NWC", key: "delta_nwc", f: (c, p) => `${c}${R.nwc}-${p}${R.nwc}` },
    { label: "Total debt", key: "debt", base: `=${baseCell.total_debt}`, f: (c, p) => `${p}${R.debt}` },
    { label: "Capex", key: "capex", f: (c) => `${c}${R.revenue}*${A.capex_pct_revenue}` },
    { label: "Net fixed assets", key: "nfa", base: `=${baseCell.net_fixed_assets}`, f: (c, p) => `${p}${R.nfa}+${c}${R.capex}-${c}${R.dep}` },
    { label: "Total equity", key: "equity", base: `=${baseCell.equity}`, f: (c, p) => `${p}${R.equity}+${c}${R.pat}-${c}${R.dividends}` },
    { label: "Other net assets (held constant)", key: "other_net", base: `=B${R.equity}+B${R.debt}-B${R.cash}-B${R.nwc}-B${R.nfa}`, f: (c, p) => `${p}${R.other_net}` },
    { label: "Cash flow from operations", key: "cfo", f: (c) => `${c}${R.pat}+${c}${R.dep}-${c}${R.delta_nwc}` },
    { label: "Cash", key: "cash", base: `=${baseCell.cash}`, f: (c, p) => `${p}${R.cash}+${c}${R.cfo}-${c}${R.capex}-${c}${R.dividends}` },
    { label: "Balance check (should be 0)", f: (c) => `ROUND(${c}${R.cash}+${c}${R.nwc}+${c}${R.nfa}+${c}${R.other_net}-${c}${R.equity}-${c}${R.debt},6)` },
    { label: "Free cash flow to firm", key: "fcff", f: (c) => `${c}${R.ebit}*(1-${A.tax_rate})+${c}${R.dep}-${c}${R.capex}-${c}${R.delta_nwc}` },
    { label: "Year (t)", f: (c) => `${cols.indexOf(c)}` },
    { label: "Discount factor", key: "discount_factor", f: (c) => `1/(1+${A.wacc})^${c}${R.t}`, pct: false },
    { label: "PV of FCFF", key: "pv_fcff", f: (c) => `${c}${R.fcff}*${c}${R.df}` },
  ];
  rows.forEach((rd, i) => {
    const rowNo = i + 2;
    const r = fs.getRow(rowNo);
    r.getCell(1).value = rd.label;
    if (rd.base) {
      const baseKey: Record<string, keyof ModelInputs["base"]> = { revenue: "revenue", ebitda: "ebitda", pat: "pat", other_income: "other_income", nwc: "nwc", debt: "total_debt", nfa: "net_fixed_assets", equity: "equity", cash: "cash" };
      const cached = rd.key === "other_net" ? n(out.forecast[out.years[0]].other_net, CR) : rd.key && baseKey[rd.key] ? n(inp.base[baseKey[rd.key]].value, CR) : null;
      r.getCell(2).value = { formula: rd.base.slice(1), result: cached ?? undefined } as ExcelJS.CellFormulaValue;
    }
    for (let k = 1; k <= 5; k++) {
      const c = cols[k], p = cols[k - 1];
      const y = out.years[k - 1];
      let cached: number | undefined;
      if (rd.key && out.forecast[y][rd.key] !== undefined) cached = n(out.forecast[y][rd.key], rd.key === "discount_factor" ? 1 : CR) ?? undefined;
      if (rd.label.startsWith("Year")) cached = k;
      if (rd.label.startsWith("Balance")) cached = 0;
      r.getCell(k + 2).value = { formula: rd.f!(c, p), result: cached } as ExcelJS.CellFormulaValue;
    }
    r.eachCell((cell, ci) => ci > 1 && (cell.numFmt = rd.label === "Year (t)" ? "0" : rd.key === "discount_factor" ? "0.0000" : crFmt));
    if (["EBITDA", "PAT", "Free cash flow to firm"].includes(rd.label)) r.font = bold;
  });
  void R.check;

  // --- DCF
  const dc = wb.addWorksheet("DCF");
  dc.columns = [{ width: 36 }, { width: 18 }];
  const dcfRows: [string, string, string | null, string][] = [
    ["Sum of PV of FCFF (₹ cr)", `SUM(Forecast!C${R.pv}:G${R.pv})`, out.dcf.sum_pv_fcff, crFmt],
    ["Terminal value (₹ cr)", `Forecast!G${R.fcff}*(1+${A.terminal_growth})/(${A.wacc}-${A.terminal_growth})`, out.dcf.terminal_value, crFmt],
    ["PV of terminal value (₹ cr)", `B3/(1+${A.wacc})^5`, out.dcf.pv_terminal_value, crFmt],
    ["Enterprise value (₹ cr)", "B2+B4", out.dcf.enterprise_value, crFmt],
    ["Less: debt (₹ cr)", baseCell.total_debt, out.dcf.less_debt, crFmt],
    ["Plus: cash (₹ cr)", baseCell.cash, out.dcf.plus_cash, crFmt],
    ["Equity value (₹ cr)", "B5-B6+B7", out.dcf.equity_value, crFmt],
    ["Shares outstanding (crore)", baseCell.shares, out.dcf.shares, crFmt],
    ["DCF value per share (₹)", "B8/B9", null, crFmt],
    ["Current price (₹)", baseCell.price, null, crFmt],
    ["Upside / (downside)", "B10/B11-1", null, pctFmt],
  ];
  dc.addRow(["DCF", "Value"]).font = bold;
  dcfRows.forEach(([label, f, cached, fmt], i) => {
    const r = dc.addRow([label]);
    const res = i === 8 ? n(out.dcf.per_share) : i === 9 ? n(out.dcf.price) : i === 10 ? n(out.dcf.upside) : n(cached, CR);
    r.getCell(2).value = { formula: f, result: res ?? undefined } as ExcelJS.CellFormulaValue;
    r.getCell(2).numFmt = fmt;
    if (i === 8) r.font = bold;
  });

  // --- Sensitivity (each cell is a full DCF formula)
  const ss = wb.addWorksheet("Sensitivity");
  ss.columns = [{ width: 18 }, ...Array(5).fill({ width: 14 })];
  ss.addRow(["Value per share (₹)", "Terminal growth →"]).font = bold;
  const gOff = [-0.01, -0.005, 0, 0.005, 0.01], wOff = [-0.02, -0.01, 0, 0.01, 0.02];
  const hdr = ss.getRow(2);
  hdr.getCell(1).value = "WACC ↓";
  gOff.forEach((o, j) => {
    const c = hdr.getCell(j + 2);
    c.value = { formula: `${A.terminal_growth}+(${o})`, result: n(out.sensitivity.growths[j]) ?? undefined } as ExcelJS.CellFormulaValue;
    c.numFmt = pctFmt;
    c.font = bold;
  });
  wOff.forEach((o, i) => {
    const r = ss.getRow(i + 3);
    r.getCell(1).value = { formula: `${A.wacc}+(${o})`, result: n(out.sensitivity.waccs[i]) ?? undefined } as ExcelJS.CellFormulaValue;
    r.getCell(1).numFmt = pctFmt;
    r.getCell(1).font = bold;
    gOff.forEach((_, j) => {
      const col = String.fromCharCode(66 + j);
      const w = `$A${i + 3}`, g = `${col}$2`;
      const f = `IF(${w}>${g},(SUMPRODUCT(Forecast!$C$${R.fcff}:$G$${R.fcff}/(1+${w})^Forecast!$C$${R.t}:$G$${R.t})+Forecast!$G$${R.fcff}*(1+${g})/(${w}-${g})/(1+${w})^5-DCF!$B$6+DCF!$B$7)/DCF!$B$9,"n/a")`;
      const cached = out.sensitivity.grid[i][j];
      const cell = r.getCell(j + 2);
      cell.value = { formula: f, result: cached ? n(cached)! : "n/a" } as ExcelJS.CellFormulaValue;
      cell.numFmt = crFmt;
    });
  });

  // --- Comps
  const cs = wb.addWorksheet("Comps");
  cs.columns = [{ width: 34 }, { width: 12 }, { width: 12 }];
  cs.addRow(["Peer", "P/E", "EV/EBITDA"]).font = bold;
  inp.peers.forEach((p) => cs.addRow([p.name, n(p.pe), n(p.ev_ebitda)]));
  const last = inp.peers.length + 1;
  const sr = last + 2;
  cs.getRow(sr).values = ["Peer median", { formula: `IFERROR(MEDIAN(B2:B${last}),"n/a")` }, { formula: `IFERROR(MEDIAN(C2:C${last}),"n/a")` }];
  cs.getRow(sr + 1).values = ["Peer min", { formula: `IFERROR(MIN(B2:B${last}),"n/a")` }, { formula: `IFERROR(MIN(C2:C${last}),"n/a")` }];
  cs.getRow(sr + 2).values = ["Peer max", { formula: `IFERROR(MAX(B2:B${last}),"n/a")` }, { formula: `IFERROR(MAX(C2:C${last}),"n/a")` }];
  cs.getRow(sr + 4).values = ["Implied value per share (₹) at median", { formula: `IFERROR(B${sr}*${baseCell.pat}/${baseCell.shares},"n/a")` }, { formula: `IFERROR((C${sr}*${baseCell.ebitda}-${baseCell.total_debt}+${baseCell.cash})/${baseCell.shares},"n/a")` }];
  for (let r = 2; r <= sr + 4; r++) cs.getRow(r).eachCell((c, i) => i > 1 && (c.numFmt = "0.00"));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
