import { requireUser } from "@/server/auth";
import { latestRun, loadAnalysis, lockReason, openHighFlags } from "@/server/analysis";
import { renderCurrentReport } from "@/server/report";
import { tokenList } from "@/lib/report";
import { Notice, Locked } from "@/components/ui";
import Blocked from "@/components/Blocked";
import ReportView from "@/components/ReportView";
import Editor from "./Editor";
import { saveSection } from "./actions";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const a = await loadAnalysis(id);
  const high = await openHighFlags(id);
  if (high) return <Blocked id={id} high={high} step="The Report step" />;
  const run = await latestRun(id);
  const { sections, ctx, rendered } = await renderCurrentReport(a);
  const lock = lockReason(a, user, "WORDING");
  const empty = sections.filter((s) => s.analystOnly && !s.body.trim());
  return (
    <div className="space-y-4">
      {!run && <Notice kind="warn">The model has not been run yet, so valuation numbers show as missing. Go to the Model step, tick “Confirmed” next to the key assumptions and press “Save and run model”.</Notice>}
      {lock && <Locked why={lock} />}
      {!lock && empty.length > 0 && <Notice>The app drafts everything except {empty.map((s) => s.title.toLowerCase()).join(", ")}. You need to write those yourself before you can submit the report for review.</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="muted text-sm">Numbers in blue are linked to the model and update when it re-runs. Click one to trace it.</span>
        <a className="btn-secondary ml-auto" href={`/api/analyses/${id}/export/docx`}>Export .docx</a>
        <a className="btn-secondary" href={`/api/analyses/${id}/export/pdf`}>Export PDF</a>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {!lock && (
          <Editor
            sections={sections}
            tokens={tokenList(ctx)}
            onSave={saveSection.bind(null, id)}
          />
        )}
        <div className={`card ${lock ? "xl:col-span-2" : ""}`}>
          <div className="mb-3 border-b border-gray-200 pb-2">
            <div className="text-lg font-semibold">{a.company.name}: ratio and valuation report</div>
            <div className="muted text-sm">FY{a.fyFrom}–FY{a.fyTo} · Analyst {a.owner.name}</div>
          </div>
          <ReportView sections={rendered} id={id} />
        </div>
      </div>
    </div>
  );
}
