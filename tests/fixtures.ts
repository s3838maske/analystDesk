// Synthetic test data (fictional numbers, not real companies).
import { ValueRow } from "../src/lib/dataset";

let n = 0;
export function rows(companyId: string, data: Record<string, Record<string, number | string>>): ValueRow[] {
  const out: ValueRow[] = [];
  for (const [period, items] of Object.entries(data)) {
    for (const [lineItem, v] of Object.entries(items)) {
      out.push({ id: `r${n++}`, companyId, period, lineItem, value: String(v), origin: "AUTOMATED", createdAt: new Date(2026, 0, 1) });
    }
  }
  return out;
}

const CR = 10_000_000;
// A balanced 3-year company in ₹ crore, converted to base units
export function demoCompany(scale = 1) {
  const fy = (rev: number, cash: number, prevCash: number) => {
    const cogs = rev * 0.5, emp = rev * 0.15, oth = rev * 0.1, dep = rev * 0.04, fin = 20, oi = 10;
    const ebitda = rev - cogs - emp - oth;
    const pbt = ebitda - dep - fin + oi;
    const tax = pbt * 0.25;
    const pat = pbt - tax;
    const rec = rev * 0.15, inv = rev * 0.1, oca = 50, nfa = rev * 0.6, invst = 100, onca = 40;
    const ta = cash + rec + inv + oca + nfa + invst + onca;
    const bl = 200, bs = 50, pay = rev * 0.12, ocl = 60, oncl = 30;
    const eq = ta - bl - bs - pay - ocl - oncl;
    const cfo = pat + dep - 20, cfi = -(rev * 0.06), cff = cash - prevCash - cfo - cfi;
    const m = (x: number) => Math.round(x * CR * scale);
    return {
      revenue: m(rev), cogs: m(cogs), employee_cost: m(emp), other_expenses: m(oth), depreciation: m(dep), finance_cost: m(fin), other_income: m(oi), pbt: m(pbt), tax: m(tax), pat: m(pbt) - m(tax),
      cash: m(cash), receivables: m(rec), inventory: m(inv), other_current_assets: m(oca), net_fixed_assets: m(nfa), investments: m(invst), other_non_current_assets: m(onca),
      total_assets: m(cash) + m(rec) + m(inv) + m(oca) + m(nfa) + m(invst) + m(onca),
      equity: m(cash) + m(rec) + m(inv) + m(oca) + m(nfa) + m(invst) + m(onca) - m(bl) - m(bs) - m(pay) - m(ocl) - m(oncl),
      borrowings_long: m(bl), borrowings_short: m(bs), payables: m(pay), other_current_liabilities: m(ocl), other_non_current_liabilities: m(oncl),
      total_equity_liabilities: m(cash) + m(rec) + m(inv) + m(oca) + m(nfa) + m(invst) + m(onca),
      cfo: m(cfo), capex: m(cfi), cfi: m(cfi), cff: m(cash) - m(prevCash) - m(cfo) - m(cfi), net_change_cash: m(cash) - m(prevCash), opening_cash: m(prevCash), closing_cash: m(cash),
      shares_outstanding: 100_000_000,
      _eq: eq, _pat: pat, _cff: cff,
    };
  };
  const strip = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
  return {
    FY2023: strip(fy(1000, 120, 100)),
    FY2024: strip(fy(1150, 150, 120)),
    FY2025: strip(fy(1300, 190, 150)),
    "D2025-03-28": { price: 250 },
    "D2026-11-13": { price: 300 },
  };
}
