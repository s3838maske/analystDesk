import { describe, expect, it } from "vitest";
import { D, parseDecimal } from "../src/lib/decimal";
import { Dataset } from "../src/lib/dataset";
import { validateAnalysis } from "../src/lib/validation";
import { computeRatios, peerComparison } from "../src/lib/ratios";
import { buildModelInputs, defaultAssumptions, runModel } from "../src/lib/model";
import { formatIndian, normUnit, toBase } from "../src/lib/units";
import { parsePeriodHeader, latestQuarters } from "../src/lib/periods";
import { suggestLineItem } from "../src/lib/coa";
import { demoCompany, rows } from "./fixtures";

const names = { A: "Alpha", P1: "Peer One", P2: "Peer Two" };

function ds() {
  return new Dataset([...rows("A", demoCompany(1)), ...rows("P1", demoCompany(0.8)), ...rows("P2", demoCompany(1.3))]);
}

describe("parsing and units", () => {
  it("parses Indian-formatted and bracketed numbers exactly", () => {
    expect(parseDecimal("1,23,456.70")!.toString()).toBe("123456.7");
    expect(parseDecimal("(1,234)")!.toString()).toBe("-1234");
    expect(parseDecimal("12.5%")!.toString()).toBe("0.125");
    expect(parseDecimal("-")).toBeNull();
    expect(parseDecimal(0.1)!.plus(parseDecimal(0.2)!).toString()).toBe("0.3");
  });
  it("normalizes units to base INR", () => {
    expect(normUnit("Rs. Cr")).toBe("crore");
    expect(normUnit("INR mn")).toBe("million");
    expect(toBase(D("12.34"), "crore").toString()).toBe("123400000");
    expect(toBase(D("5"), "lakh").toString()).toBe("500000");
    expect(toBase(D("2"), "million", "83.5").toString()).toBe("167000000");
    expect(formatIndian(D("12345678.9"))).toBe("1,23,45,678.90");
  });
  it("parses period headers", () => {
    expect(parsePeriodHeader("Mar-25")).toBe("FY2025");
    expect(parsePeriodHeader("FY24")).toBe("FY2024");
    expect(parsePeriodHeader("Q1 FY26")).toBe("Q1FY26");
    expect(parsePeriodHeader("Jun-25", true)).toBe("Q1FY26");
    expect(parsePeriodHeader("Dec 2025", true)).toBe("Q3FY26");
    expect(latestQuarters(4, new Date(2026, 10, 16))).toEqual(["Q3FY26", "Q4FY26", "Q1FY27", "Q2FY27"]);
  });
  it("suggests standard line items only on exact synonyms", () => {
    expect(suggestLineItem("Revenue from Operations")).toBe("revenue");
    expect(suggestLineItem("Profit/(Loss) for the period")).toBe("pat");
    expect(suggestLineItem("Some exotic item")).toBeNull();
  });
});

describe("validation", () => {
  it("passes a clean, balanced dataset", () => {
    const flags = validateAnalysis({ ds: ds(), subjectId: "A", peerIds: ["P1"], fyFrom: 2023, fyTo: 2025, quarters: [], names });
    expect(flags.filter((f) => f.severity === "HIGH")).toEqual([]);
  });
  it("flags an unbalanced balance sheet, broken cash flow, sign error and missing period", () => {
    const r = rows("A", demoCompany(1));
    const bump = (p: string, li: string, v: string) => (r.find((x) => x.period === p && x.lineItem === li)!.value = v);
    bump("FY2024", "total_assets", "1");
    bump("FY2025", "cfo", "5");
    bump("FY2025", "revenue", "-5");
    const d = new Dataset(r);
    const flags = validateAnalysis({ ds: d, subjectId: "A", peerIds: [], fyFrom: 2022, fyTo: 2025, quarters: [], names });
    const types = flags.map((f) => `${f.type}:${f.period}`);
    expect(types).toContain("BS_IMBALANCE:FY2024");
    expect(types).toContain("CF_TIE:FY2025");
    expect(types).toContain("SIGN:FY2025");
    expect(types).toContain("MISSING_PERIOD:FY2022");
    expect(flags.find((f) => f.type === "MISSING_PERIOD")!.severity).toBe("HIGH");
  });
  it("flags restatements when two uploads disagree", () => {
    const r = [...rows("A", demoCompany(1)), { id: "x", companyId: "A", period: "FY2025", lineItem: "revenue", value: "1", origin: "AUTOMATED", createdAt: new Date(2026, 5, 1) }];
    const flags = validateAnalysis({ ds: new Dataset(r), subjectId: "A", peerIds: [], fyFrom: 2023, fyTo: 2025, quarters: [], names });
    expect(flags.some((f) => f.type === "RESTATEMENT")).toBe(true);
  });
});

