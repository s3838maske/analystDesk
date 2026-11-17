import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { loadAnalysis, lockReason } from "@/server/analysis";
import { LINE_ITEMS, STATEMENT_NAMES, Statement } from "@/lib/coa";
import { annualPeriods, sortPeriods, isPriceDate } from "@/lib/periods";
import { formatIndian, formatMoney } from "@/lib/units";
import { D } from "@/lib/decimal";
import { Num, Notice, OriginTag, fmtDate, Locked } from "@/components/ui";
import { addManualPrice, uploadFile } from "./actions";

export default async function DataPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string; company?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const a = await loadAnalysis(id);
  const lock = lockReason(a, user, "DATA");
  const files = await prisma.uploadedFile.findMany({ where: { analysisId: id }, orderBy: { uploadedAt: "desc" }, include: { _count: { select: { values: { where: { active: true } } } } } });
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const companies = [{ id: a.companyId, name: a.company.name }, ...a.peers.map((p) => ({ id: p.id, name: p.name }))];
  const selected = companies.find((c) => c.id === sp.company) ?? companies[0];
  const values = await prisma.financialValue.findMany({ where: { analysisId: id, companyId: selected.id, active: true }, orderBy: { createdAt: "asc" } });
  // the cell shown = the one the dataset uses (analyst values beat automated; latest wins)
  const cell = new Map<string, (typeof values)[number]>();
  for (const v of [...values].sort((x, y) => (x.origin === "AUTOMATED" ? 0 : 1) - (y.origin === "AUTOMATED" ? 0 : 1) || x.createdAt.getTime() - y.createdAt.getTime())) cell.set(`${v.period}|${v.lineItem}`, v);
  const expected = [...annualPeriods(a.fyFrom, a.fyTo), ...(selected.id === a.companyId ? a.quartersArr : [])];
  const periods = sortPeriods([...new Set([...expected, ...values.map((v) => v.period).filter((p) => !isPriceDate(p))])]);
  const prices = values.filter((v) => isPriceDate(v.period)).sort((x, y) => y.period.localeCompare(x.period));
  const priceDates = [...new Set(prices.map((p) => p.period))].slice(0, 8);

  return (
    <div className="space-y-5">
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.err && <Notice kind="error">{sp.err}</Notice>}
      {lock && <Locked why={lock} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <form action={uploadFile.bind(null, id)} className="card space-y-3 lg:col-span-2">
          <h2 className="h2">Upload data</h2>
          <p className="muted text-sm">
            Excel or CSV in the <a className="text-blue-700 underline" href="/api/template">standard template</a> imports directly. Other layouts open the column-mapping screen. PDFs and XBRL files are stored as source documents.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">File</label>
              <input className="input" type="file" name="file" accept=".xlsx,.xls,.xlsm,.csv,.pdf,.xml,.xbrl,.zip" required disabled={!!lock} />
            </div>
            <div>
              <label className="label">Source (as you want it cited)</label>
              <input className="input" name="sourceLabel" placeholder='e.g. "Annual report FY25", "terminal export"' required disabled={!!lock} />
            </div>
            <div>
              <label className="label">Contains</label>
              <select className="input" name="kind" disabled={!!lock}>
                <option value="FINANCIALS">Financial statements</option>
                <option value="PRICES">Prices / shares outstanding</option>
              </select>
            </div>
            <div>
              <label className="label">Company (for price files without a company column)</label>
              <select className="input" name="companyId" disabled={!!lock}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <button className="btn" disabled={!!lock}>Upload</button>
        </form>

        <form action={addManualPrice.bind(null, id)} className="card space-y-3">
          <h2 className="h2">Enter price manually</h2>
          <select className="input" name="companyId" disabled={!!lock}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Date</label><input className="input" type="date" name="date" disabled={!!lock} /></div>
            <div><label className="label">Close (₹)</label><input className="input" name="price" inputMode="decimal" disabled={!!lock} /></div>
            <div><label className="label">Shares outstanding</label><input className="input" name="shares" inputMode="decimal" disabled={!!lock} /></div>
            <div><label className="label">Shares unit</label>
              <select className="input" name="sharesUnit" disabled={!!lock}><option value="units">number</option><option value="lakh">lakh</option><option value="crore">crore</option><option value="million">million</option></select>
            </div>
          </div>
          <button className="btn-secondary" disabled={!!lock}>Save</button>
        </form>
      </div>

      <div className="card p-0">
        <div className="px-4 pt-3"><h2 className="h2">Uploaded files</h2><p className="muted text-xs">Every file is stored unchanged. Values below link back to the exact cell.</p></div>
        <table className="tbl mt-2">
          <thead><tr><th>File</th><th>Source</th><th>Contains</th><th>Uploaded</th><th>Status</th><th className="num">Values in use</th><th></th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td><a className="text-blue-700 hover:underline" href={`/api/analyses/${id}/files/${f.id}`}>{f.fileName}</a> <span className="muted text-xs">{(f.sizeBytes / 1024).toFixed(0)} KB · sha256 {f.sha256.slice(0, 10)}…</span></td>
                <td>{f.sourceLabel}</td>
                <td>{f.kind === "PRICES" ? "Prices" : "Financials"}</td>
                <td className="muted">{users.find((u) => u.id === f.uploadedBy)?.name} · {fmtDate(f.uploadedAt)}</td>
                <td>{{ PENDING_MAPPING: "Needs mapping", IMPORTED: "Imported", STORED: "Stored (not parsed)" }[f.status] ?? f.status}</td>
                <td className="num">{f._count.values}</td>
                <td>{f.status !== "STORED" && !lock && <Link className="text-blue-700 hover:underline" href={`/analyses/${id}/data/${f.id}`}>{f.status === "PENDING_MAPPING" ? "Map columns" : "Re-map"}</Link>}</td>
              </tr>
            ))}
            {!files.length && <tr><td colSpan={7} className="muted py-4 text-center">No files yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card space-y-3 p-0">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <h2 className="h2 mr-2">Stored values (₹ crore)</h2>
          {companies.map((c) => (
            <Link key={c.id} href={`/analyses/${id}/data?company=${c.id}`} className={`badge ${c.id === selected.id ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>{c.name}</Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Line item</th>{periods.map((p) => <th key={p} className="num">{p}</th>)}</tr></thead>
            <tbody>
              {(["IS", "BS", "CF"] as Statement[]).map((st) => [
                <tr key={st}><td colSpan={periods.length + 1} className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">{STATEMENT_NAMES[st]}</td></tr>,
                ...LINE_ITEMS.filter((li) => li.statement === st).map((li) => (
                  <tr key={li.key}>
                    <td>{li.label}</td>
                    {periods.map((p) => {
                      const v = cell.get(`${p}|${li.key}`);
                      return (
                        <td key={p} className="num whitespace-nowrap">
                          {v ? <><Num analysisId={id} refKey={`v:${selected.id}:${p}:${li.key}`}>{formatMoney(D(v.value), "crore", 2)}</Num>{v.origin !== "AUTOMATED" && <OriginTag origin={v.origin} />}</> : <span className="text-gray-300">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4">
          <h3 className="mb-1 text-sm font-semibold">Latest prices and shares</h3>
          {priceDates.length ? (
            <table className="tbl w-auto">
              <thead><tr><th>Date</th><th className="num">Close (₹)</th><th className="num">Shares outstanding</th></tr></thead>
              <tbody>
                {priceDates.map((d) => {
                  const pr = cell.get(`${d}|price`), sh = cell.get(`${d}|shares_outstanding`);
                  return (
                    <tr key={d}>
                      <td>{d.slice(1)}</td>
                      <td className="num">{pr ? <><Num analysisId={id} refKey={`v:${selected.id}:${d}:price`}>{formatIndian(D(pr.value))}</Num><OriginTag origin={pr.origin} /></> : "—"}</td>
                      <td className="num">{sh ? <><Num analysisId={id} refKey={`v:${selected.id}:${d}:shares_outstanding`}>{formatIndian(D(sh.value), 0)}</Num><OriginTag origin={sh.origin} /></> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="muted text-sm">No prices yet.</p>}
        </div>
      </div>
      <div className="flex justify-end"><Link href={`/analyses/${id}/validation`} className="btn">Next: review flags →</Link></div>
    </div>
  );
}
