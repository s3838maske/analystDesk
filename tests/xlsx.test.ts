// MOD-07 check: recalculate the exported workbook's live formulas with an independent formula engine
// and compare with the app's decimal model (NFR-01: within 0.01%).
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { HyperFormula } from "hyperformula";
import { Dataset } from "../src/lib/dataset";
import { buildModelInputs, defaultAssumptions, runModel } from "../src/lib/model";
import { buildModelWorkbook } from "../src/lib/export-xlsx";
import { demoCompany, rows } from "./fixtures";

async function recalc(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: Record<string, (string | number | null)[][]> = {};
  wb.eachSheet((ws) => {
    const grid: (string | number | null)[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const line: (string | number | null)[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v = cell.value as unknown;
        if (v && typeof v === "object" && "formula" in (v as object)) line[c - 1] = "=" + (v as { formula: string }).formula;
        else line[c - 1] = (typeof v === "number" || typeof v === "string" ? v : null);
      });
      grid[r - 1] = line;
    });
    sheets[ws.name] = Array.from({ length: grid.length }, (_, i) => grid[i] ?? []);
  });
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3", useArrayArithmetic: true });
  return (sheet: string, addr: string) => {
    const id = hf.getSheetId(sheet)!;
    const a = hf.simpleCellAddressFromString(addr, id)!;
    return hf.getCellValue(a);
  };
}

describe("xlsx export", () => {
  it("live formulas reproduce the app's DCF, forecast and sensitivity", async () => {
    const ds = new Dataset([...rows("A", demoCompany(1)), ...rows("P1", demoCompany(0.8)), ...rows("P2", demoCompany(1.3))]);
    const defs = defaultAssumptions(ds, "A", 2025);
    const assumptions = Object.fromEntries(defs.map((x) => [x.key, x.value]));
    assumptions.payout_ratio = "0.2";
    const inputs = buildModelInputs({ ds, companyId: "A", peerIds: ["P1", "P2"], names: { A: "A", P1: "P1", P2: "P2" }, fyTo: 2025, assumptions });
    const outputs = runModel(inputs);
    const buf = await buildModelWorkbook({ companyName: "A", companyId: "A", periods: ["FY2023", "FY2024", "FY2025"], ds, inputs, outputs, runId: "t", runAt: new Date() });
    const get = await recalc(buf);
    const close = (a: unknown, b: string, scale = 1) => expect(Math.abs((a as number) / (Number(b) / scale) - 1)).toBeLessThan(1e-4);
    close(get("DCF", "B10"), outputs.dcf.per_share);
    close(get("DCF", "B5"), outputs.dcf.enterprise_value, 1e7);
    close(get("Forecast", "G2"), outputs.forecast["FY2030E"].revenue, 1e7);
    close(get("Forecast", "G20"), outputs.forecast["FY2030E"].cash, 1e7);
    for (const c of ["C21", "D21", "E21", "F21", "G21"]) expect(Math.abs(get("Forecast", c) as number)).toBeLessThan(1e-6);
    close(get("Sensitivity", "B3"), outputs.sensitivity.grid[0][0]!);
    close(get("Sensitivity", "D5"), outputs.dcf.per_share);
  });
});
