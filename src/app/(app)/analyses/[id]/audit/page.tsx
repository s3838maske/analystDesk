import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { fmtDate } from "@/components/ui";
import { loadAnalysis } from "@/server/analysis";
import { auditSentence } from "@/lib/audit-text";
import { ASSUMPTIONS } from "@/lib/model";
import { LINE_ITEMS } from "@/lib/coa";

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ action?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  await requireUser();
  const logs = await prisma.auditLog.findMany({ where: { analysisId: id, ...(sp.action ? { action: sp.action } : {}) }, orderBy: { at: "desc" }, take: 500 });
  const a = await loadAnalysis(id);
  const names: Record<string, string> = {
    ...a.names,
    ...Object.fromEntries(ASSUMPTIONS.map((x) => [x.key, x.label.toLowerCase()])),
    ...Object.fromEntries(LINE_ITEMS.map((x) => [x.key, x.label.toLowerCase()])),
  };
  const actions = await prisma.auditLog.groupBy({ by: ["action"], where: { analysisId: id }, _count: true });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="muted text-sm">Everything anyone did on this analysis, newest first, with who did it and when. Nobody can edit or delete these entries, not even an admin.</p>
        <a className="btn-secondary ml-auto" href={`/api/analyses/${id}/audit?format=csv`}>Export CSV</a>
      </div>
      <div className="flex flex-wrap gap-1">
        <a href="?" className={`badge ${!sp.action ? "bg-blue-700 text-white" : "bg-gray-100"}`}>All</a>
        {actions.map((x) => <a key={x.action} href={`?action=${x.action}`} className={`badge ${sp.action === x.action ? "bg-blue-700 text-white" : "bg-gray-100"}`}>{x.action.toLowerCase().replace(/_/g, " ")} ({x._count})</a>)}
      </div>
      <div className="card p-0">
        <table className="tbl">
          <thead><tr><th>Time (IST)</th><th>User</th><th>Action</th><th>What happened</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{fmtDate(l.at)}</td>
                <td>{l.userName}</td>
                <td className="whitespace-nowrap">{l.action.toLowerCase().replace(/_/g, " ")}</td>
                <td className="max-w-xl">
                  <p className="text-gray-900">{auditSentence(l.action, l.detail, names)}</p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[12px] text-gray-500 hover:text-gray-700">Technical detail</summary>
                    <p className="mt-1 break-words font-mono text-[11px] text-gray-500">{l.detail.length > 600 ? l.detail.slice(0, 600) + "…" : l.detail}</p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
