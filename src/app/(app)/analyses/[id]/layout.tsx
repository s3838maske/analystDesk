import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { canView, loadAnalysis } from "@/server/analysis";
import { ASSUMPTIONS } from "@/lib/model";
import type { Section } from "@/lib/report";
import { Avatar, StatusBadge, hoursLabel, STATUS_LABEL } from "@/components/ui";
import { IconClock } from "@/components/icons";
import Tabs from "./Tabs";
import StageTimer from "./StageTimer";

export default async function AnalysisLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let a;
  try {
    a = await loadAnalysis(id);
  } catch {
    notFound();
  }
  if (!canView(a, user)) {
    const status = STATUS_LABEL[a.status]?.toLowerCase() ?? a.status;
    return (
      <div className="max-w-2xl space-y-4">
        <p className="eyebrow">No access</p>
        <h1 className="h1">You can’t open this analysis</h1>
        <div className="card space-y-3 text-[15px] leading-relaxed">
          {user.role === "COMPLIANCE" ? (
            <p>Compliance can open a report only after it has been approved. The <b>{a.company.name}</b> analysis is still <b>{status}</b>, so it is not available to you yet. It will appear under Approved reports once {a.reviewer.name} approves it.</p>
          ) : (
            <p>The <b>{a.company.name}</b> analysis belongs to <b>{a.owner.name}</b>. Only {a.owner.name}, the senior reviewers and team admins can open it. If you need to see it, ask {a.owner.name} or your team admin.</p>
          )}
          <Link href="/" className="btn-secondary inline-flex">Back to dashboard</Link>
        </div>
      </div>
    );
  }
  const [files, openFlags, asm, runs, report, versions, time] = await Promise.all([
    prisma.uploadedFile.count({ where: { analysisId: id, status: "IMPORTED" } }),
    prisma.flag.count({ where: { analysisId: id, status: "OPEN", severity: "HIGH" } }),
    prisma.assumption.findMany({ where: { analysisId: id } }),
    prisma.modelRun.count({ where: { analysisId: id } }),
    prisma.report.findUnique({ where: { analysisId: id } }),
    prisma.reportVersion.count({ where: { analysisId: id } }),
    prisma.timeEntry.aggregate({ where: { analysisId: id }, _sum: { seconds: true } }),
  ]);
  const confirmed = asm.length > 0 && asm.every((x) => !ASSUMPTIONS.find((d) => d.key === x.key)?.key_ || x.confirmed);
  const written = !!report && (JSON.parse(report.sections) as Section[]).every((s) => !s.analystOnly || s.body.trim());
  const done = {
    "": true,
    data: files > 0,
    validation: files > 0 && openFlags === 0,
    ratios: files > 0 && openFlags === 0,
    model: runs > 0 && confirmed,
    report: written,
    review: a.status === "APPROVED" || (versions > 0 && a.status === "IN_REVIEW"),
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-gray-500"><Link href="/" className="hover:text-gray-900">Analyses</Link> / {a.company.name}</span>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
            {a.company.name}{a.purpose ? <span className="text-gray-500"> · {a.purpose}</span> : null}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700">{a.company.nse} · {a.company.sector} · {a.peers.length} peer{a.peers.length === 1 ? "" : "s"}</span>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700">FY{a.fyFrom}–FY{a.fyTo}{a.quartersArr.length ? ` + ${a.quartersArr.length} quarters` : ""}</span>
            <StatusBadge status={a.status} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex" title={`Analyst ${a.owner.name} · Reviewer ${a.reviewer.name}`}>
            <span className="rounded-full border-2 border-[#0b1020]"><Avatar name={a.owner.name} size={32} /></span>
            <span className="-ml-2 rounded-full border-2 border-[#0b1020]"><Avatar name={a.reviewer.name} size={32} tone="cyan" /></span>
          </div>
          <span className="mono flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-sm"><IconClock size={16} className="text-gray-500" />{hoursLabel(time._sum.seconds ?? 0)} logged</span>
          <Link href={`/analyses/${id}/audit`} className="btn-secondary h-10">Audit trail</Link>
        </div>
      </div>
      <Tabs id={id} done={done} />
      {a.ownerId === user.id && a.status !== "APPROVED" && <StageTimer id={id} />}
      {children}
    </div>
  );
}
