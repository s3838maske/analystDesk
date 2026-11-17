import fs from "fs/promises";
import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { canView, loadAnalysis } from "@/server/analysis";
import { audit } from "@/server/audit";

/** Download the original uploaded file, byte for byte (ING-04). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id, fileId } = await params;
  const a = await loadAnalysis(id);
  if (!canView(a, user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const f = await prisma.uploadedFile.findFirst({ where: { id: fileId, analysisId: id } });
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  const buf = await fs.readFile(f.storedPath);
  await audit(user, "FILE_DOWNLOADED", "UploadedFile", f.id, { fileName: f.fileName }, id);
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${encodeURIComponent(f.fileName)}"` } });
}
