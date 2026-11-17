import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { latestRun, loadAnalysis } from "@/server/analysis";
import { ASSUMPTIONS } from "@/lib/model";
import type { Section } from "@/lib/report";

const STAGES = ["DATA", "VALIDATION", "RATIOS", "MODEL", "REPORT", "REVIEW"];
const hours = (s: number) => (s / 3600).toFixed(1) + " h";

export default async function Overview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const a = await loadAnalysis(id);
  const [files, flags, asm, run, report, versions, crs, time] = await Promise.all([
    prisma.uploadedFile.count({ where: { analysisId: id, status: "IMPORTED" } }),
    prisma.flag.findMany({ where: { analysisId: id } }),
    prisma.assumption.findMany({ where: { analysisId: id } }),
    latestRun(id),
    prisma.report.findUnique({ where: { analysisId: id } }),
    prisma.reportVersion.count({ where: { analysisId: id } }),
    prisma.changeRequest.findMany({ where: { analysisId: id } }),
    prisma.timeEntry.findMany({ where: { analysisId: id } }),
  ]);
  const openFlags = flags.filter((f) => f.status === "OPEN");
  const keyUnconfirmed = asm.filter((x) => ASSUMPTIONS.find((d) => d.key === x.key)?.key_ && !x.confirmed).length;
  const emptySections = report ? (JSON.parse(report.sections) as Section[]).filter((s) => s.analystOnly && !s.body.trim()).length : 3;
  const steps: [string, boolean, string, string][] = [
    ["Data uploaded", files > 0, `${files} file(s) imported`, "data"],
    ["Flags resolved", files > 0 && openFlags.length === 0, `${openFlags.length} open (${openFlags.filter((f) => f.severity === "HIGH").length} high)`, "validation"],
    ["Assumptions confirmed", asm.length > 0 && keyUnconfirmed === 0, asm.length ? `${keyUnconfirmed} key assumption(s) to confirm` : "not set yet", "model"],
    ["Model run", !!run, run ? `DCF ₹${Number(run.outputs.dcf.per_share).toFixed(2)} per share` : "not run", "model"],
    ["Analyst sections written", emptySections === 0, `${emptySections} of 3 still empty`, "report"],
    ["Submitted for review", versions > 0, `${versions} version(s)`, "review"],
    ["Approved", a.status === "APPROVED", a.approvedAt ? `by ${a.reviewer.name}` : "pending", "review"],
  ];
  const byStage = Object.fromEntries(STAGES.map((s) => [s, time.filter((t) => t.stage === s).reduce((x, t) => x + t.seconds, 0)]));
  const total = Object.values(byStage).reduce((x, y) => x + y, 0);
  const rounds = new Set(crs.map((c) => c.versionNo)).size;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card lg:col-span-2">
        <h2 className="h2 mb-2">Progress</h2>
        <ol className="space-y-1.5">
          {steps.map(([label, ok, detail, href]) => (
            <li key={label} className="flex items-center gap-2 text-sm">
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${ok ? "bg-green-600 text-white" : "bg-gray-200 text-gray-600"}`}>{ok ? "✓" : ""}</span>
              <Link href={`/analyses/${id}/${href}`} className="font-medium hover:underline">{label}</Link>
              <span className="muted">— {detail}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="card space-y-2 text-sm">
        <h2 className="h2">Scope</h2>
        <div><span className="muted">Purpose:</span> {a.purpose ?? "—"}</div>
        <div><span className="muted">Periods:</span> FY{a.fyFrom}–FY{a.fyTo}{a.quartersArr.length ? `, ${a.quartersArr.join(", ")}` : ""}</div>
        <div><span className="muted">Peers:</span> {a.peers.map((p) => p.name).join(", ")}</div>
      </div>
      <div className="card lg:col-span-3">
        <h2 className="h2 mb-2">Time spent (active time on this analysis)</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          {STAGES.map((s) => <div key={s}><div className="muted text-xs">{s.toLowerCase()}</div><div className="text-lg font-semibold">{hours(byStage[s])}</div></div>)}
          <div className="border-l border-gray-200 pl-6"><div className="muted text-xs">total</div><div className="text-lg font-semibold">{hours(total)}</div></div>
          <div><div className="muted text-xs">change-request rounds</div><div className="text-lg font-semibold">{rounds}</div></div>
          <div className="muted self-end text-xs">Manual baseline: ~20 h per first draft, 3–8 h per change-request round. Target ≤ 9 h and ≤ 1 h.</div>
        </div>
      </div>
    </div>
  );
}
