"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { audit } from "@/server/audit";
import { afterDataChange, assertEdit, loadAnalysis } from "@/server/analysis";
import { importValues, readStoredWorkbook, storeUpload } from "@/server/ingest";
import { detectLayout, isSpreadsheet, parseLong, parsePrices, parseWide, WideConfig } from "@/lib/ingest";
import { parseDecimal } from "@/lib/decimal";
import { MAPPING_VERSION } from "@/lib/coa";

async function ctx(id: string) {
  const user = await requireUser(["ANALYST"]);
  const a = await loadAnalysis(id);
  return { user, a };
}

async function companyMaps(a: Awaited<ReturnType<typeof loadAnalysis>>) {
  const all = await prisma.company.findMany();
  const byCode: Record<string, string> = {};
  for (const c of all) {
    byCode[c.nse.toUpperCase()] = c.id;
    if (c.bse) byCode[c.bse] = c.id;
  }
  return { byCode, allowed: new Set([a.companyId, ...a.peerIdsArr]) };
}

const back = (id: string, q: Record<string, string>) => redirect(`/analyses/${id}/data?${new URLSearchParams(q)}`);

export async function uploadFile(id: string, formData: FormData) {
  const { user, a } = await ctx(id);
  const why = (await import("@/server/analysis")).lockReason(a, user, "DATA");
  if (why) back(id, { err: why });
  const file = formData.get("file") as File | null;
  const sourceLabel = String(formData.get("sourceLabel") ?? "").trim();
  const kind = String(formData.get("kind") ?? "FINANCIALS");
  const companyId = String(formData.get("companyId") ?? a.companyId);
  if (!file || file.size === 0) back(id, { err: "Choose a file first: press “Choose file” and pick the spreadsheet from your computer." });
  if (!sourceLabel) back(id, { err: "Say where the file came from in the Source box, for example \"Annual report FY25\" or \"terminal export\". This shows next to every number taken from it." });
  if (file!.size > 25 * 1024 * 1024) back(id, { err: "This file is bigger than 25 MB, which is the limit. Remove sheets you do not need or split it into smaller files, then try again." });

  const { rec, buf } = await storeUpload(a, user, file!, sourceLabel, kind);
  if (!isSpreadsheet(file!.name)) {
    await prisma.uploadedFile.update({ where: { id: rec.id }, data: { status: "STORED" } });
    back(id, { msg: `${file!.name} stored unchanged as a source document. Automatic extraction from PDF and XBRL is not in the pilot; enter its figures with the upload template or the mapping screen.` });
  }
  const { readWorkbook } = await import("@/lib/ingest");
  const sheets = readWorkbook(buf);
  const det = detectLayout(sheets);
  const { byCode, allowed } = await companyMaps(a);

  if (kind === "PRICES" || det.layout === "PRICES") {
    const sheet = sheets.find((s) => s.name === det.sheet)!;
    const res = parsePrices(sheet, { sheet: det.sheet, headerRow: det.layout === "PRICES" ? det.headerRow : 0, companyId }, byCode, allowed);
    if (!res.values.length) back(id, { err: `No prices read from ${file!.name}. ${res.errors.slice(0, 3).join(" ")}` });
    await importValues(a, user, rec.id, res.values, { layout: "PRICES", errors: res.errors.length });
    back(id, { msg: `Imported ${res.values.length} price values.${res.errors.length ? ` ${res.errors.length} rows skipped: ${res.errors.slice(0, 3).join("; ")}` : ""}` });
  }
  if (det.layout === "LONG") {
    const sheet = sheets.find((s) => s.name === det.sheet)!;
    const res = parseLong(sheet, det.headerRow, byCode, allowed);
    await importValues(a, user, rec.id, res.values, { layout: "LONG", errors: res.errors.length, unmapped: res.unmappedLabels });
    const warn = [
      res.unmappedLabels.length ? `Unrecognised line items skipped: ${res.unmappedLabels.slice(0, 6).join(", ")}.` : "",
      res.errors.length ? `${res.errors.length} rows skipped: ${res.errors.slice(0, 3).join("; ")}.` : "",
    ].filter(Boolean).join(" ");
    back(id, { msg: `Imported ${res.values.length} values from the standard template. ${warn}`.trim() });
  }
  // Other layouts go to the column-mapping screen (ING-03)
  redirect(`/analyses/${id}/data/${rec.id}`);
}

