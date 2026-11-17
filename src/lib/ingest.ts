// ING-01..03: parse uploaded spreadsheets into standard line items.
// Two layouts: LONG (our standard template, one value per row) and WIDE (line items down, periods across),
// plus PRICES (date, close, shares). PDFs and XBRL files are stored unchanged but not parsed in the MVP.
import * as XLSX from "xlsx";
import { D, Decimal, parseDecimal } from "./decimal";
import { LINE_ITEM_BY_KEY, suggestLineItem, MAPPING_VERSION } from "./coa";
import { normUnit, toBase } from "./units";
import { parsePeriodHeader } from "./periods";

export interface Sheet {
  name: string;
  rows: unknown[][];
}

export function readWorkbook(buf: Buffer): Sheet[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false, dense: true });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }),
  }));
}

export function isSpreadsheet(fileName: string) {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(fileName);
}

export function cellRef(sheet: string, row: number, col: number) {
  return `${sheet}!${XLSX.utils.encode_cell({ r: row, c: col })}`;
}

export interface ParsedValue {
  companyId: string;
  period: string;
  lineItem: string;
  value: string;
  rawValue: string;
  rawUnit: string;
  rawLabel: string;
  sourceRef: string;
}

export interface ParseResult {
  values: ParsedValue[];
  errors: string[];
  unmappedLabels: string[];
}

function scale(lineItem: string, raw: Decimal, unit: string, fx: string): Decimal {
  const kind = LINE_ITEM_BY_KEY[lineItem]?.kind ?? "money";
  if (kind === "perShare") return raw.mul(D(fx));
  if (kind === "count") return toBase(raw, unit, 1);
  return toBase(raw, unit, fx);
}

const LONG_HEADERS = ["company", "line item", "period", "value"];

export function detectLayout(sheets: Sheet[]): { layout: "LONG" | "WIDE" | "PRICES"; sheet: string; headerRow: number } {
  for (const s of sheets) {
    for (let r = 0; r < Math.min(15, s.rows.length); r++) {
      const hdr = (s.rows[r] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
      if (LONG_HEADERS.every((h) => hdr.includes(h))) return { layout: "LONG", sheet: s.name, headerRow: r };
      if (hdr.includes("date") && (hdr.includes("close") || hdr.includes("closing price") || hdr.includes("price"))) return { layout: "PRICES", sheet: s.name, headerRow: r };
    }
  }
  return { layout: "WIDE", sheet: sheets[0]?.name ?? "", headerRow: guessWideHeaderRow(sheets[0]) };
}

function guessWideHeaderRow(s?: Sheet): number {
  if (!s) return 0;
  let best = 0, bestCount = 0;
  for (let r = 0; r < Math.min(20, s.rows.length); r++) {
    const n = (s.rows[r] ?? []).filter((c) => parsePeriodHeader(c) || parsePeriodHeader(c, true)).length;
    if (n > bestCount) { best = r; bestCount = n; }
  }
  return best;
}

/** Standard template: Company (NSE code) | Statement | Line item | Period | Value | Unit | Currency | FX to INR */
export function parseLong(sheet: Sheet, headerRow: number, companiesByCode: Record<string, string>, allowedCompanyIds: Set<string>): ParseResult {
  const hdr = (sheet.rows[headerRow] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
  const col = (n: string) => hdr.indexOf(n);
  const [cC, cL, cP, cV, cU, cCur, cFx] = [col("company"), col("line item"), col("period"), col("value"), col("unit"), col("currency"), col("fx to inr")];
  const out: ParseResult = { values: [], errors: [], unmappedLabels: [] };
  const unmapped = new Set<string>();
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (row.every((c) => c === null || String(c).trim() === "")) continue;
    const code = String(row[cC] ?? "").trim().toUpperCase();
    const companyId = companiesByCode[code];
    const label = String(row[cL] ?? "").trim();
    const period = parsePeriodHeader(row[cP], /^Q/i.test(String(row[cP] ?? ""))) ?? (String(row[cP] ?? "").trim().toUpperCase().match(/^Q[1-4]FY\d{2}$/) ? String(row[cP]).trim().toUpperCase() : null);
    const raw = parseDecimal(row[cV]);
    const unit = normUnit(cU >= 0 ? String(row[cU] ?? "") : "crore") ?? null;
    const currency = cCur >= 0 ? String(row[cCur] ?? "INR").trim().toUpperCase() || "INR" : "INR";
    const fx = cFx >= 0 ? parseDecimal(row[cFx]) : null;
    const where = `row ${r + 1}`;
    if (!companyId) { out.errors.push(`${where}: unknown company code "${code}"`); continue; }
    if (!allowedCompanyIds.has(companyId)) { out.errors.push(`${where}: ${code} is not the subject or a peer in this analysis`); continue; }
    const lineItem = LINE_ITEM_BY_KEY[label] ? label : suggestLineItem(label);
    if (!lineItem) { unmapped.add(label); continue; }
    if (!period) { out.errors.push(`${where}: cannot read period "${row[cP]}"`); continue; }
    if (raw === null) continue;
    if (!unit) { out.errors.push(`${where}: unknown unit "${row[cU]}"`); continue; }
    if (currency !== "INR" && !fx) { out.errors.push(`${where}: ${currency} value needs an FX to INR rate`); continue; }
    out.values.push({
      companyId, period, lineItem,
      value: scale(lineItem, raw, unit, currency === "INR" ? "1" : fx!.toString()).toString(),
      rawValue: raw.toString(), rawUnit: currency === "INR" ? unit : `${currency} ${unit} @${fx}`, rawLabel: label,
      sourceRef: cellRef(sheet.name, r, cV),
    });
  }
  out.unmappedLabels = [...unmapped];
  return out;
}

export interface WideConfig {
  sheet: string;
  headerRow: number;
  labelCol: number;
  quarterly: boolean;
  unit: string;
  currency: string;
  fx: string;
  companyId: string;
  /** column index → period label */
  periodCols: Record<string, string>;
  /** source label → line item key, or "ignore" */
  labelMap: Record<string, string>;
}

export function wideLabels(sheet: Sheet, headerRow: number, labelCol: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const l = String(sheet.rows[r]?.[labelCol] ?? "").trim();
    if (l && !seen.has(l)) { seen.add(l); out.push(l); }
  }
  return out;
}

