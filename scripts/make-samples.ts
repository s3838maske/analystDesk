// Generates SYNTHETIC sample upload files (fictional DEMO companies, made-up numbers) in samples/.
import * as XLSX from "xlsx";
import fs from "fs";

type Fin = Record<string, number>;

function company(rev0: number, growth: number, margin: number, seed: number) {
  const years = [2021, 2022, 2023, 2024, 2025];
  const out: Record<string, Fin> = {};
  let cashPrev = rev0 * 0.08, rev = rev0;
  for (const [i, y] of years.entries()) {
    rev = i === 0 ? rev0 : rev * (1 + growth + ((seed * (i + 3)) % 7) / 200 - 0.015);
    const r = (x: number) => Math.round(x * 100) / 100;
    const cogs = r(rev * 0.52), emp = r(rev * 0.12), oth = r(rev * (0.36 - margin)), dep = r(rev * 0.035), fin = r(rev * 0.008), oi = r(rev * 0.01);
    const ebitda = rev - cogs - emp - oth;
    const pbt = r(ebitda - dep - fin + oi), tax = r(pbt * 0.25), pat = r(pbt - tax);
    const cash = r(cashPrev + rev * 0.02);
    const rec = r(rev * 0.14), inv = r(rev * 0.11), oca = r(rev * 0.03), nfa = r(rev * 0.55), invst = r(rev * 0.06), onca = r(rev * 0.02);
    const ta = r(cash + rec + inv + oca + nfa + invst + onca);
    const bl = r(rev * 0.12), bs = r(rev * 0.04), pay = r(rev * 0.1), ocl = r(rev * 0.04), oncl = r(rev * 0.02);
    const eq = r(ta - bl - bs - pay - ocl - oncl);
    const cfo = r(pat + dep - rev * 0.015), capex = r(-rev * 0.06), cfi = r(capex + rev * 0.004);
    const net = r(cash - cashPrev), cff = r(net - cfo - cfi);
    out[`FY${y}`] = { revenue: r(rev), cogs, employee_cost: emp, other_expenses: oth, depreciation: dep, finance_cost: fin, other_income: oi, pbt, tax, pat,
      cash, receivables: rec, inventory: inv, other_current_assets: oca, net_fixed_assets: nfa, investments: invst, other_non_current_assets: onca, total_assets: ta,
      equity: eq, borrowings_long: bl, borrowings_short: bs, payables: pay, other_current_liabilities: ocl, other_non_current_liabilities: oncl, total_equity_liabilities: ta,
      cfo, capex, cfi, cff, net_change_cash: net, opening_cash: r(cashPrev), closing_cash: cash };
    cashPrev = cash;
  }
  return out;
}

// price = FY2025 EPS × a plausible P/E (shares in crore, PAT in ₹ crore)
const mk = (rev0: number, g: number, m: number, seed: number, shares: number, pe: number) => {
  const fin = company(rev0, g, m, seed);
  return { fin, shares, price: Math.round((fin.FY2025.pat / shares) * pe * 100) / 100 };
};
const cos: Record<string, { fin: Record<string, Fin>; shares: number; price: number }> = {
  DEMOALPHA: mk(4200, 0.11, 0.21, 3, 45, 24),
  DEMOBETA: mk(3100, 0.09, 0.18, 5, 30, 21),
  DEMOGAMMA: mk(5600, 0.12, 0.23, 7, 80, 27),
  DEMODELTA: mk(2400, 0.08, 0.16, 11, 22, 18),
};

// Deliberate data problems in the subject company, so the validation flags can be demonstrated
cos.DEMOALPHA.fin.FY2023.total_assets = Math.round((cos.DEMOALPHA.fin.FY2023.total_assets + 37.5) * 100) / 100; // balance sheet off by ₹37.5 cr
cos.DEMOALPHA.fin.FY2024.capex = -cos.DEMOALPHA.fin.FY2024.capex; // sign error

fs.mkdirSync("samples", { recursive: true });