describe("ratios", () => {
  it("computes margins exactly and traces inputs", () => {
    const r = computeRatios(ds(), "A", "FY2025");
    expect(r.ebitda_margin.value!.toString()).toBe("0.25");
    expect(r.revenue_growth.value!.toFixed(10)).toBe(D(1300).div(1150).minus(1).toFixed(10));
    expect(r.ebitda_margin.inputs[0].ref).toBe("d:A:FY2025:ebitda");
    expect(r.pe.value).not.toBeNull();
  });
  it("compares with peers", () => {
    const pc = peerComparison(ds(), "A", ["P1", "P2"], "FY2025");
    expect(pc.ebitda_margin.n).toBe(2);
    expect(pc.ebitda_margin.median!.toString()).toBe("0.25");
  });
});

describe("model", () => {
  const build = () => {
    const d = ds();
    const defs = defaultAssumptions(d, "A", 2025);
    const assumptions = Object.fromEntries(defs.map((x) => [x.key, x.value]));
    return buildModelInputs({ ds: d, companyId: "A", peerIds: ["P1", "P2"], names, fyTo: 2025, assumptions });
  };
  it("balances every forecast year and is reproducible", () => {
    const inp = build();
    const out1 = runModel(inp);
    const out2 = runModel(JSON.parse(JSON.stringify(inp)));
    expect(out1.checks.balanced).toBe(true);
    expect(out1).toEqual(out2);
    expect(out1.years).toEqual(["FY2026E", "FY2027E", "FY2028E", "FY2029E", "FY2030E"]);
  });
  it("matches an independent float DCF to 0.01%", () => {
    const inp = build();
    const out = runModel(inp);
    const a = Object.fromEntries(Object.entries(inp.assumptions).map(([k, v]) => [k, Number(v)]));
    const b = Object.fromEntries(Object.entries(inp.base).map(([k, v]) => [k, Number(v.value)]));
    let rev = b.revenue, nwc = b.nwc, pv = 0, last = 0;
    for (let t = 1; t <= 5; t++) {
      rev *= 1 + a.revenue_growth;
      const ebit = rev * a.ebitda_margin - rev * a.dep_pct_revenue;
      const n2 = rev * a.nwc_pct_revenue;
      const f = ebit * (1 - a.tax_rate) + rev * a.dep_pct_revenue - rev * a.capex_pct_revenue - (n2 - nwc);
      nwc = n2;
      pv += f / Math.pow(1 + a.wacc, t);
      last = f;
    }
    const tv = (last * (1 + a.terminal_growth)) / (a.wacc - a.terminal_growth) / Math.pow(1 + a.wacc, 5);
    const perShare = (pv + tv - b.total_debt + b.cash) / b.shares;
    const rel = Math.abs(Number(out.dcf.per_share) / perShare - 1);
    expect(rel).toBeLessThan(0.0001);
  });
  it("produces a 5x5 sensitivity grid with the base case in the centre", () => {
    const out = runModel(build());
    expect(out.sensitivity.grid[2][2]).toBe(out.dcf.per_share);
    expect(out.comps.pe).not.toBeNull();
  });
  it("rejects WACC at or below terminal growth", () => {
    const inp = build();
    inp.assumptions.wacc = "0.04";
    expect(() => runModel(inp)).toThrow();
  });
});