export async function applyMapping(id: string, fileId: string, cfgJson: string) {
  const { user, a } = await ctx(id);
  await assertEdit(a, user, "DATA");
  const cfg = JSON.parse(cfgJson) as WideConfig;
  const file = await prisma.uploadedFile.findFirstOrThrow({ where: { id: fileId, analysisId: id } });
  if (![a.companyId, ...a.peerIdsArr].includes(cfg.companyId)) throw new Error("Company is not part of this analysis");
  const sheets = await readStoredWorkbook(file.storedPath);
  const sheet = sheets.find((s) => s.name === cfg.sheet);
  if (!sheet) throw new Error("Sheet not found");
  const res = parseWide(sheet, cfg);
  if (res.errors.length && !res.values.length) return { error: res.errors.join("; ") };
  // ING-03: save the mapping for this source so the next file from it is pre-mapped
  const saved = await prisma.columnMapping.findUnique({ where: { sourceLabel: file.sourceLabel } });
  const stored = { ...cfg, companyId: undefined, periodCols: undefined };
  if (saved) await prisma.columnMapping.update({ where: { id: saved.id }, data: { config: JSON.stringify(stored), layout: "WIDE", version: saved.version + 1 } });
  else await prisma.columnMapping.create({ data: { sourceLabel: file.sourceLabel, layout: "WIDE", config: JSON.stringify(stored) } });
  await audit(user, "MAPPING_SAVED", "ColumnMapping", file.sourceLabel, { sourceLabel: file.sourceLabel, labels: Object.keys(cfg.labelMap).length, coa: MAPPING_VERSION }, a.id);
  await importValues(a, user, fileId, res.values, { layout: "WIDE", sheet: cfg.sheet, unit: cfg.unit, currency: cfg.currency, errors: res.errors });
  revalidatePath(`/analyses/${id}`, "layout");
  return { ok: true, count: res.values.length, unmapped: res.unmappedLabels, errors: res.errors };
}

/** ING-02: manual price and shares outstanding. */
export async function addManualPrice(id: string, formData: FormData) {
  const { user, a } = await ctx(id);
  const why = (await import("@/server/analysis")).lockReason(a, user, "DATA");
  if (why) back(id, { err: why });
  const companyId = String(formData.get("companyId"));
  const date = String(formData.get("date"));
  const price = parseDecimal(formData.get("price"));
  const shares = parseDecimal(formData.get("shares"));
  const sharesUnit = String(formData.get("sharesUnit") ?? "units");
  if (![a.companyId, ...a.peerIdsArr].includes(companyId)) back(id, { err: "That company is not part of this analysis. Pick the main company or one of its peers." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back(id, { err: "Choose the date the price or share count is for." });
  if (!price && !shares) back(id, { err: "Type a closing price, a share count, or both, then press Save." });
  const rows = [];
  if (price) rows.push({ lineItem: "price", value: price.toString(), rawValue: price.toString(), rawUnit: "INR/share", rawLabel: "Manual price" });
  if (shares) {
    const f = sharesUnit === "crore" ? 1e7 : sharesUnit === "lakh" ? 1e5 : sharesUnit === "million" ? 1e6 : 1;
    rows.push({ lineItem: "shares_outstanding", value: shares.mul(f).toString(), rawValue: shares.toString(), rawUnit: `${sharesUnit} shares`, rawLabel: "Manual shares outstanding" });
  }
  for (const r of rows) {
    const v = await prisma.financialValue.create({
      data: { analysisId: id, companyId, period: `D${date}`, ...r, mappingVersion: MAPPING_VERSION, origin: "ANALYST", reason: "Entered manually", createdBy: user.id },
    });
    await audit(user, "VALUE_ENTERED", "FinancialValue", v.id, { companyId, period: `D${date}`, lineItem: r.lineItem, value: r.value }, id);
  }
  await afterDataChange(a, user, "manual price entry");
  back(id, { msg: "Saved." });
}
