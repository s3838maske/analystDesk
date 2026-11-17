import "server-only";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { prisma } from "./db";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import { LoadedAnalysis, afterDataChange } from "./analysis";
import { MAPPING_VERSION, ParsedValue, readWorkbook } from "@/lib/ingest";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./storage/uploads";

/** ING-04: store the uploaded file unchanged, with uploader, time and the named source. */
export async function storeUpload(a: LoadedAnalysis, user: SessionUser, file: File, sourceLabel: string, kind: string) {
  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const dir = path.resolve(UPLOAD_DIR, a.id);
  await fs.mkdir(dir, { recursive: true });
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
  const storedPath = path.join(dir, `${sha256.slice(0, 16)}-${safe}`);
  await fs.writeFile(storedPath, buf, { flag: "wx" }).catch(async (e) => {
    if (e.code !== "EEXIST") throw e; // identical file already stored
  });
  const rec = await prisma.uploadedFile.create({
    data: { analysisId: a.id, fileName: file.name, storedPath, sha256, sizeBytes: buf.length, sourceLabel, kind, uploadedBy: user.id },
  });
  await audit(user, "FILE_UPLOADED", "UploadedFile", rec.id, { fileName: file.name, sha256, sizeBytes: buf.length, sourceLabel, kind }, a.id);
  return { rec, buf };
}

export async function readStoredWorkbook(storedPath: string) {
  return readWorkbook(await fs.readFile(storedPath));
}

/** Import parsed values from one file. Re-importing a file replaces (deactivates) its earlier values. */
export async function importValues(a: LoadedAnalysis, user: SessionUser, fileId: string, values: ParsedValue[], note: Record<string, unknown> = {}) {
  const prior = await prisma.financialValue.updateMany({ where: { analysisId: a.id, fileId, origin: "AUTOMATED", active: true }, data: { active: false } });
  // A newer file from the same named source is an updated version of that source: it replaces the
  // overlapping values. Values from a different source that disagree are kept and flagged as restatements.
  const file = await prisma.uploadedFile.findUniqueOrThrow({ where: { id: fileId } });
  const sameSource = await prisma.uploadedFile.findMany({ where: { analysisId: a.id, sourceLabel: file.sourceLabel, kind: file.kind, id: { not: fileId } }, select: { id: true } });
  let superseded = 0;
  if (sameSource.length && values.length) {
    const keys = new Set(values.map((v) => `${v.companyId}|${v.period}|${v.lineItem}`));
    const old = await prisma.financialValue.findMany({ where: { analysisId: a.id, fileId: { in: sameSource.map((f) => f.id) }, origin: "AUTOMATED", active: true }, select: { id: true, companyId: true, period: true, lineItem: true } });
    const ids = old.filter((o) => keys.has(`${o.companyId}|${o.period}|${o.lineItem}`)).map((o) => o.id);
    for (let i = 0; i < ids.length; i += 500) await prisma.financialValue.updateMany({ where: { id: { in: ids.slice(i, i + 500) } }, data: { active: false } });
    superseded = ids.length;
  }
  if (values.length) {
    await prisma.financialValue.createMany({
      data: values.map((v) => ({
        analysisId: a.id, companyId: v.companyId, period: v.period, lineItem: v.lineItem, value: v.value,
        rawValue: v.rawValue, rawUnit: v.rawUnit, rawLabel: v.rawLabel, fileId, sourceRef: v.sourceRef,
        mappingVersion: MAPPING_VERSION, origin: "AUTOMATED", createdBy: user.id,
      })),
    });
  }
  await prisma.uploadedFile.update({ where: { id: fileId }, data: { status: "IMPORTED" } });
  await audit(user, "VALUES_IMPORTED", "UploadedFile", fileId, { count: values.length, replaced: prior.count, supersededFromSameSource: superseded, ...note }, a.id);
  await afterDataChange(a, user, "data import");
}
