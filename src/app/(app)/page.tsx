import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { ASSUMPTIONS } from "@/lib/model";
import { Avatar, StatusBadge, fmtDate, hoursLabel } from "@/components/ui";
import { IconAlert, IconPen, IconPlus, IconSliders, IconCheckSquare } from "@/components/icons";

const BASELINE_H = 20;

type Col = "UPLOAD" | "FLAGS" | "MODEL" | "CHANGES" | "REVIEW" | "APPROVED";
const COLS: [Col, string][] = [
  ["UPLOAD", "Upload"],
  ["FLAGS", "Flags"],
  ["MODEL", "Model and report"],
  ["CHANGES", "Changes requested"],
  ["REVIEW", "In review"],
  ["APPROVED", "Approved"],
];

const SYSTEM_ACTIONS = new Set(["MODEL_RUN", "VALIDATION_RUN", "VALUES_IMPORTED"]);
function sentence(action: string, who: string, company: string, d: Record<string, unknown>) {
  const c = <strong className="font-semibold">{company}</strong>;
  switch (action) {
    case "MODEL_RUN": return <>AnalystDesk re-ran the {c} model{d.reason ? ` (${d.reason})` : ""}</>;
    case "VALUES_IMPORTED": return <>AnalystDesk imported {String(d.count ?? "")} values for {c}</>;
    case "VALIDATION_RUN": return <>AnalystDesk checked {c}: {String(d.newFlags ?? 0)} new flag(s), {String(d.cleared ?? 0)} cleared</>;
    case "ANALYSIS_CREATED": return <>{who} started an analysis of {c}</>;
    case "FILE_UPLOADED": return <>{who} uploaded {String(d.fileName ?? "a file")} to {c}</>;
    case "FLAG_CORRECTED": case "VALUE_CORRECTED": return <>{who} corrected data on {c}</>;
    case "FLAG_ACCEPTED": case "FLAG_OVERRIDDEN": return <>{who} resolved a flag on {c}</>;
    case "ASSUMPTION_CHANGED": return <>{who} changed {String(d.key ?? "an assumption").replace(/_/g, " ")} on {c}</>;
    case "ASSUMPTION_CONFIRMED": return <>{who} confirmed {String(d.key ?? "an assumption").replace(/_/g, " ")} on {c}</>;
    case "REPORT_EDITED": return <>{who} edited the {String(d.section ?? "report")} section of {c}</>;
    case "SUBMITTED": case "RESUBMITTED": return <>{who} submitted {c} version {String(d.version ?? "")} for review</>;
    case "CHANGE_REQUESTED": return <>{who} raised a {String(d.type ?? "").toLowerCase()} change request on {c}</>;
    case "APPROVED": return <>{who} approved {c}</>;
    case "EXPORTED": return <>{who} exported {c} as {String(d.format ?? "")}</>;
    default: return <>{who} · {action.toLowerCase().replace(/_/g, " ")} · {c}</>;
  }
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const scope =
    user.role === "ADMIN" ? {} : user.role === "COMPLIANCE" ? { status: "APPROVED" } : user.role === "REVIEWER" ? { OR: [{ reviewerId: user.id }, { ownerId: user.id }] } : { ownerId: user.id };
  const q = (sp.q ?? "").trim();
  const analyses = await prisma.analysis.findMany({
    where: q ? { AND: [scope, { company: { OR: [{ name: { contains: q } }, { nse: { contains: q.toUpperCase() } }] } }] } : scope,
    include: { company: true, owner: true, reviewer: true },
    orderBy: { updatedAt: "desc" },
  });
  const ids = analyses.map((a) => a.id);
  const [files, flags, asm, runs, versions, crs, time, logs] = await Promise.all([
    prisma.uploadedFile.groupBy({ by: ["analysisId"], where: { analysisId: { in: ids }, status: "IMPORTED" }, _count: true }),
    prisma.flag.findMany({ where: { analysisId: { in: ids }, status: "OPEN" }, select: { analysisId: true, severity: true } }),
    prisma.assumption.findMany({ where: { analysisId: { in: ids } }, select: { analysisId: true, key: true, confirmed: true, origin: true } }),
    prisma.modelRun.groupBy({ by: ["analysisId"], where: { analysisId: { in: ids } }, _count: true }),
    prisma.reportVersion.groupBy({ by: ["analysisId"], where: { analysisId: { in: ids } }, _max: { number: true } }),
    prisma.changeRequest.findMany({ where: { analysisId: { in: ids }, status: "OPEN" }, orderBy: { createdAt: "desc" } }),
    prisma.timeEntry.groupBy({ by: ["analysisId"], where: { analysisId: { in: ids } }, _sum: { seconds: true } }),
    prisma.auditLog.findMany({ where: { analysisId: { in: ids }, action: { notIn: ["LOGIN", "LOGOUT", "FILE_DOWNLOADED", "AUDIT_EXPORTED"] } }, orderBy: { at: "desc" }, take: 7 }),
  ]);
  const by = <T extends { analysisId: string }>(xs: T[], id: string) => xs.filter((x) => x.analysisId === id);
  const secondsOf = (id: string) => time.find((t) => t.analysisId === id)?._sum.seconds ?? 0;
  const keyUnconfirmed = (id: string) => by(asm, id).filter((x) => ASSUMPTIONS.find((d) => d.key === x.key)?.key_ && !x.confirmed).length;

  const card = analyses.map((a) => {
    const hasData = files.some((f) => f.analysisId === a.id);
    const high = by(flags, a.id).filter((f) => f.severity === "HIGH").length;
    const open = by(flags, a.id).length;
    const ver = versions.find((v) => v.analysisId === a.id)?._max.number ?? 0;
    const openCr = by(crs, a.id).length;
    let col: Col;
    let tag: [string, string] | null = null;
    if (a.status === "APPROVED") { col = "APPROVED"; tag = ["Approved", "bg-green-100 text-green-800"]; }
    else if (a.status === "IN_REVIEW") { col = "REVIEW"; tag = [`Version ${ver}`, "bg-purple-50 text-purple-700"]; }
    else if (a.status === "CHANGES_REQUESTED") { col = "CHANGES"; tag = [`${openCr} change request${openCr === 1 ? "" : "s"}`, "bg-red-100 text-red-800"]; }
    else if (!hasData) { col = "UPLOAD"; }
    else if (high || open) { col = "FLAGS"; tag = high ? [`${high} high flag${high === 1 ? "" : "s"}`, "bg-red-100 text-red-800"] : [`${open} open flag${open === 1 ? "" : "s"}`, "bg-amber-100 text-amber-800"]; }
    else {
      col = "MODEL";
      const u = keyUnconfirmed(a.id);
      const ran = runs.some((r) => r.analysisId === a.id);
      tag = !by(asm, a.id).length ? ["Set assumptions", "bg-amber-100 text-amber-800"] : u ? [`${u} to confirm`, "bg-amber-100 text-amber-800"] : ran ? ["Model run", "bg-blue-50 text-blue-800"] : null;
    }
    return { a, col, tag, high, seconds: secondsOf(a.id) };
  });

  const approved = card.filter((c) => c.col === "APPROVED" && c.seconds > 0);
  const med = median(approved.map((c) => c.seconds / 3600));
  const pctLess = med !== null ? Math.max(0, Math.min(1, 1 - med / BASELINE_H)) : null;
  const totalH = card.reduce((s, c) => s + c.seconds, 0) / 3600;
  const inProgress = card.filter((c) => c.col !== "APPROVED").length;
  const withReviewer = card.filter((c) => c.col === "REVIEW");

  type Need = { icon: "alert" | "sliders" | "pen" | "check"; tone: string; title: string; sub: string; href: string; cta: string };
  const needs: Need[] = [];
  for (const c of card) {
    const a = c.a;
    if (user.role === "REVIEWER" && a.reviewerId === user.id && a.status === "IN_REVIEW") needs.push({ icon: "check", tone: "bg-purple-50 text-purple-700", title: `${a.company.name} · review requested`, sub: `Submitted by ${a.owner.name}`, href: `/analyses/${a.id}/review`, cta: "Review" });
    if (a.ownerId !== user.id) continue;
    if (c.high) needs.push({ icon: "alert", tone: "bg-red-100 text-red-800", title: `${a.company.name} · ${c.high} high flag${c.high === 1 ? "" : "s"}`, sub: "Ratios and the model are locked until they're cleared", href: `/analyses/${a.id}/validation`, cta: "Review" });
    for (const cr of by(crs, a.id)) needs.push({ icon: cr.type === "WORDING" ? "pen" : "sliders", tone: cr.type === "WORDING" ? "bg-purple-50 text-purple-700" : "bg-amber-100 text-amber-800", title: `${a.company.name} · ${cr.type.toLowerCase()} change`, sub: `“${cr.comment}”`, href: `/analyses/${a.id}/${cr.type === "DATA" ? "data" : cr.type === "ASSUMPTION" ? "model" : "report"}`, cta: cr.type === "WORDING" ? "Edit" : "Update" });
    if (c.col === "MODEL" && c.tag?.[0].includes("confirm")) needs.push({ icon: "sliders", tone: "bg-amber-100 text-amber-800", title: `${a.company.name} · assumptions on defaults`, sub: c.tag[0], href: `/analyses/${a.id}/model`, cta: "Confirm" });
  }
  const ICON = { alert: IconAlert, sliders: IconSliders, pen: IconPen, check: IconCheckSquare };
  const companyOf = (id: string | null) => analyses.find((a) => a.id === id)?.company.name ?? "";
  const hour = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  const view = sp.view === "list" ? "list" : "board";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-gray-500">{today}</span>
          <h1 className="h1">{greet}, {user.name.split(" ")[0]}</h1>
          <p className="text-[15px] text-gray-600">
            {needs.length ? `${needs.length} thing${needs.length === 1 ? "" : "s"} need${needs.length === 1 ? "s" : ""} you.` : "Nothing is waiting for you."}
            {withReviewer.length > 0 && user.role === "ANALYST" && ` ${withReviewer.map((c) => c.a.company.name).join(", ")} ${withReviewer.length === 1 ? "is" : "are"} with the reviewer.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <form className="contents">
            <label htmlFor="search" className="sr-only">Search analyses</label>
            <input id="search" name="q" type="search" defaultValue={q} placeholder="Search companies…" className="input h-11 w-72 max-w-full" />
            {view === "list" && <input type="hidden" name="view" value="list" />}
          </form>
          {user.role === "ANALYST" && <Link href="/analyses/new" className="btn h-11"><IconPlus /> New analysis</Link>}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <section aria-labelledby="time-h" className="card flex flex-[2_1_460px] flex-wrap items-center justify-between gap-6 p-6">
          <div className="flex flex-[1_1_240px] flex-col gap-2">
            <h2 id="time-h" className="eyebrow">Median time per approved report</h2>
            <p className="mono text-6xl font-semibold leading-none tracking-[-0.03em] text-blue-700">{med !== null ? `${med.toFixed(1)} h` : "—"}</p>
            <p className="text-sm leading-relaxed text-gray-600">
              {approved.length ? `${approved.length} approved report${approved.length === 1 ? "" : "s"}, against about ${BASELINE_H} h by hand. ` : "No approved reports with logged time yet. "}
              {totalH.toFixed(1)} h of active time logged in total.
            </p>
          </div>
          <div className="relative h-[150px] w-[150px] shrink-0">
            <svg aria-hidden="true" width="150" height="150" viewBox="0 0 150 150">
              <circle cx="75" cy="75" r="60" fill="none" stroke="#26324f" strokeWidth="14" />
              {pctLess !== null && <circle cx="75" cy="75" r="60" fill="none" stroke="#22d3ee" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(377 * pctLess).toFixed(1)} 377`} transform="rotate(-90 75 75)" />}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="mono text-3xl font-semibold">{pctLess !== null ? `${Math.round(pctLess * 100)}%` : "—"}</span>
              <span className="text-xs text-gray-500">less time</span>
            </div>
          </div>
        </section>
        <div className="grid flex-[1_1_380px] grid-cols-2 gap-4">
          {[
            ["In progress", String(inProgress), `${needs.length} need you`, ""],
            ["With reviewer", String(withReviewer.length), withReviewer[0]?.a.company.name ?? "None", ""],
            ["Open change requests", String(crs.length), crs[0] ? companyOf(crs[0].analysisId) : "None", crs.length ? "text-red-800" : ""],
            ["Approved", String(card.filter((c) => c.col === "APPROVED").length), "read-only reports", ""],
          ].map(([k, v, s, tone]) => (
            <div key={k} className="rounded-[18px] border border-gray-200 bg-white p-[18px]">
              <p className="text-[13px] font-medium text-gray-500">{k}</p>
              <p className={`mono mt-2 mb-0.5 text-[32px] font-semibold ${tone}`}>{v}</p>
              <p className="truncate text-xs text-gray-600">{s}</p>
            </div>
          ))}
        </div>
      </div>

      <section aria-labelledby="pipe-h" className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="pipe-h" className="h2">Pipeline</h2>
          <div role="group" aria-label="View" className="flex gap-1 rounded-xl border border-gray-200 bg-[#0b1020] p-1">
            {(["board", "list"] as const).map((v) => (
              <Link key={v} href={`/?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-pressed={view === v} className={`flex min-h-9 items-center rounded-lg px-3.5 text-[13px] ${view === v ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-600 hover:text-gray-900"}`}>{v === "board" ? "Board" : "List"}</Link>
            ))}
          </div>
        </div>
        {view === "board" ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[900px] grid-cols-6 gap-2.5">
              {COLS.map(([key, label]) => {
                const items = card.filter((c) => c.col === key);
                return (
                  <div key={key} className="flex flex-col gap-2.5">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-[0.06em] text-gray-500"><span>{label}</span><span className="mono">{items.length}</span></div>
                    {items.map(({ a, tag, seconds }) => (
                      <Link key={a.id} href={`/analyses/${a.id}${key === "UPLOAD" ? "/data" : key === "FLAGS" ? "/validation" : key === "MODEL" ? "/model" : key === "APPROVED" ? "" : "/review"}`} className={`flex flex-col gap-2.5 rounded-[14px] border bg-gray-50 p-3.5 hover:bg-gray-100 ${key === "CHANGES" ? "border-red-200" : key === "REVIEW" ? "border-[#3b4799]" : "border-gray-200"}`}>
                        <span className="text-sm font-semibold">{a.company.name}</span>
                        <span className="-mt-1.5 text-xs text-gray-500">{a.purpose ?? `FY${a.fyFrom}–FY${a.fyTo}`}</span>
                        {tag && <span className={`badge self-start uppercase ${tag[1]}`}>{tag[0]}</span>}
                        {key === "UPLOAD" && <div className="h-1 rounded-full bg-gray-200"><div className="h-1 w-[12%] rounded-full bg-[#818cf8]" /></div>}
                        <div className="flex items-center justify-between"><Avatar name={a.owner.name} /><span className="mono text-xs text-gray-600">{hoursLabel(seconds)}</span></div>
                      </Link>
                    ))}
                    {!items.length && <div className="rounded-[14px] border border-dashed border-gray-200 p-3.5 text-center text-xs text-gray-400">Empty</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Company</th><th>Periods</th><th>Analyst</th><th>Reviewer</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {analyses.map((a) => (
                  <tr key={a.id}>
                    <td><Link className="font-semibold hover:text-blue-700" href={`/analyses/${a.id}`}>{a.company.name}</Link> <span className="muted">{a.company.nse}</span></td>
                    <td>FY{a.fyFrom}–FY{a.fyTo}</td>
                    <td>{a.owner.name}</td>
                    <td>{a.reviewer.name}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td className="muted">{fmtDate(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!analyses.length && <p className="muted py-6 text-center">{q ? `No analyses match “${q}”.` : "No analyses yet."}</p>}
      </section>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-labelledby="needs-h" className="card flex flex-[1_1_420px] flex-col gap-2.5">
          <h2 id="needs-h" className="h2 mb-1">Needs you</h2>
          {needs.slice(0, 6).map((n, i) => {
            const I = ICON[n.icon];
            return (
              <div key={i} className="flex flex-wrap items-center gap-3.5 rounded-[14px] bg-gray-50 p-3.5">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${n.tone}`}><I /></span>
                <div className="min-w-0 flex-[1_1_180px]"><p className="text-sm font-semibold">{n.title}</p><p className="mt-0.5 truncate text-[13px] text-gray-500">{n.sub}</p></div>
                <Link href={n.href} className="btn-secondary min-h-10 px-3.5 text-[13px]">{n.cta}</Link>
              </div>
            );
          })}
          {!needs.length && <p className="muted text-sm">You&apos;re all caught up.</p>}
        </section>
        <section aria-labelledby="act-h" className="card flex flex-[1_1_420px] flex-col gap-1">
          <h2 id="act-h" className="h2 mb-2.5">Activity</h2>
          {logs.map((l) => {
            const sys = SYSTEM_ACTIONS.has(l.action);
            return (
              <div key={l.id} className="flex gap-3.5 py-2.5">
                <span className="mono w-[86px] shrink-0 pt-0.5 text-xs text-gray-500">{new Date(l.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}</span>
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${sys ? "bg-[#22d3ee]" : "bg-[#818cf8]"}`} />
                <p className="text-sm leading-relaxed">{sentence(l.action, l.userId === user.id ? "You" : l.userName, companyOf(l.analysisId), JSON.parse(l.detail))}</p>
              </div>
            );
          })}
          {!logs.length && <p className="muted text-sm">No activity yet.</p>}
          <p className="mt-2 text-xs text-gray-500">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#22d3ee]" />App
            <span className="mr-1.5 ml-3.5 inline-block h-2 w-2 rounded-full bg-[#818cf8]" />People
          </p>
        </section>
      </div>
    </div>
  );
}