export function widePeriodCols(sheet: Sheet, headerRow: number, quarterly: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  (sheet.rows[headerRow] ?? []).forEach((c, i) => {
    const p = parsePeriodHeader(c, quarterly);
    if (p) out[String(i)] = p;
  });
  return out;
}

export function parseWide(sheet: Sheet, cfg: WideConfig): ParseResult {
  const out: ParseResult = { values: [], errors: [], unmappedLabels: [] };
  const unit = normUnit(cfg.unit);
  if (!unit) return { ...out, errors: [`Unknown unit "${cfg.unit}"`] };
  const fx = cfg.currency === "INR" ? "1" : cfg.fx;
  if (cfg.currency !== "INR" && !parseDecimal(cfg.fx)) return { ...out, errors: [`${cfg.currency} values need an FX to INR rate`] };
  const unmapped = new Set<string>();
  const seen = new Set<string>();
  for (let r = cfg.headerRow + 1; r < sheet.rows.length; r++) {
    const label = String(sheet.rows[r]?.[cfg.labelCol] ?? "").trim();
    if (!label) continue;
    const key = cfg.labelMap[label];
    if (!key) { unmapped.add(label); continue; }
    if (key === "ignore") continue;
    for (const [ci, period] of Object.entries(cfg.periodCols)) {
      const raw = parseDecimal(sheet.rows[r]?.[Number(ci)]);
      if (raw === null) continue;
      const k = `${period}|${key}`;
      if (seen.has(k)) { out.errors.push(`${label} (${period}): ${LINE_ITEM_BY_KEY[key].label} mapped twice; first value kept`); continue; }
      seen.add(k);
      out.values.push({
        companyId: cfg.companyId, period, lineItem: key,
        value: scale(key, raw, unit, fx).toString(),
        rawValue: raw.toString(), rawUnit: cfg.currency === "INR" ? unit : `${cfg.currency} ${unit} @${fx}`, rawLabel: label,
        sourceRef: cellRef(sheet.name, r, Number(ci)),
      });
    }
  }
  out.unmappedLabels = [...unmapped];
  return out;
}

