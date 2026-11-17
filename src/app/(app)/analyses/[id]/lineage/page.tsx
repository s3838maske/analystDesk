import Link from "next/link";
import { requireUser } from "@/server/auth";
import { loadAnalysis, lockReason } from "@/server/analysis";
import { resolveLineage } from "@/server/lineage";
import { D } from "@/lib/decimal";
import { formatIndian, formatMoney } from "@/lib/units";
import { Notice, OriginTag, fmtDate } from "@/components/ui";
import { correctValue } from "./actions";

function show(v: string | null | undefined, f?: string) {
  if (v === null || v === undefined) return "—";
  if (f === "inr") return `₹${formatMoney(D(v), "crore", 2)} cr`;
  if (f === "pct") return D(v).mul(100).toFixed(2) + "%";
  if (f === "x") return D(v).toFixed(2) + "x";
  return formatIndian(D(v), D(v).abs().lt(100) ? 4 : 2);
}

function guessFormat(ref: string, name: string) {
  if (ref.startsWith("a:")) return "pct";
  if (/price|per share|shares|EPS|Book value/i.test(name)) return "raw";
  if (/margin|growth|rate|ratio|WACC|payout|%/i.test(name)) return "pct";
  return "inr";
}

export default async function LineagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ref?: string; msg?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const a = await loadAnalysis(id);
  if (!sp.ref) return <Notice>Click any number in the app to trace it.</Notice>;
  const n = await resolveLineage(id, sp.ref);
  const canCorrect = n.kind === "stored" && !lockReason(a, user, "DATA");
  return (
    <div className="max-w-4xl space-y-4">
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.err && <Notice kind="error">{sp.err}</Notice>}
      <div className="card">
        <div className="muted text-xs uppercase tracking-wide">{{ stored: "Stored value", derived: "Derived amount", ratio: "Ratio", model: "Model output", assumption: "Assumption", unknown: "Unknown" }[n.kind]}</div>
        <h2 className="text-lg font-semibold">{n.title}</h2>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{show(n.value, n.format)}</div>
        {n.formula && <div className="mt-3"><span className="label">Formula</span><div className="rounded bg-gray-50 px-2 py-1 font-mono text-sm">{n.formula}</div>{n.formulaVersion && <div className="muted mt-1 text-xs">Formula version {n.formulaVersion}</div>}</div>}
        {n.notes?.map((t, i) => <p key={i} className="muted mt-2 text-xs">{t}</p>)}
      </div>

      {n.inputs && n.inputs.length > 0 && (
        <div className="card p-0">
          <h3 className="h2 px-4 pt-3">Inputs</h3>
          <table className="tbl mt-2">
            <tbody>
              {n.inputs.map((inp, i) => (
                <tr key={i}>
                  <td>{inp.name}</td>
                  <td className="num">{inp.ref ? <Link className="num-link" href={`?ref=${encodeURIComponent(inp.ref)}`}>{show(inp.value, guessFormat(inp.ref, inp.name))}</Link> : show(inp.value, "x")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {n.source && (
        <div className="card">
          <h3 className="h2 mb-2">Source <OriginTag origin={n.source.origin} /></h3>
          <dl className="grid grid-cols-[180px_1fr] gap-y-1 text-sm">
            <dt className="muted">Document</dt><dd>{n.source.fileId ? <a className="text-blue-700 underline" href={`/api/analyses/${id}/files/${n.source.fileId}`}>{n.source.fileName}</a> : "—"} {n.source.sourceLabel && <span className="muted">({n.source.sourceLabel})</span>}</dd>
            <dt className="muted">Cell</dt><dd className="font-mono">{n.source.sourceRef ?? "—"}</dd>
            <dt className="muted">Label in source</dt><dd>{n.source.rawLabel}</dd>
            <dt className="muted">Value in source</dt><dd>{n.source.rawValue} {n.source.rawUnit}</dd>
            <dt className="muted">Retrieved / entered</dt><dd>{n.source.uploadedAt ? fmtDate(n.source.uploadedAt) : "—"} by {n.source.uploadedBy}</dd>
            <dt className="muted">Mapping rules</dt><dd>{n.source.mappingVersion}</dd>
            {n.source.reason && <><dt className="muted">Reason</dt><dd>{n.source.reason}</dd></>}
          </dl>
        </div>
      )}

      {n.history && n.history.length > 0 && (
        <div className="card p-0">
          <h3 className="h2 px-4 pt-3">History</h3>
          <table className="tbl mt-2">
            <thead><tr><th>When</th><th>Who</th><th>Kind</th><th className="num">Value</th><th>Reason</th></tr></thead>
            <tbody>
              {n.history.map((h, i) => (
                <tr key={i} className={h.active ? "bg-blue-50" : ""}>
                  <td>{fmtDate(h.createdAt)}</td><td>{h.by}</td><td>{h.origin.toLowerCase().replace(/_/g, " ")}{h.active ? " (in use)" : ""}</td>
                  <td className="num">{h.value ? show(h.value, n.format) : ""}</td><td>{h.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCorrect && (
        <form action={correctValue.bind(null, id, sp.ref)} className="card flex flex-wrap items-end gap-2">
          <div><label className="label">Correct value ({n.format === "inr" ? "₹ crore" : "as shown"})</label><input className="input w-40" name="value" inputMode="decimal" /></div>
          <div className="min-w-72 flex-1"><label className="label">Reason (required)</label><input className="input" name="reason" /></div>
          <button className="btn">Save correction</button>
        </form>
      )}
    </div>
  );
}
