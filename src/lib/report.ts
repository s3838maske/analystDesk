// REP-01..03: report template, {{token}} resolution and rendering into blocks.
// Numbers in the text are tokens linked to the latest model run, so they update when the model re-runs.

export interface SectionDef {
  key: string;
  title: string;
  body: string;
  /** auto-drafted by the system (REP-01) vs. left empty for the analyst (REP-02) */
  analystOnly: boolean;
}

export const REPORT_TEMPLATE_VERSION = "report-template-v1";

export const DEFAULT_SECTIONS: SectionDef[] = [
  {
    key: "overview",
    title: "Company overview",
    analystOnly: false,
    body:
      "{{company.name}} (NSE: {{company.nse}}) operates in the {{company.sector}} sector. This report covers {{period.range}} and compares the company with {{peers.list}}.\n\n" +
      "In {{base.year}}, revenue was ₹{{fin.revenue}} crore, the EBITDA margin was {{ratio.ebitda_margin}} and profit after tax was ₹{{fin.pat}} crore.",
  },
  {
    key: "financial_summary",
    title: "Financial summary",
    analystOnly: false,
    body: "Revenue grew at a compound annual rate of {{fin.revenue_cagr}} from {{period.first}} to {{base.year}}.\n\n{{table:financials}}\n\n{{chart:revenue_pat}}",
  },
  {
    key: "ratios",
    title: "Ratios and peer comparison",
    analystOnly: false,
    body: "{{table:ratios}}\n\nThe table below compares {{base.year}} ratios with the peer set.\n\n{{table:peers}}",
  },
  {
    key: "valuation",
    title: "Valuation",
    analystOnly: false,
    body:
      "The DCF gives a value of ₹{{dcf.per_share}} per share against a current price of ₹{{price.current}} ({{dcf.upside}} difference), using a WACC of {{asm.wacc}} and terminal growth of {{asm.terminal_growth}}. Trading comparables imply ₹{{comps.low}} to ₹{{comps.high}} per share.\n\n" +
      "{{table:dcf}}\n\n{{table:sensitivity}}\n\n{{table:comps}}\n\n{{chart:valuation}}",
  },
  { key: "conclusion", title: "Conclusion", analystOnly: true, body: "" },
  { key: "recommendation", title: "Recommendation", analystOnly: true, body: "" },
  { key: "risks", title: "Key risks", analystOnly: true, body: "" },
  {
    key: "disclosure",
    title: "Disclosure",
    analystOnly: false,
    body:
      "This report was prepared by {{analyst.name}} using AnalystDesk, an internal tool that checks uploaded financial data, calculates ratios and builds a valuation model from assumptions set by the analyst. The conclusion, recommendation and risks were written by the analyst; the tool does not generate investment calls. The analyst is responsible for this research. {{approval}}",
  },
];

export type Section = SectionDef;

export interface TokenValue {
  text: string;
  /** lineage key, when the value is traceable */
  ref?: string;
}

export interface TableBlock {
  type: "table";
  title: string;
  header: string[];
  rows: { cells: TokenValue[]; emphasis?: boolean }[];
  note?: string;
}

export interface ChartSpec {
  title: string;
  kind: "bar" | "range";
  unit: string;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  /** for kind=range: [low, high] per label and a marker line value */
  ranges?: { label: string; low: number; high: number }[];
  marker?: { label: string; value: number };
}

export type Run = { text: string; ref?: string; token?: string };
export type Block =
  | { type: "p"; runs: Run[] }
  | { type: "bullets"; items: Run[][] }
  | TableBlock
  | { type: "chart"; chart: ChartSpec }
  | { type: "missing"; token: string };

export interface RenderContext {
  values: Record<string, TokenValue>;
  tables: Record<string, TableBlock>;
  charts: Record<string, ChartSpec>;
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;

export function renderRuns(text: string, ctx: RenderContext): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) runs.push({ text: text.slice(last, m.index) });
    const v = ctx.values[m[1]];
    runs.push(v ? { text: v.text, ref: v.ref, token: m[1] } : { text: `[missing: ${m[1]}]`, token: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

export function renderBody(body: string, ctx: RenderContext): Block[] {
  const blocks: Block[] = [];
  for (const para of body.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    const only = /^\{\{\s*(table|chart):([a-z_]+)\s*\}\}$/.exec(p);
    if (only) {
      const key = only[2];
      if (only[1] === "table") blocks.push(ctx.tables[key] ?? { type: "missing", token: `table:${key}` });
      else blocks.push(ctx.charts[key] ? { type: "chart", chart: ctx.charts[key] } : { type: "missing", token: `chart:${key}` });
      continue;
    }
    const lines = p.split("\n");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      blocks.push({ type: "bullets", items: lines.map((l) => renderRuns(l.replace(/^\s*[-•]\s+/, ""), ctx)) });
    } else {
      blocks.push({ type: "p", runs: renderRuns(lines.join(" "), ctx) });
    }
  }
  return blocks;
}

export interface RenderedSection {
  key: string;
  title: string;
  blocks: Block[];
}

export function renderReport(sections: Section[], ctx: RenderContext): RenderedSection[] {
  return sections.map((s) => ({ key: s.key, title: s.title, blocks: renderBody(s.body, ctx) }));
}

/** Plain-text form of a rendered section, for change logs and version comparison. */
export function sectionText(s: RenderedSection): string {
  return s.blocks
    .map((b) => {
      if (b.type === "p") return b.runs.map((r) => r.text).join("");
      if (b.type === "bullets") return b.items.map((i) => "• " + i.map((r) => r.text).join("")).join("\n");
      if (b.type === "table") return `[Table: ${b.title}]\n` + [b.header.join(" | "), ...b.rows.map((r) => r.cells.map((c) => c.text).join(" | "))].join("\n");
      if (b.type === "chart") return `[Chart: ${b.chart.title}]`;
      return `[missing: ${b.token}]`;
    })
    .join("\n\n");
}

export interface ChangeLog {
  values: { token: string; before: string | null; after: string | null }[];
  sections: { key: string; title: string; before: string; after: string; lines: { op: "same" | "add" | "del"; text: string }[] }[];
}

/** REV-06: what changed between two submitted versions. */
export function diffVersions(
  before: { sections: { key: string; title: string; text: string }[]; values: Record<string, string> },
  after: { sections: { key: string; title: string; text: string }[]; values: Record<string, string> },
): ChangeLog {
  const tokens = new Set([...Object.keys(before.values), ...Object.keys(after.values)]);
  const values = [...tokens]
    .filter((t) => before.values[t] !== after.values[t])
    .sort()
    .map((t) => ({ token: t, before: before.values[t] ?? null, after: after.values[t] ?? null }));
  const sections: ChangeLog["sections"] = [];
  for (const s of after.sections) {
    const b = before.sections.find((x) => x.key === s.key);
    const bt = b?.text ?? "";
    if (bt === s.text) continue;
    sections.push({ key: s.key, title: s.title, before: bt, after: s.text, lines: lineDiff(bt.split("\n"), s.text.split("\n")) });
  }
  return { values, sections };
}

/** Minimal LCS line diff. */
export function lineDiff(a: string[], b: string[]): { op: "same" | "add" | "del"; text: string }[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: "same" | "add" | "del"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "del", text: a[i++] });
    else out.push({ op: "add", text: b[j++] });
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

export function tokenList(ctx: RenderContext): string[] {
  return [...Object.keys(ctx.values).sort(), ...Object.keys(ctx.tables).map((t) => `table:${t}`), ...Object.keys(ctx.charts).map((c) => `chart:${c}`)];
}
