// REP-04: Word and PDF export. PDF and chart images use a local Chrome/Chromium (CHROME_PATH).
import "server-only";
import fs from "fs";
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import type { RenderedSection, Run, TableBlock } from "@/lib/report";
import { chartSvg } from "@/lib/charts";
import { reportHtml } from "@/lib/report-html";

function chromePath(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function withBrowser<T>(fn: (b: import("puppeteer-core").Browser) => Promise<T>): Promise<T | null> {
  const exe = chromePath();
  if (!exe) return null;
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function exportPdf(meta: { title: string; subtitle: string; status: string }, sections: RenderedSection[]): Promise<Buffer> {
  const html = reportHtml(meta, sections);
  const pdf = await withBrowser(async (b) => {
    const page = await b.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: `<div style="font-size:8px;color:#6b7280;width:100%;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" } }));
  });
  if (!pdf) throw new Error("PDF export needs Chrome or Chromium on this machine. Set CHROME_PATH in .env.");
  return pdf;
}

async function rasterise(svgs: string[]): Promise<(Buffer | null)[]> {
  if (!svgs.length) return [];
  const out = await withBrowser(async (b) => {
    const page = await b.newPage();
    await page.setViewport({ width: 640, height: 400, deviceScaleFactor: 2 });
    const res: Buffer[] = [];
    for (const svg of svgs) {
      await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
      const el = await page.$("svg");
      res.push(Buffer.from(await el!.screenshot({ type: "png" })));
    }
    return res;
  });
  return out ?? svgs.map(() => null);
}

const runsToText = (rs: Run[]) => rs.map((r) => new TextRun({ text: r.text }));

function docxTable(t: TableBlock): (Paragraph | Table)[] {
  const border = { style: BorderStyle.SINGLE, size: 2, color: "E5E7EB" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text: string, header: boolean, first: boolean, em = false) =>
    new TableCell({
      borders,
      shading: header ? { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" } : em ? { type: ShadingType.CLEAR, fill: "EFF6FF", color: "auto" } : undefined,
      children: [new Paragraph({ alignment: first ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text, bold: header || em, size: 16 })] })],
    });
  return [
    new Paragraph({ children: [new TextRun({ text: t.title, bold: true, size: 19 })], spacing: { before: 160, after: 60 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: t.header.map((h, i) => cell(h, true, i === 0)) }),
        ...t.rows.map((r) => new TableRow({ children: r.cells.map((c, i) => cell(c.text, false, i === 0, r.emphasis)) })),
      ],
    }),
    ...(t.note ? [new Paragraph({ children: [new TextRun({ text: t.note, italics: true, size: 15, color: "6B7280" })], spacing: { after: 120 } })] : []),
  ];
}

export async function exportDocx(meta: { title: string; subtitle: string; status: string }, sections: RenderedSection[]): Promise<Buffer> {
  const charts = sections.flatMap((s) => s.blocks).filter((b) => b.type === "chart");
  const pngs = await rasterise(charts.map((c) => (c.type === "chart" ? chartSvg(c.chart) : "")));
  let ci = 0;
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: meta.title })] }),
    new Paragraph({ children: [new TextRun({ text: `${meta.subtitle} · ${meta.status}`, color: "6B7280" })], spacing: { after: 240 } }),
  ];
  for (const s of sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: s.title })] }));
    if (!s.blocks.length) children.push(new Paragraph({ children: [new TextRun({ text: "(empty)", italics: true, color: "B91C1C" })] }));
    for (const b of s.blocks) {
      if (b.type === "p") children.push(new Paragraph({ children: runsToText(b.runs), spacing: { after: 120 } }));
      else if (b.type === "bullets") for (const it of b.items) children.push(new Paragraph({ bullet: { level: 0 }, children: runsToText(it) }));
      else if (b.type === "table") children.push(...docxTable(b));
      else if (b.type === "chart") {
        const png = pngs[ci++];
        if (png) children.push(new Paragraph({ children: [new ImageRun({ type: "png", data: png, transformation: { width: 600, height: b.chart.kind === "range" ? Math.round(600 * ((40 + (b.chart.ranges?.length ?? 1) * 34 + 34) / 640)) : 262 } })] }));
        else children.push(new Paragraph({ children: [new TextRun({ text: `[Chart: ${b.chart.title} — install Chrome to include charts]`, italics: true })] }));
      } else children.push(new Paragraph({ children: [new TextRun({ text: `[${b.token} not available]`, color: "B91C1C" })] }));
    }
  }
  const doc = new Document({ creator: "AnalystDesk", title: meta.title, styles: { default: { document: { run: { font: "Calibri", size: 21 } } } }, sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
