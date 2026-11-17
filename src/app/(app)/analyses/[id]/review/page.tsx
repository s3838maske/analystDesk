import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { latestRun, loadAnalysis, modelBlockers, openHighFlags } from "@/server/analysis";
import { ensureReport, renderCurrentReport } from "@/server/report";
import { diffVersions, lineDiff, type Section } from "@/lib/report";
import { ASSUMPTIONS } from "@/lib/model";
import { Checklist, Notice, StatusBadge, fmtDate, type Need } from "@/components/ui";
import { approve, requestChanges, submitForReview } from "./actions";

type VSection = { key: string; title: string; text: string };

const CR_TYPE: Record<string, string> = { DATA: "Data", ASSUMPTION: "Assumption", WORDING: "Wording" };
const CR_EFFECT: Record<string, string> = { DATA: "reopens data and flags; model and report re-run after the fix", ASSUMPTION: "reopens assumptions; model and report re-run", WORDING: "reopens report text only" };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string; a?: string; b?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const a = await loadAnalysis(id);
  const versions = await prisma.reportVersion.findMany({ where: { analysisId: id }, orderBy: { number: "asc" } });
  const crs = await prisma.changeRequest.findMany({ where: { analysisId: id }, orderBy: { createdAt: "desc" } });
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const uname = (uid: string) => users.find((u) => u.id === uid)?.name ?? uid;
  const isOwner = a.ownerId === user.id;
  const isReviewer = a.reviewerId === user.id;
  const openCrs = crs.filter((c) => c.status === "OPEN");
  const parse = (v: (typeof versions)[number]) => ({ sections: JSON.parse(v.sections) as VSection[], values: JSON.parse(v.values) as Record<string, string> });
  const latest = versions[versions.length - 1];
  const prev = versions[versions.length - 2];

  // What still stops the owner from submitting (the same checks the submit action runs).
  const canSubmitNow = isOwner && ["DRAFT", "CHANGES_REQUESTED"].includes(a.status);
  let submitNeeds: Need[] = [];
  if (canSubmitNow) {
    const [values, high, blocker, run, rep] = await Promise.all([prisma.financialValue.count({ where: { analysisId: id, active: true } }), openHighFlags(id), modelBlockers(a), latestRun(id), ensureReport(id)]);
    const empty = (JSON.parse(rep.sections) as Section[]).filter((x) => x.analystOnly && !x.body.trim());
    submitNeeds = [
      { ok: values > 0, text: "Upload the company’s financial data", hint: "Nothing has been uploaded yet. Download the upload template, fill it in, and upload it on the Upload data step.", href: `/analyses/${id}/data`, cta: "Go to Upload data" },
      { ok: !high, text: "Fix every serious data problem", hint: high ? `${high} problem${high > 1 ? "s are" : " is"} marked HIGH on the Flags step.` : undefined, href: `/analyses/${id}/validation`, cta: "Go to Flags" },
      { ok: !!high || !blocker, text: "Confirm the key model assumptions", hint: blocker ?? undefined, href: `/analyses/${id}/model`, cta: "Go to Model" },
      { ok: !!run, text: "Run the model at least once", hint: "On the Model step, press “Save and run model”.", href: `/analyses/${id}/model`, cta: "Go to Model" },
      {
        ok: !empty.length,
        text: "Write the parts of the report only you can write",
        hint: empty.length ? `Still empty: ${empty.map((x) => x.title).join(", ")}. The app drafts the rest for you.` : undefined,
        href: `/analyses/${id}/report`,
        cta: "Go to Report",
      },
    ];
  }
  const submitReady = submitNeeds.every((n) => n.ok);
  const changeLog = latest && prev ? diffVersions(parse(prev), parse(latest)) : null;

  // anchors for new change requests
  const { ctx, sections } = await renderCurrentReport(a);
  const anchorGroups: [string, [string, string][]][] = [
    ["Sections", sections.map((s) => [`section:${s.key}`, s.title])],
    ["Numbers", Object.entries(ctx.values).filter(([, v]) => v.ref).map(([k, v]) => [`value:${k}`, `${k} = ${v.text}`])],
    ["Tables and charts", [...Object.keys(ctx.tables).map((t) => [`table:${t}`, `Table: ${ctx.tables[t].title}`] as [string, string]), ...Object.keys(ctx.charts).map((c) => [`chart:${c}`, `Chart: ${ctx.charts[c].title}`] as [string, string])]],
    ["Assumptions", ASSUMPTIONS.map((d) => [`assumption:${d.key}`, d.label])],
  ];
  const anchorLabel = (an: string) => anchorGroups.flatMap((g) => g[1]).find(([k]) => k === an)?.[1] ?? an;

  const cmpA = versions.find((v) => String(v.number) === sp.a);
  const cmpB = versions.find((v) => String(v.number) === sp.b);

  return (
    <div className="space-y-5">
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.err && <Notice kind="error">{sp.err}</Notice>}

      <div className="card flex flex-wrap items-center gap-4">
        <div>Status: <StatusBadge status={a.status} /></div>
        {a.status === "APPROVED" && <div className="text-sm">Approved by <b>{a.reviewer.name}</b> on {fmtDate(a.approvedAt!)}. Read-only.</div>}
        {a.status === "IN_REVIEW" && <div className="muted text-sm">Version {latest?.number} is with {a.reviewer.name}. Editing is locked.</div>}
        {a.status === "CHANGES_REQUESTED" && <div className="muted text-sm">Reopened: {(a.reopenedArr as string[]).join(", ").toLowerCase()}. Fix, then resubmit.</div>}
        {!isOwner && ["DRAFT", "CHANGES_REQUESTED"].includes(a.status) && (
          <div className="muted text-sm">{isReviewer ? `Nothing to review yet. ${a.owner.name} has not ${versions.length ? "resubmitted" : "submitted"} this analysis. Approve and Request changes appear here once they do.` : `Only ${a.owner.name}, who created this analysis, can submit it.`}</div>
        )}
        {canSubmitNow && (
          <form action={submitForReview.bind(null, id)} className="ml-auto flex flex-wrap items-center justify-end gap-3">
            {!submitReady && <span className="text-[13px] text-gray-500">Finish the list below to turn this on.</span>}
            <button className="btn" disabled={!submitReady} aria-describedby={submitReady ? undefined : "submit-needs"}>{versions.length ? "Resubmit for review" : "Submit for review"}</button>
          </form>
        )}
      </div>
      {canSubmitNow && <Checklist id="submit-needs" title={`Before you can send this to ${a.reviewer.name}:`} items={submitNeeds} />}

      {openCrs.length > 0 && (
        <div className="card">
          <h2 className="h2 mb-2">Open change requests</h2>
          <ul className="space-y-2">
            {openCrs.map((c) => (
              <li key={c.id} className="rounded-md border border-orange-200 bg-orange-50 p-2 text-sm">
                <span className="badge mr-2 bg-orange-200 text-orange-900">{CR_TYPE[c.type]}</span>
                <b>{anchorLabel(c.anchor)}</b> — {c.comment}
                <div className="muted mt-1 text-xs">{uname(c.createdBy)} · {fmtDate(c.createdAt)} · on version {c.versionNo} · {CR_EFFECT[c.type]}</div>
                {isOwner && (
                  <div className="mt-1 text-xs">
                    Fix on: {c.type === "DATA" ? <Link className="text-blue-700 underline" href={`/analyses/${id}/data`}>Data</Link> : c.type === "ASSUMPTION" ? <Link className="text-blue-700 underline" href={`/analyses/${id}/model`}>Model</Link> : <Link className="text-blue-700 underline" href={`/analyses/${id}/report`}>Report</Link>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isReviewer && a.status === "IN_REVIEW" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <form action={requestChanges.bind(null, id)} className="card space-y-2 lg:col-span-2">
            <h2 className="h2">Request changes</h2>
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select className="input col-span-2" name={`type_${i}`} defaultValue="WORDING">
                  <option value="DATA">Data</option><option value="ASSUMPTION">Assumption</option><option value="WORDING">Wording</option>
                </select>
                <select className="input col-span-4" name={`anchor_${i}`} defaultValue="">
                  <option value="">Anchor to…</option>
                  {anchorGroups.map(([g, items]) => <optgroup key={g} label={g}>{items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>)}
                </select>
                <input className="input col-span-6" name={`comment_${i}`} placeholder={i === 0 ? "What should change and why" : "Another change request (optional)"} />
              </div>
            ))}
            <p className="text-[13px] text-gray-500">For each change, choose its type, point it at the number, table or section it is about, and say what should change. Leave unused rows empty.</p>
            <button className="btn-secondary">Send change requests</button>
          </form>
          <form action={approve.bind(null, id)} className="card space-y-3">
            <h2 className="h2">Approve</h2>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1" required /> I have reviewed version {latest?.number} and approve it for internal use. My name and the time are recorded.</label>
            <button className="btn">Approve version {latest?.number}</button>
            <p className="text-[13px] text-gray-500">Tick the box above first. Approving locks the report for good.</p>
          </form>
        </div>
      )}

      {changeLog && (
        <div className="card">
          <h2 className="h2">What changed in version {latest.number} (since version {prev.number})</h2>
          {!changeLog.values.length && !changeLog.sections.length && <p className="muted text-sm">No changes.</p>}
          {changeLog.values.length > 0 && (
            <table className="tbl mt-2">
              <thead><tr><th>Value</th><th className="num">Version {prev.number}</th><th className="num">Version {latest.number}</th></tr></thead>
              <tbody>{changeLog.values.map((v) => <tr key={v.token}><td className="font-mono text-xs">{v.token}</td><td className="num text-red-700 line-through">{v.before ?? "—"}</td><td className="num text-emerald-700">{v.after ?? "—"}</td></tr>)}</tbody>
            </table>
          )}
          {changeLog.sections.map((s) => (
            <div key={s.key} className="mt-3">
              <h3 className="text-sm font-semibold">{s.title}</h3>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{s.lines.filter((l) => l.op !== "same").map((l, i) => <div key={i} className={l.op === "add" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800 line-through"}>{l.op === "add" ? "+ " : "− "}{l.text}</div>)}</pre>
            </div>
          ))}
        </div>
      )}

      <div className="card p-0">
        <div className="flex items-center justify-between px-4 pt-3"><h2 className="h2">Versions</h2></div>
        <table className="tbl mt-2">
          <thead><tr><th>Version</th><th>Submitted</th><th>By</th><th>Change requests raised on it</th><th></th></tr></thead>
          <tbody>
            {versions.map((v, i) => (
              <tr key={v.id}>
                <td>v{v.number}</td>
                <td>{fmtDate(v.submittedAt)}</td>
                <td>{uname(v.submittedBy)}</td>
                <td>{crs.filter((c) => c.versionNo === v.number).length}</td>
                <td>{i > 0 && <Link className="text-blue-700 hover:underline" href={`?a=${versions[i - 1].number}&b=${v.number}`}>Compare with v{versions[i - 1].number}</Link>}</td>
              </tr>
            ))}
            {!versions.length && <tr><td colSpan={5} className="muted py-4 text-center">Not submitted yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {cmpA && cmpB && (() => {
        const A = parse(cmpA), B = parse(cmpB);
        return (
          <div className="card">
            <h2 className="h2 mb-2">Side by side: v{cmpA.number} vs v{cmpB.number}</h2>
            {B.sections.map((s) => {
              const before = A.sections.find((x) => x.key === s.key)?.text ?? "";
              const d = lineDiff(before.split("\n"), s.text.split("\n"));
              return (
                <div key={s.key} className="mb-4">
                  <h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="whitespace-pre-wrap rounded bg-gray-50 p-2">{d.filter((l) => l.op !== "add").map((l, i) => <div key={i} className={l.op === "del" ? "bg-red-100" : ""}>{l.text || " "}</div>)}</div>
                    <div className="whitespace-pre-wrap rounded bg-gray-50 p-2">{d.filter((l) => l.op !== "del").map((l, i) => <div key={i} className={l.op === "add" ? "bg-emerald-100" : ""}>{l.text || " "}</div>)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {crs.filter((c) => c.status !== "OPEN").length > 0 && (
        <div className="card">
          <h2 className="h2 mb-2">Addressed change requests</h2>
          <ul className="space-y-1 text-sm">
            {crs.filter((c) => c.status !== "OPEN").map((c) => <li key={c.id}><span className="badge mr-1 bg-gray-100">{CR_TYPE[c.type]}</span><b>{anchorLabel(c.anchor)}</b> — {c.comment} <span className="muted text-xs">(v{c.versionNo}, addressed {c.addressedAt ? fmtDate(c.addressedAt) : ""})</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
