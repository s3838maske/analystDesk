import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { canView, latestRun, loadAnalysis, loadDataset } from "@/server/analysis";
import { renderCurrentReport } from "@/server/report";
import { exportDocx, exportPdf } from "@/server/export";
import { audit } from "@/server/audit";
import { buildModelWorkbook } from "@/lib/export-xlsx";
import { annualPeriods } from "@/lib/periods";
import { STATUS_LABEL } from "@/components/ui";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; fmt: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id, fmt } = await params;
  const a = await loadAnalysis(id);
  if (!canView(a, user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const slug = `${a.company.nse}_FY${a.fyTo}`;
  try {
    if (fmt === "xlsx") {
      const run = await latestRun(id);
      if (!run) return NextResponse.json({ error: "Run the model first." }, { status: 409 });
      const ds = await loadDataset(id);
      const buf = await buildModelWorkbook({ companyName: a.company.name, companyId: a.companyId, periods: annualPeriods(a.fyFrom, a.fyTo), ds, inputs: run.inputs, outputs: run.outputs, runId: run.id, runAt: run.createdAt });
      await audit(user, "EXPORTED", "ModelRun", run.id, { format: "xlsx" }, id);
      return file(buf, `${slug}_model.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    if (fmt === "docx" || fmt === "pdf") {
      const { rendered } = await renderCurrentReport(a);
      const meta = {
        title: `${a.company.name}: ratio and valuation report`,
        subtitle: `NSE ${a.company.nse} · FY${a.fyFrom}–FY${a.fyTo} · Analyst ${a.owner.name}`,
        status: a.status === "APPROVED" && a.approvedAt ? `Approved by ${a.reviewer.name}, ${a.approvedAt.toISOString().slice(0, 10)}` : `${STATUS_LABEL[a.status]} — not approved for issue`,
      };
      const buf = fmt === "docx" ? await exportDocx(meta, rendered) : await exportPdf(meta, rendered);
      await audit(user, "EXPORTED", "Report", id, { format: fmt, status: a.status }, id);
      return file(buf, `${slug}_report.${fmt}`, fmt === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf");
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ error: "unknown format" }, { status: 404 });
}

function file(buf: Buffer, name: string, type: string) {
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"` } });
}
