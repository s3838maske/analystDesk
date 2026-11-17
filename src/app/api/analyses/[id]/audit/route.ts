import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { canView, loadAnalysis } from "@/server/analysis";
import { audit } from "@/server/audit";

/** AUD-04: export the audit trail of an analysis as CSV. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await params;
  const a = await loadAnalysis(id);
  if (!canView(a, user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const logs = await prisma.auditLog.findMany({ where: { analysisId: id }, orderBy: { at: "asc" } });
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = ["time_utc,user,action,entity,entity_id,detail", ...logs.map((l) => [l.at.toISOString(), q(l.userName), l.action, l.entity, l.entityId ?? "", q(l.detail)].join(","))].join("\n");
  await audit(user, "AUDIT_EXPORTED", "Analysis", id, { rows: logs.length }, id);
  return new NextResponse(csv, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="${a.company.nse}_audit.csv"` } });
}
