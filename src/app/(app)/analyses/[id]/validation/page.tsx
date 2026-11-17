import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { loadAnalysis, lockReason } from "@/server/analysis";
import { LINE_ITEM_BY_KEY } from "@/lib/coa";
import { D } from "@/lib/decimal";
import { formatMoney, formatIndian } from "@/lib/units";
import type { AffectedValue } from "@/lib/validation";
import { Notice, Num, SeverityBadge, fmtDate, Locked } from "@/components/ui";
import { rerunValidation, resolveFlag } from "./actions";

const TYPE_LABEL: Record<string, string> = {
  BS_IMBALANCE: "Balance sheet does not balance", CF_TIE: "Cash flow does not tie", MISSING_PERIOD: "Missing period", MISSING_ITEM: "Missing line items",
  RESTATEMENT: "Restated / conflicting values", SIGN: "Sign error", OUTLIER: "Outlier",
};

export default async function ValidationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string; show?: string; open?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const a = await loadAnalysis(id);
  const lock = lockReason(a, user, "DATA");
  const all = await prisma.flag.findMany({ where: { analysisId: id }, orderBy: [{ createdAt: "asc" }] });
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as Record<string, number>;
  const open = all.filter((f) => f.status === "OPEN").sort((x, y) => order[x.severity] - order[y.severity]);
  const shown = sp.show === "all" ? [...open, ...all.filter((f) => f.status !== "OPEN")] : open;
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const highOpen = open.filter((f) => f.severity === "HIGH").length;
  const files = await prisma.uploadedFile.count({ where: { analysisId: id } });

  return (
    <div className="space-y-4">
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.err && <Notice kind="error">{sp.err}</Notice>}
      {lock && <Locked why={lock} />}
      <div className="flex flex-wrap items-center gap-3">
        <div className="card flex gap-6 py-2">
          {(["HIGH", "MEDIUM", "LOW"] as const).map((s) => <div key={s} className="text-sm"><SeverityBadge s={s} /> <b>{open.filter((f) => f.severity === s).length}</b> open</div>)}
          <div className="muted text-sm">{all.length - open.length} resolved</div>
        </div>
        <form action={rerunValidation.bind(null, id)}><button className="btn-secondary" disabled={!!lock}>Re-run checks</button></form>
        <Link className="text-sm text-blue-700 hover:underline" href={`/analyses/${id}/validation${sp.show === "all" ? "" : "?show=all"}`}>{sp.show === "all" ? "Show open only" : "Show resolved too"}</Link>
      </div>
      {!files && <Notice>There is nothing to check yet. Upload your data on the <Link className="underline" href={`/analyses/${id}/data`}>Upload data</Link> step first. The checks then run on their own after every upload.</Notice>}
      {files > 0 && highOpen > 0 && <Notice kind="warn">{highOpen} serious problem{highOpen > 1 ? "s" : ""} (marked HIGH) must be fixed before you can go on to the Model and Report steps. For each one, correct the number, accept it as reported, or override it with a reason.</Notice>}
      {files > 0 && !open.length && <Notice kind="ok">No open flags. <Link className="underline" href={`/analyses/${id}/ratios`}>Continue to ratios →</Link></Notice>}

      <div className="space-y-3">
        {shown.map((f) => {
          const affected: AffectedValue[] = JSON.parse(f.affected);
          const editable = f.status === "OPEN" && !lock;
          return (
            <details key={f.id} className="card" open={sp.open === f.id || (f.status === "OPEN" && f.severity === "HIGH")}>
              <summary className="flex cursor-pointer items-start gap-2">
                <SeverityBadge s={f.severity} />
                <div className="flex-1">
                  <div className="font-medium">{TYPE_LABEL[f.type] ?? f.type}{f.period ? ` · ${f.period}` : ""} <span className="muted font-normal">· {a.names[f.companyId]}</span></div>
                  <div className="text-sm text-gray-700">{f.message}</div>
                </div>
                {f.status !== "OPEN" && <span className="badge bg-gray-100 text-gray-700">{f.status.toLowerCase()}</span>}
              </summary>
              <div className="mt-3 space-y-3 pl-14">
                {affected.length > 0 && (
                  <form action={resolveFlag.bind(null, id, f.id)} className="space-y-3">
                    <table className="tbl w-auto">
                      <thead><tr><th>Affected value</th><th>Period</th><th className="num">Current (₹ cr)</th>{editable && <th>Corrected (₹ cr)</th>}</tr></thead>
                      <tbody>
                        {affected.map((v, i) => {
                          const kind = LINE_ITEM_BY_KEY[v.lineItem]?.kind ?? "money";
                          return (
                            <tr key={i}>
                              <td>{LINE_ITEM_BY_KEY[v.lineItem]?.label ?? v.lineItem}</td>
                              <td>{v.period}</td>
                              <td className="num">{v.value !== null ? <Num analysisId={id} refKey={`v:${v.companyId}:${v.period}:${v.lineItem}`}>{kind === "money" ? formatMoney(D(v.value)) : formatIndian(D(v.value))}</Num> : <span className="text-red-600">missing</span>}</td>
                              {editable && <td><input className="input w-36" name={`v:${v.companyId}|${v.period}|${v.lineItem}`} inputMode="decimal" placeholder="leave blank to keep" /></td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {editable && (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-80 flex-1"><label className="label">Reason (required to correct or override)</label><input className="input" name="reason" placeholder="e.g. Source restated in FY25 annual report, note 42" /></div>
                        <button className="btn-secondary" name="action" value="ACCEPT">Accept as reported</button>
                        <button className="btn" name="action" value="CORRECT">Save correction</button>
                        <button className="btn-secondary" name="action" value="OVERRIDE">Override</button>
                      </div>
                    )}
                  </form>
                )}
                {!affected.length && editable && (
                  <form action={resolveFlag.bind(null, id, f.id)} className="flex flex-wrap items-end gap-2">
                    <p className="w-full text-sm text-gray-600">Upload the missing data on the Data tab, or override with a reason if this period is not needed.</p>
                    <div className="min-w-80 flex-1"><label className="label">Reason</label><input className="input" name="reason" /></div>
                    <button className="btn-secondary" name="action" value="OVERRIDE">Override</button>
                  </form>
                )}
                {f.status !== "OPEN" && <p className="muted text-sm">Resolved by {users.find((u) => u.id === f.resolvedBy)?.name ?? f.resolvedBy}{f.resolvedAt ? ` on ${fmtDate(f.resolvedAt)}` : ""}: {f.resolution}</p>}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