export interface PriceConfig {
  sheet: string;
  headerRow: number;
  companyId: string;
}

/** Price file: Date | Close | Shares outstanding (optional) | Company (optional NSE code) */
export function parsePrices(sheet: Sheet, cfg: PriceConfig, companiesByCode: Record<string, string>, allowed: Set<string>): ParseResult {
  const hdr = (sheet.rows[cfg.headerRow] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
  const find = (...ns: string[]) => hdr.findIndex((h) => ns.includes(h));
  const cD = find("date"), cC = find("close", "closing price", "price", "close price"), cS = find("shares outstanding", "shares", "no of shares"), cCo = find("company", "nse", "symbol");
  const out: ParseResult = { values: [], errors: [], unmappedLabels: [] };
  if (cD < 0 || cC < 0) return { ...out, errors: ["Price file needs Date and Close columns"] };
  for (let r = cfg.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (row[cD] === null || row[cD] === undefined || String(row[cD]).trim() === "") continue;
    const date = toIsoDate(row[cD]);
    if (!date) { out.errors.push(`row ${r + 1}: cannot read date "${row[cD]}"`); continue; }
    let companyId = cfg.companyId;
    if (cCo >= 0 && row[cCo]) {
      companyId = companiesByCode[String(row[cCo]).trim().toUpperCase()];
      if (!companyId || !allowed.has(companyId)) { out.errors.push(`row ${r + 1}: company "${row[cCo]}" not in this analysis`); continue; }
    }
    const close = parseDecimal(row[cC]);
    if (close) out.values.push({ companyId, period: `D${date}`, lineItem: "price", value: close.toString(), rawValue: close.toString(), rawUnit: "INR/share", rawLabel: String(hdr[cC]), sourceRef: cellRef(sheet.name, r, cC) });
    const shares = cS >= 0 ? parseDecimal(row[cS]) : null;
    if (shares) out.values.push({ companyId, period: `D${date}`, lineItem: "shares_outstanding", value: shares.toString(), rawValue: shares.toString(), rawUnit: "shares", rawLabel: String(hdr[cS]), sourceRef: cellRef(sheet.name, r, cS) });
  }
  return out;
}

function toIsoDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // SheetJS dates are local midnight; shift to avoid timezone day-slip
    const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s); // dd-mm-yyyy (Indian convention)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/.exec(s);
  if (m) {
    const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
    if (mon >= 0) return `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export { MAPPING_VERSION };

/** ING-03: the standard upload template. */
export function buildTemplate(): Buffer {
  const wb = XLSX.utils.book_new();
  const data: unknown[][] = [
    ["Company", "Statement", "Line item", "Period", "Value", "Unit", "Currency", "FX to INR"],
    ["DEMOALPHA", "IS", "revenue", "FY2025", 1300, "crore", "INR", ""],
    ["DEMOALPHA", "IS", "pat", "FY2025", 180.5, "crore", "INR", ""],
    ["DEMOALPHA", "BS", "total_assets", "FY2025", 1500, "crore", "INR", ""],
    ["DEMOALPHA", "IS", "revenue", "Q1FY26", 340, "crore", "INR", ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Data");
  const keys: unknown[][] = [["Line item key", "Label", "Statement", "Expected sign"]];
  for (const li of Object.values(LINE_ITEM_BY_KEY)) keys.push([li.key, li.label, li.statement, li.sign]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(keys), "Line items");
  const help: unknown[][] = [
    ["How to use this template"],
    ["One value per row. Company = NSE code. Period = FY2025 (Apr 2024–Mar 2025) or Q1FY26."],
    ["Line item = a key from the 'Line items' sheet, or a common label such as 'Revenue from operations'."],
    ["Unit = crore, lakh, million, thousand or units. Shares outstanding: give the unit of the share count."],
    ["Cash-flow outflows (capex, investing) are negative. Everything else positive as reported."],
    ["Currency other than INR needs an FX to INR rate on the row."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), "Help");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
