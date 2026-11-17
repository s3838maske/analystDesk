import Link from "next/link";
import { requireUser } from "@/server/auth";
import { loadAnalysis, loadDataset, openHighFlags } from "@/server/analysis";
import { RATIOS, RATIO_BY_KEY, computeRatios, formatRatio, peerComparison } from "@/lib/ratios";

const HEADLINE = ["ebitda_margin", "roce", "roe", "net_margin", "revenue_growth", "ev_ebitda"];
import { annualPeriods } from "@/lib/periods";
import { Num } from "@/components/ui";
import Blocked from "@/components/Blocked";

export default async function RatiosPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  await requireUser();
  const a = await loadAnalysis(id);
  const high = await openHighFlags(id);
  if (high) return <Blocked id={id} high={high} step="The Ratios step" />;
  const ds = await loadDataset(id);
  const periods = annualPeriods(a.fyFrom, a.fyTo);
  const byPeriod = Object.fromEntries(periods.map((p) => [p, computeRatios(ds, a.companyId, p)]));
  const cmpPeriod = periods.includes(sp.period ?? "") ? sp.period! : periods[periods.length - 1];
  const pc = peerComparison(ds, a.companyId, a.peerIdsArr, cmpPeriod);
  const peerVals = a.peers.map((p) => ({ p, r: computeRatios(ds, p.id, cmpPeriod) }));
  const groups = [...new Set(RATIOS.map((r) => r.group))];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {HEADLINE.map((k) => {
          const r = RATIO_BY_KEY[k];
          const base = periods[periods.length - 1];
          const v = byPeriod[base][k].value;
          const med = peerComparison(ds, a.companyId, a.peerIdsArr, base)[k].median;
          const diff = v && med ? v.minus(med) : null;
          const diffTxt = diff ? (r.format === "pct" ? `${diff.isNeg() ? "" : "+"}${diff.mul(100).toFixed(1)} pp` : `${diff.isNeg() ? "" : "+"}${diff.toFixed(1)}x`) : "no peer data";
          const series = periods.map((p) => byPeriod[p][k].value?.toNumber() ?? null);
          const vals = series.filter((x): x is number => x !== null);
          const lo = Math.min(...vals), hi = Math.max(...vals);
          const pts = series.map((x, i) => (x === null ? null : `${(i / Math.max(1, periods.length - 1)) * 100},${hi === lo ? 14 : 26 - ((x - lo) / (hi - lo)) * 24}`)).filter(Boolean).join(" ");
          return (
            <Link key={k} href={`/analyses/${id}/lineage?ref=${encodeURIComponent(`r:${a.companyId}:${base}:${k}`)}`} className="flex flex-col gap-1.5 rounded-[18px] border border-gray-200 bg-white p-4 hover:border-gray-300 hover:bg-gray-50">
              <span className="text-[13px] font-medium text-gray-500">{r.label}</span>
              <span className="mono text-[26px] font-semibold">{formatRatio(v, r.format)}</span>
              <span className={`text-xs font-semibold ${!diff ? "text-gray-500" : diff.isNeg() ? "text-amber-800" : "text-blue-800"}`}>{diffTxt}{diff ? " vs peers" : ""}</span>
              {vals.length > 1 && <svg aria-hidden="true" viewBox="0 0 100 28" preserveAspectRatio="none" className="mt-1 h-7 w-full"><polyline points={pts} fill="none" stroke="#818cf8" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>}
            </Link>
          );
        })}
      </div>
      <p className="muted text-sm">{periods[periods.length - 1]} vs peer median, trend {periods[0]}–{periods[periods.length - 1]}. Click any card or number to see its formula and inputs. Ratio formulas: version ratios-v1.</p>
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>{a.company.name}</th>{periods.map((p) => <th key={p} className="num">{p}</th>)}</tr></thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g}><td colSpan={periods.length + 1} className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">{g}</td></tr>,
              ...RATIOS.filter((r) => r.group === g).map((r) => (
                <tr key={r.key}>
                  <td title={byPeriod[periods[0]][r.key].formula}>{r.label} <span className="muted text-xs">{byPeriod[periods[0]][r.key].formula}</span></td>
                  {periods.map((p) => <td key={p} className="num"><Num analysisId={id} refKey={`r:${a.companyId}:${p}:${r.key}`}>{formatRatio(byPeriod[p][r.key].value, r.format)}</Num></td>)}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto p-0">
        <div className="flex items-center gap-2 px-4 pt-3">
          <h2 className="h2">Peer comparison</h2>
          {periods.map((p) => <Link key={p} href={`?period=${p}`} className={`badge ${p === cmpPeriod ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-700"}`}>{p}</Link>)}
        </div>
        <table className="tbl mt-2">
          <thead>
            <tr><th>Ratio</th><th className="num">{a.company.name}</th><th className="num">Peer median</th><th className="num">Min</th><th className="num">Max</th>{peerVals.map(({ p }) => <th key={p.id} className="num text-gray-400">{p.name}</th>)}</tr>
          </thead>
          <tbody>
            {RATIOS.map((r) => {
              const s = pc[r.key];
              const above = s.company && s.median ? s.company.gt(s.median) : null;
              return (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className={`num font-medium ${above === null ? "" : above ? "text-emerald-700" : "text-amber-700"}`}><Num analysisId={id} refKey={`r:${a.companyId}:${cmpPeriod}:${r.key}`}>{formatRatio(s.company, r.format)}</Num></td>
                  <td className="num">{formatRatio(s.median, r.format)} <span className="muted text-xs">n={s.n}</span></td>
                  <td className="num">{formatRatio(s.min, r.format)}</td>
                  <td className="num">{formatRatio(s.max, r.format)}</td>
                  {peerVals.map(({ p, r: pr }) => <td key={p.id} className="num text-gray-500"><Num analysisId={id} refKey={`r:${p.id}:${cmpPeriod}:${r.key}`}>{formatRatio(pr[r.key].value, r.format)}</Num></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted px-4 py-2 text-xs">Green = above peer median, amber = below. Whether higher is better depends on the ratio. Valuation multiples use the last close on or before 31 March.</p>
      </div>
      <div className="flex justify-end"><Link href={`/analyses/${id}/model`} className="btn">Next: assumptions and model →</Link></div>
    </div>
  );
}