// 1) Standard template (LONG) with the subject and three peers, ₹ crore
const rows: unknown[][] = [["Company", "Statement", "Line item", "Period", "Value", "Unit", "Currency", "FX to INR"]];
for (const [code, c] of Object.entries(cos)) {
  for (const [p, f] of Object.entries(c.fin)) for (const [k, v] of Object.entries(f)) rows.push([code, "", k, p, v, "crore", "INR", ""]);
  rows.push([code, "MKT", "shares_outstanding", "FY2025", c.shares, "crore", "INR", ""]);
}
// two quarters of income statement for the subject
for (const [q, s] of [["Q1FY26", 0.24], ["Q2FY26", 0.26]] as const) {
  const f = cos.DEMOALPHA.fin.FY2025;
  for (const k of ["revenue", "depreciation", "pbt", "pat"]) rows.push(["DEMOALPHA", "IS", k, q, Math.round(f[k] * 1.1 * s * 100) / 100, "crore", "INR", ""]);
}
const wb1 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb1, XLSX.utils.aoa_to_sheet(rows), "Data");
XLSX.writeFile(wb1, "samples/demo_financials_template.xlsx");

// 2) A "terminal export" style WIDE file for one peer, in ₹ lakh, with source labels
const LABELS: [string, string][] = [
  ["Revenue from Operations", "revenue"], ["Cost of materials consumed", "cogs"], ["Employee benefit expense", "employee_cost"], ["Other expenses", "other_expenses"],
  ["Depreciation and amortisation expense", "depreciation"], ["Finance costs", "finance_cost"], ["Other Income", "other_income"], ["Profit before tax", "pbt"], ["Total tax expense", "tax"], ["Profit for the year", "pat"],
  ["Cash and cash equivalents", "cash"], ["Trade receivables", "receivables"], ["Inventories", "inventory"], ["Other current assets", "other_current_assets"], ["Property, plant and equipment", "net_fixed_assets"],
  ["Investments", "investments"], ["Other non-current assets", "other_non_current_assets"], ["Total Assets", "total_assets"], ["Total equity", "equity"], ["Long term borrowings", "borrowings_long"],
  ["Short term borrowings", "borrowings_short"], ["Trade payables", "payables"], ["Other current liabilities", "other_current_liabilities"], ["Other non-current liabilities", "other_non_current_liabilities"],
  ["Total Equity and Liabilities", "total_equity_liabilities"], ["Net cash from operating activities", "cfo"], ["Purchase of property, plant and equipment", "capex"], ["Net cash used in investing activities", "cfi"],
  ["Net cash used in financing activities", "cff"], ["Segment revenue - exports (memo)", ""],
];
const per = ["Mar-21", "Mar-22", "Mar-23", "Mar-24", "Mar-25"];
const w: unknown[][] = [["DEMO GAMMA PRODUCTS LTD — Standalone (Rs. Lakh)"], [], ["Particulars", ...per]];
for (const [label, key] of LABELS) w.push([label, ...per.map((_, i) => (key ? Math.round(cos.DEMOGAMMA.fin[`FY${2021 + i}`][key] * 100 * 100) / 100 : 1234))]);
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(w), "Financials");
XLSX.writeFile(wb2, "samples/demo_gamma_terminal_export_lakh.xlsx");

// 3) Prices CSV: month-end closes for all four companies
const pr: unknown[][] = [["Date", "Company", "Close", "Shares outstanding"]];
for (const [code, c] of Object.entries(cos)) {
  for (let y = 2021; y <= 2026; y++) for (const m of [3, 6, 9, 12]) {
    if (y === 2026 && m > 9) continue;
    const t = (y - 2021) * 4 + m / 3;
    const close = Math.round(c.price * (0.55 + t * 0.022) * 100) / 100;
    pr.push([`${y}-${String(m).padStart(2, "0")}-${m === 3 ? 28 : m === 6 ? 28 : m === 9 ? 27 : 29}`, code, close, ""]);
  }
  pr.push(["2026-11-13", code, c.price, c.shares * 1e7]);
}
fs.writeFileSync("samples/demo_prices.csv", pr.map((r) => r.join(",")).join("\n"));
fs.writeFileSync("samples/README.md", "# Sample files (synthetic)\n\nAll numbers here are made up, for fictional DEMO companies, to try the app end to end. They are not real financial data.\n\n- `demo_financials_template.xlsx`: standard template, DEMOALPHA (subject) + 3 peers, FY2021–FY2025, ₹ crore. Contains two deliberate errors (FY2023 balance sheet off by ₹37.5 cr; FY2024 capex with the wrong sign).\n- `demo_gamma_terminal_export_lakh.xlsx`: a wide \"terminal export\" layout in ₹ lakh, for the column-mapping screen (upload it under a source name such as \"terminal export\").\n- `demo_prices.csv`: quarter-end closes and current shares outstanding.\n");
console.log("Wrote samples/");
