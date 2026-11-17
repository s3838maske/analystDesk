import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { ensureAssumptions, latestRun, loadAnalysis, lockReason, modelBlockers, openHighFlags } from "@/server/analysis";
import { ASSUMPTIONS } from "@/lib/model";
import { D } from "@/lib/decimal";
import { formatIndian, formatMoney } from "@/lib/units";
import { Notice, Num, OriginTag, fmtDate, Locked, Checklist } from "@/components/ui";
import Blocked from "@/components/Blocked";
import { resetAssumption, saveAssumptions } from "./actions";
import Link from "next/link";

const pct = (v: string | null | undefined, dp = 1) => (v ? D(v).mul(100).toFixed(dp) + "%" : "—");
const cr = (v: string | null | undefined) => (v ? formatMoney(D(v), "crore", 0) : "—");
const rs = (v: string | null | undefined) => (v ? formatIndian(D(v), 2) : "—");
const xx = (v: string | null | undefined) => (v ? D(v).toFixed(1) + "x" : "—");

export default async function ModelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const a = await loadAnalysis(id);
  const high = await openHighFlags(id);
  if (high) return <Blocked id={id} high={high} step="The Model step" />;
  const asm = await ensureAssumptions(a);
  const lock = lockReason(a, user, "ASSUMPTIONS");
  const blocker = await modelBlockers(a);
  const run = await latestRun(id);
  const values = await prisma.financialValue.count({ where: { analysisId: id, active: true } });
  const stale = run && asm.some((x) => run.inputs.assumptions[x.key] !== x.value);
  const o = run?.outputs;
  const m = (k: string) => (run ? `m:${run.id}:${k}` : null);

  return (
    <div className="space-y-5">
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.err && <Notice kind="error">{sp.err}</Notice>}
      {lock && <Locked why={lock} />}
      

      <form action={saveAssumptions.bind(null, id)} className="card p-0">
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="h2">Assumptions</h2>
          <span className="muted text-xs">Defaults come from history and are marked “auto”. Assumptions marked * are key: tick “Confirmed” next to each one before the model can run.</span>
        </div>
        <table className="tbl mt-2">
          <thead><tr><th>Assumption</th><th>Value (%)</th><th>Default</th><th>Basis</th><th>Confirmed</th><th></th></tr></thead>
          <tbody>
            {ASSUMPTIONS.map((d) => {
              const x = asm.find((y) => y.key === d.key)!;
              return (
                <tr key={d.key}>
                  <td>{d.label}{d.key_ && <span className="ml-1 text-red-600" title="Key assumption">*</span>}<OriginTag origin={x.origin} /></td>
                  <td><input className="input w-24 text-right" name={d.key} defaultValue={D(x.value).mul(100).toDecimalPlaces(2).toString()} disabled={!!lock} /></td>
                  <td className="muted">{pct(x.defaultValue, 2)}</td>
                  <td className="muted text-xs">{x.basis}</td>
                  <td>{d.key_ ? <input type="checkbox" name={`confirm_${d.key}`} defaultChecked={x.confirmed} disabled={!!lock} /> : <span className="muted text-xs">n/a</span>}</td>
                  <td>{x.value !== x.defaultValue && !lock && <button formAction={resetAssumption.bind(null, id, d.key)} className="text-xs text-blue-700 hover:underline">reset</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center gap-3 px-4 py-3">
          <input className="input max-w-md" name="reason" placeholder="Note for the audit trail (optional)" disabled={!!lock} />
          <button className="btn" disabled={!!lock}>Save and run model</button>
          {lock && <span className="text-[13px] text-gray-500">Turned off because this step is locked (see the note at the top).</span>}
        </div>
        {!lock && (blocker || !values) && (
          <div className="px-4 pb-4">
            <Checklist
              title="Before the model can run:"
              items={[
                { ok: values > 0, text: "Upload the company’s financial data", hint: "The model is built from your uploaded numbers, and nothing has been uploaded yet.", href: `/analyses/${id}/data`, cta: "Go to Upload data" },
                { ok: !blocker, text: "Confirm the key assumptions", hint: blocker ?? undefined },
              ]}
            />
          </div>
        )}
      </form>

      {run && o && (
        <>
          {stale && <Notice kind="warn">Assumptions changed since the last run. Save to re-run.</Notice>}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="muted">Model run {fmtDate(run.createdAt)} · formula version {run.formulaVersion} · base year {run.inputs.baseYear}</span>
            <span className={`badge ${o.checks.balanced ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{o.checks.balanced ? "Balance sheet balances every year" : `Imbalance up to ₹${o.checks.maxImbalance}`}</span>
            <a className="btn-secondary ml-auto" href={`/api/analyses/${id}/export/xlsx`}>Export model (.xlsx, live formulas)</a>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            {[
              ["DCF value per share", `₹${rs(o.dcf.per_share)}`, m("dcf.per_share")],
              ["Current price", `₹${rs(o.dcf.price)}`, run.inputs.base.price.ref],
              ["Difference to price", (D(o.dcf.upside).isPos() ? "+" : "") + pct(o.dcf.upside), m("dcf.upside")],
              ["Comps range", o.comps.low && o.comps.high ? `₹${rs(o.comps.low)} – ₹${rs(o.comps.high)}` : "—", m("comps.low")],
            ].map(([label, val, ref]) => (
              <div key={label} className="card"><div className="muted text-xs">{label}</div><div className="text-xl font-semibold"><Num analysisId={id} refKey={ref}>{val}</Num></div></div>
            ))}
          </div>

          <div className="card overflow-x-auto p-0">
            <h2 className="h2 px-4 pt-3">Forecast (₹ crore)</h2>
            <table className="tbl mt-2">
              <thead><tr><th></th>{o.years.map((y) => <th key={y} className="num">{y}</th>)}</tr></thead>
              <tbody>
                {([
                  ["Income statement", null], ["Revenue", "revenue"], ["EBITDA", "ebitda"], ["D&A", "dep"], ["EBIT", "ebit"], ["Interest", "interest"], ["PBT", "pbt"], ["Tax", "tax"], ["PAT", "pat"],
                  ["Balance sheet", null], ["Cash", "cash"], ["Net working capital", "nwc"], ["Net fixed assets", "nfa"], ["Other net assets", "other_net"], ["Total equity", "equity"], ["Total debt", "debt"],
                  ["Cash flow", null], ["CFO", "cfo"], ["Capex", "capex"], ["Dividends", "dividends"], ["Free cash flow to firm", "fcff"], ["PV of FCFF", "pv_fcff"],
                ] as [string, string | null][]).map(([label, k]) => k ? (
                  <tr key={label}><td>{label}</td>{o.years.map((y) => <td key={y} className="num"><Num analysisId={id} refKey={m(`forecast.${y}.${k}`)}>{cr(o.forecast[y][k])}</Num></td>)}</tr>
                ) : <tr key={label}><td colSpan={6} className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</td></tr>)}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-0">
              <h2 className="h2 px-4 pt-3">DCF</h2>
              <table className="tbl mt-2">
                <tbody>
                  {([["Sum of PV of FCFF", "sum_pv_fcff", "cr"], ["PV of terminal value", "pv_terminal_value", "cr"], ["Enterprise value", "enterprise_value", "cr"], ["Less: debt", "less_debt", "cr"], ["Plus: cash", "plus_cash", "cr"], ["Equity value", "equity_value", "cr"], ["Value per share (₹)", "per_share", "rs"], ["Terminal value share of EV", "tv_share_of_ev", "pct"]] as const).map(([label, k, f]) => (
                    <tr key={k}><td>{label}{f === "cr" ? " (₹ cr)" : ""}</td><td className="num"><Num analysisId={id} refKey={m(`dcf.${k}`)}>{f === "cr" ? cr(o.dcf[k]) : f === "rs" ? rs(o.dcf[k]) : pct(o.dcf[k])}</Num></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card p-0">
              <h2 className="h2 px-4 pt-3">Sensitivity: value per share (₹)</h2>
              <table className="tbl mt-2">
                <thead><tr><th>WACC \ g</th>{o.sensitivity.growths.map((g) => <th key={g} className="num">{pct(g)}</th>)}</tr></thead>
                <tbody>
                  {o.sensitivity.waccs.map((w, i) => (
                    <tr key={w}><th>{pct(w)}</th>{o.sensitivity.grid[i].map((c, j) => <td key={j} className={`num ${i === 2 && j === 2 ? "bg-blue-50 font-semibold" : ""}`}><Num analysisId={id} refKey={m(`sensitivity.${i}.${j}`)}>{c ? rs(c) : "n/a"}</Num></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-0">
            <h2 className="h2 px-4 pt-3">Trading comparables (latest price, base-year earnings)</h2>
            <table className="tbl mt-2">
              <thead><tr><th>Peer</th><th className="num">P/E</th><th className="num">EV/EBITDA</th></tr></thead>
              <tbody>
                {run.inputs.peers.map((p) => <tr key={p.companyId}><td>{p.name}</td><td className="num">{xx(p.pe)}</td><td className="num">{xx(p.ev_ebitda)}</td></tr>)}
                {(["pe", "ev_ebitda"] as const).map((k) => {
                  const r = o.comps[k];
                  return <tr key={k} className="bg-gray-50"><td className="font-medium">Implied value per share via {k === "pe" ? "P/E" : "EV/EBITDA"} (min · median · max)</td><td colSpan={2} className="num">{r ? <Num analysisId={id} refKey={m(`comps.${k}.implied_mid`)}>₹{rs(r.implied_low)} · ₹{rs(r.implied_mid)} · ₹{rs(r.implied_high)}</Num> : "Not enough peer data"}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end"><Link href={`/analyses/${id}/report`} className="btn">Next: report →</Link></div>
        </>
      )}
    </div>
  );
}
