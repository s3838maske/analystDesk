// Print-ready HTML for a rendered report (used for PDF export).
import type { Block, RenderedSection, Run } from "./report";
import { chartSvg } from "./charts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runs(rs: Run[]) {
  return rs.map((r) => (r.token ? `<span class="num">${esc(r.text)}</span>` : esc(r.text))).join("");
}

function block(b: Block): string {
  switch (b.type) {
    case "p":
      return `<p>${runs(b.runs)}</p>`;
    case "bullets":
      return `<ul>${b.items.map((i) => `<li>${runs(i)}</li>`).join("")}</ul>`;
    case "table":
      return `<figure><figcaption>${esc(b.title)}</figcaption><table><thead><tr>${b.header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr${r.emphasis ? ' class="em"' : ""}>${r.cells.map((c, i) => (i === 0 ? `<th>${esc(c.text)}</th>` : `<td>${esc(c.text)}</td>`)).join("")}</tr>`)
        .join("")}</tbody></table>${b.note ? `<p class="note">${esc(b.note)}</p>` : ""}</figure>`;
    case "chart":
      return `<figure class="chart">${chartSvg(b.chart)}</figure>`;
    default:
      return `<p class="missing">[${esc(b.token)} not available]</p>`;
  }
}

export function reportHtml(meta: { title: string; subtitle: string; status: string }, sections: RenderedSection[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(meta.title)}</title><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Inter, Arial, sans-serif; color: #111827; font-size: 10.5pt; line-height: 1.45; }
  h1 { font-size: 20pt; margin: 0 0 4px; } .sub { color: #6b7280; margin-bottom: 18px; }
  .status { display:inline-block; font-size: 8.5pt; padding: 2px 8px; border-radius: 10px; background:#eef2ff; color:#3730a3; }
  h2 { font-size: 13pt; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-top: 22px; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; font-size: 8.5pt; font-variant-numeric: tabular-nums; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 3px 6px; text-align: right; } th:first-child, tbody th { text-align: left; font-weight: 500; }
  thead th { background: #f9fafb; font-weight: 600; } tr.em td, tr.em th { background: #eff6ff; font-weight: 600; }
  figure { margin: 10px 0; page-break-inside: avoid; } figcaption { font-weight: 600; margin-bottom: 4px; font-size: 9.5pt; }
  .note { color: #6b7280; font-size: 8pt; margin: 4px 0 0; } .missing { color: #b91c1c; } .chart svg { max-width: 100%; height: auto; }
  </style></head><body>
  <h1>${esc(meta.title)}</h1><div class="sub">${esc(meta.subtitle)} <span class="status">${esc(meta.status)}</span></div>
  ${sections.map((s) => `<section><h2>${esc(s.title)}</h2>${s.blocks.length ? s.blocks.map(block).join("") : '<p class="missing">(empty)</p>'}</section>`).join("")}
  </body></html>`;
}
