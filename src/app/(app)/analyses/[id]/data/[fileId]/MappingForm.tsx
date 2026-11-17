"use client";
import { Checklist } from "@/components/ui";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parsePeriodHeader } from "@/lib/periods";

type Cell = string | number | null;
type Sheet = { name: string; rows: Cell[][] };
type Saved = { sheet?: string; headerRow?: number; labelCol?: number; quarterly?: boolean; unit?: string; currency?: string; fx?: string; labelMap?: Record<string, string> } | null;

const colName = (i: number) => String.fromCharCode(65 + (i % 26)).padStart(i >= 26 ? 2 : 1, "A");

export default function MappingForm(props: {
  sheets: Sheet[];
  saved: Saved;
  suggestions: Record<string, string>;
  lineItems: { key: string; label: string; statement: string }[];
  companies: { id: string; name: string }[];
  onApply: (cfg: string) => Promise<{ ok?: boolean; error?: string; count?: number; unmapped?: string[]; errors?: string[] }>;
  backHref: string;
}) {
  const router = useRouter();
  const s0 = props.sheets.find((s) => s.name === props.saved?.sheet) ?? props.sheets[0];
  const [sheetName, setSheetName] = useState(s0?.name ?? "");
  const sheet = props.sheets.find((s) => s.name === sheetName) ?? props.sheets[0];
  const guessHeader = (s: Sheet, q: boolean) => {
    let best = 0, n = 0;
    s.rows.slice(0, 25).forEach((r, i) => { const k = r.filter((c) => parsePeriodHeader(c, q)).length; if (k > n) { n = k; best = i; } });
    return best;
  };
  const [quarterly, setQuarterly] = useState(props.saved?.quarterly ?? false);
  const [headerRow, setHeaderRow] = useState(props.saved?.headerRow ?? guessHeader(sheet, quarterly));
  const [labelCol, setLabelCol] = useState(props.saved?.labelCol ?? 0);
  const [unit, setUnit] = useState(props.saved?.unit ?? "crore");
  const [currency, setCurrency] = useState(props.saved?.currency ?? "INR");
  const [fx, setFx] = useState(props.saved?.fx ?? "");
  const [companyId, setCompanyId] = useState(props.companies[0]?.id ?? "");
  const [periodOverrides, setPeriodOverrides] = useState<Record<string, string>>({});
  const [labelMap, setLabelMap] = useState<Record<string, string>>(props.saved?.labelMap ?? {});
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const header = useMemo(() => sheet?.rows[headerRow] ?? [], [sheet, headerRow]);
  const detected = useMemo(() => {
    const out: Record<string, string> = {};
    header.forEach((c, i) => { const p = parsePeriodHeader(c, quarterly); if (p && i !== labelCol) out[String(i)] = p; });
    return out;
  }, [header, quarterly, labelCol]);
  const periodCols = useMemo(() => {
    const out: Record<string, string> = { ...detected };
    for (const [k, v] of Object.entries(periodOverrides)) { if (v) out[k] = v; else delete out[k]; }
    return out;
  }, [detected, periodOverrides]);

  const labels = useMemo(() => {
    const seen: string[] = [];
    for (const r of sheet?.rows.slice(headerRow + 1) ?? []) {
      const l = String(r[labelCol] ?? "").trim();
      if (l && !seen.includes(l)) seen.push(l);
    }
    return seen;
  }, [sheet, headerRow, labelCol]);
  const mapOf = (l: string) => labelMap[l] ?? props.suggestions[l] ?? "";
  const unmappedCount = labels.filter((l) => !mapOf(l)).length;

  const submit = () => {
    const full: Record<string, string> = {};
    for (const l of labels) { const m = mapOf(l); if (m) full[l] = m; }
    const cfg = { sheet: sheetName, headerRow, labelCol, quarterly, unit, currency, fx: currency === "INR" ? "1" : fx, companyId, periodCols, labelMap: full };
    start(async () => {
      const r = await props.onApply(JSON.stringify(cfg));
      if (r.error) setResult(`Error: ${r.error}`);
      else { router.push(`${props.backHref}?msg=${encodeURIComponent(`Imported ${r.count} values.${r.errors?.length ? " " + r.errors.slice(0, 3).join("; ") : ""}`)}`); }
    });
  };

  const maxCols = Math.max(...(sheet?.rows.slice(0, 50).map((r) => r.length) ?? [0]));

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><label className="label">Sheet</label>
          <select className="input" value={sheetName} onChange={(e) => { setSheetName(e.target.value); const s = props.sheets.find((x) => x.name === e.target.value)!; setHeaderRow(guessHeader(s, quarterly)); }}>
            {props.sheets.map((s) => <option key={s.name}>{s.name}</option>)}
          </select></div>
        <div><label className="label">Header row (periods)</label>
          <input className="input" type="number" min={1} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, Number(e.target.value) - 1))} /></div>
        <div><label className="label">Line-item label column</label>
          <select className="input" value={labelCol} onChange={(e) => setLabelCol(Number(e.target.value))}>
            {Array.from({ length: maxCols }, (_, i) => <option key={i} value={i}>{colName(i)}</option>)}
          </select></div>
        <div><label className="label">Company</label>
          <select className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {props.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div><label className="label">Periods are</label>
          <select className="input" value={quarterly ? "Q" : "A"} onChange={(e) => setQuarterly(e.target.value === "Q")}><option value="A">Annual (March year-end)</option><option value="Q">Quarterly</option></select></div>
        <div><label className="label">Unit</label>
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{["crore", "lakh", "million", "billion", "thousand", "units"].map((u) => <option key={u}>{u}</option>)}</select></div>
        <div><label className="label">Currency</label>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></div>
        {currency !== "INR" && <div><label className="label">FX: ₹ per 1 {currency}</label><input className="input" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="e.g. 83.50" /></div>}
      </div>

      <div className="card">
        <h3 className="h2 mb-2">Period columns</h3>
        <div className="flex flex-wrap gap-3">
          {header.map((c, i) => i === labelCol ? null : (
            <div key={i} className="text-xs">
              <div className="muted">{colName(i)}: {String(c ?? "")}</div>
              <input className="input w-28" value={periodCols[String(i)] ?? ""} placeholder="skip" onChange={(e) => setPeriodOverrides((p) => ({ ...p, [String(i)]: e.target.value.toUpperCase() }))} />
            </div>
          ))}
        </div>
        <p className="muted mt-2 text-xs">Use FY2025 for a March-2025 year or Q1FY26 for a quarter. Leave blank to skip a column.</p>
      </div>

      <div className="card p-0">
        <div className="flex items-center justify-between px-4 pt-3">
          <h3 className="h2">Line items ({labels.length}) {unmappedCount > 0 && <span className="badge ml-2 bg-amber-100 text-amber-800">{unmappedCount} not mapped</span>}</h3>
          <span className="muted text-xs">Map each source label to the standard chart of accounts, or ignore it.</span>
        </div>
        <table className="tbl mt-2">
          <thead><tr><th>Source label</th><th>Sample values</th><th>Maps to</th></tr></thead>
          <tbody>
            {labels.map((l) => {
              const row = sheet.rows.slice(headerRow + 1).find((r) => String(r[labelCol] ?? "").trim() === l) ?? [];
              const samples = Object.keys(periodCols).slice(0, 3).map((ci) => row[Number(ci)]).filter((x) => x !== null && x !== undefined);
              const m = mapOf(l);
              return (
                <tr key={l} className={!m ? "bg-amber-50/50" : ""}>
                  <td>{l}</td>
                  <td className="muted text-xs">{samples.join(" · ")}</td>
                  <td>
                    <select className="input" value={m} onChange={(e) => setLabelMap((p) => ({ ...p, [l]: e.target.value }))}>
                      <option value="">— choose —</option>
                      <option value="ignore">Ignore this row</option>
                      {["IS", "BS", "CF", "MKT"].map((st) => (
                        <optgroup key={st} label={{ IS: "Income statement", BS: "Balance sheet", CF: "Cash flow", MKT: "Market" }[st]}>
                          {props.lineItems.filter((x) => x.statement === st).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{result}</div>}
      <Checklist
        id="import-needs"
        title="Before you can import this file:"
        items={[
          {
            ok: Object.keys(periodCols).length > 0,
            text: "Tell us which columns hold which year or quarter",
            hint: "In “Period columns” above, type the period under each column that has numbers, for example FY2025 for the year ending March 2025 or Q1FY26 for a quarter.",
          },
          {
            ok: currency === "INR" || !!fx.trim(),
            text: `Enter the exchange rate for ${currency}`,
            hint: `The file is in ${currency}. Type how many rupees one ${currency} was worth (for example 83.50) in the FX box above, so the numbers can be converted to rupees.`,
          },
        ]}
      />
      <div className="flex gap-2">
        <button className="btn" onClick={submit} aria-describedby="import-needs" disabled={pending || !Object.keys(periodCols).length || (currency !== "INR" && !fx.trim())}>{pending ? "Importing…" : `Import (${unmappedCount ? unmappedCount + " unmapped rows will be skipped" : "all rows mapped"})`}</button>
        <a className="btn-secondary" href={props.backHref}>Cancel</a>
      </div>
    </div>
  );
}
