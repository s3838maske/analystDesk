// Standard chart of accounts (VAL-01) for non-financial companies. Banks/NBFCs/insurers are out of the MVP.
// Sign convention: everything positive except cash-flow items, which carry their natural sign
// (capex and investing outflows negative).

export const MAPPING_VERSION = "coa-v1";

export type Statement = "IS" | "BS" | "CF" | "MKT";

export interface LineItemDef {
  key: string;
  label: string;
  statement: Statement;
  /** expected sign: "pos" must be >= 0, "neg" must be <= 0, "any" not checked */
  sign: "pos" | "neg" | "any";
  /** core items must be present for every annual period of the subject company */
  core?: boolean;
  /** unit kind: money values are scaled by crore/lakh/etc; count and perShare are handled separately */
  kind?: "money" | "count" | "perShare";
  synonyms: string[];
}

export const LINE_ITEMS: LineItemDef[] = [
  // Income statement
  { key: "revenue", label: "Revenue from operations", statement: "IS", sign: "pos", core: true, synonyms: ["revenue", "revenue from operations", "net sales", "sales", "total revenue from operations", "net revenue", "turnover", "income from operations"] },
  { key: "other_income", label: "Other income", statement: "IS", sign: "any", synonyms: ["other income", "non operating income"] },
  { key: "cogs", label: "Cost of goods sold", statement: "IS", sign: "pos", synonyms: ["cost of goods sold", "cogs", "cost of materials consumed", "cost of sales", "material cost", "raw material cost", "cost of revenue"] },
  { key: "employee_cost", label: "Employee benefit expense", statement: "IS", sign: "pos", synonyms: ["employee benefit expense", "employee benefits expense", "employee cost", "staff cost", "personnel expenses"] },
  { key: "other_expenses", label: "Other expenses", statement: "IS", sign: "pos", synonyms: ["other expenses", "other operating expenses", "sg&a", "selling general and administrative"] },
  { key: "depreciation", label: "Depreciation and amortisation", statement: "IS", sign: "pos", core: true, synonyms: ["depreciation", "depreciation and amortisation", "depreciation and amortization", "depreciation and amortisation expense", "d&a"] },
  { key: "finance_cost", label: "Finance costs", statement: "IS", sign: "pos", synonyms: ["finance cost", "finance costs", "interest", "interest expense", "interest cost"] },
  { key: "pbt", label: "Profit before tax", statement: "IS", sign: "any", core: true, synonyms: ["profit before tax", "pbt", "profit before taxes", "profit/(loss) before tax"] },
  { key: "tax", label: "Tax expense", statement: "IS", sign: "any", synonyms: ["tax", "tax expense", "total tax expense", "income tax", "provision for tax"] },
  { key: "pat", label: "Profit after tax", statement: "IS", sign: "any", core: true, synonyms: ["profit after tax", "pat", "net profit", "profit for the year", "profit for the period", "net income", "profit/(loss) for the period"] },

  // Balance sheet
  { key: "cash", label: "Cash and bank balances", statement: "BS", sign: "pos", core: true, synonyms: ["cash", "cash and cash equivalents", "cash and bank balances", "cash & bank", "cash and bank"] },
  { key: "receivables", label: "Trade receivables", statement: "BS", sign: "pos", synonyms: ["trade receivables", "receivables", "debtors", "sundry debtors", "accounts receivable"] },
  { key: "inventory", label: "Inventories", statement: "BS", sign: "pos", synonyms: ["inventories", "inventory", "stock in trade", "stocks"] },
  { key: "other_current_assets", label: "Other current assets", statement: "BS", sign: "pos", synonyms: ["other current assets", "loans and advances", "short term loans and advances", "other financial assets current"] },
  { key: "net_fixed_assets", label: "Net fixed assets (incl. CWIP, intangibles)", statement: "BS", sign: "pos", core: true, synonyms: ["net fixed assets", "property plant and equipment", "property, plant and equipment", "fixed assets", "net block", "ppe"] },
  { key: "investments", label: "Investments", statement: "BS", sign: "pos", synonyms: ["investments", "non current investments", "current investments"] },
  { key: "other_non_current_assets", label: "Other non-current assets", statement: "BS", sign: "pos", synonyms: ["other non current assets", "other non-current assets", "deferred tax assets"] },
  { key: "total_assets", label: "Total assets", statement: "BS", sign: "pos", core: true, synonyms: ["total assets"] },
  { key: "equity", label: "Total equity", statement: "BS", sign: "any", core: true, synonyms: ["total equity", "equity", "shareholders funds", "shareholders' funds", "net worth", "total shareholders equity"] },
  { key: "minority_interest", label: "Non-controlling interest", statement: "BS", sign: "any", synonyms: ["minority interest", "non controlling interest", "non-controlling interest"] },
  { key: "borrowings_long", label: "Long-term borrowings", statement: "BS", sign: "pos", synonyms: ["long term borrowings", "long-term borrowings", "non current borrowings", "borrowings non current"] },
  { key: "borrowings_short", label: "Short-term borrowings", statement: "BS", sign: "pos", synonyms: ["short term borrowings", "short-term borrowings", "current borrowings", "borrowings current"] },
  { key: "payables", label: "Trade payables", statement: "BS", sign: "pos", synonyms: ["trade payables", "payables", "creditors", "sundry creditors", "accounts payable"] },
  { key: "other_current_liabilities", label: "Other current liabilities", statement: "BS", sign: "pos", synonyms: ["other current liabilities", "provisions current", "short term provisions"] },
  { key: "other_non_current_liabilities", label: "Other non-current liabilities", statement: "BS", sign: "pos", synonyms: ["other non current liabilities", "other non-current liabilities", "long term provisions", "deferred tax liabilities"] },
  { key: "total_equity_liabilities", label: "Total equity and liabilities", statement: "BS", sign: "pos", core: true, synonyms: ["total equity and liabilities", "total liabilities and equity", "total liabilities", "total equity & liabilities"] },

  // Cash flow
  { key: "cfo", label: "Cash flow from operations", statement: "CF", sign: "any", core: true, synonyms: ["cash flow from operations", "net cash from operating activities", "cash from operating activities", "cfo", "net cash generated from operating activities"] },
  { key: "capex", label: "Capital expenditure", statement: "CF", sign: "neg", synonyms: ["capex", "capital expenditure", "purchase of property plant and equipment", "purchase of fixed assets"] },
  { key: "cfi", label: "Cash flow from investing", statement: "CF", sign: "any", core: true, synonyms: ["cash flow from investing", "net cash used in investing activities", "cash from investing activities", "cfi"] },
  { key: "cff", label: "Cash flow from financing", statement: "CF", sign: "any", core: true, synonyms: ["cash flow from financing", "net cash used in financing activities", "cash from financing activities", "cff"] },
  { key: "net_change_cash", label: "Net change in cash", statement: "CF", sign: "any", synonyms: ["net change in cash", "net increase in cash", "net increase/(decrease) in cash and cash equivalents", "net cash flow"] },
  { key: "opening_cash", label: "Opening cash", statement: "CF", sign: "pos", synonyms: ["opening cash", "cash at beginning of the year", "opening cash and cash equivalents"] },
  { key: "closing_cash", label: "Closing cash", statement: "CF", sign: "pos", synonyms: ["closing cash", "cash at end of the year", "closing cash and cash equivalents"] },

  // Market data
  { key: "price", label: "Share price (close)", statement: "MKT", sign: "pos", kind: "perShare", synonyms: ["close", "closing price", "price", "share price", "close price"] },
  { key: "shares_outstanding", label: "Shares outstanding", statement: "MKT", sign: "pos", kind: "count", synonyms: ["shares outstanding", "number of shares", "no of shares", "shares"] },
];

export const LINE_ITEM_BY_KEY: Record<string, LineItemDef> = Object.fromEntries(LINE_ITEMS.map((l) => [l.key, l]));

export function normLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, (m) => (/(loss|decrease)/.test(m) ? m : " "))
    .replace(/[^a-z0-9&/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Suggest a standard line item for a source label (VAL-01). Exact key or synonym match only — no guessing. */
export function suggestLineItem(label: string): string | null {
  const n = normLabel(label);
  if (!n) return null;
  if (LINE_ITEM_BY_KEY[n.replace(/ /g, "_")]) return n.replace(/ /g, "_");
  for (const li of LINE_ITEMS) {
    if (normLabel(li.label) === n) return li.key;
    if (li.synonyms.some((s) => normLabel(s) === n)) return li.key;
  }
  return null;
}

export const STATEMENT_NAMES: Record<Statement, string> = {
  IS: "Income statement",
  BS: "Balance sheet",
  CF: "Cash flow",
  MKT: "Market data",
};
