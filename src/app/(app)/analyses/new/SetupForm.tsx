"use client";
import { useMemo, useState } from "react";
import { Checklist, type Need } from "@/components/ui";

type Co = { id: string; name: string; nse: string; bse: string | null; sector: string };

export default function SetupForm(props: {
  action: (fd: FormData) => void;
  companies: Co[];
  reviewers: { id: string; name: string }[];
  templates: { id: string; name: string; companyIds: string[] }[];
  defaultFrom: number;
  defaultTo: number;
  quarters: string[];
}) {
  const [q, setQ] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [peers, setPeers] = useState<string[]>([]);
  const [reviewerId, setReviewerId] = useState(props.reviewers.length === 1 ? props.reviewers[0].id : "");
  const [fyFrom, setFyFrom] = useState(String(props.defaultFrom));
  const [fyTo, setFyTo] = useState(String(props.defaultTo));
  const company = props.companies.find((c) => c.id === companyId);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return props.companies.filter((c) => c.name.toLowerCase().includes(s) || c.nse.toLowerCase().includes(s) || (c.bse ?? "").includes(s)).slice(0, 8);
  }, [q, props.companies]);

  const typed = q.trim();
  const noMatch = !companyId && typed.length > 0 && matches.length === 0;
  const from = Number(fyFrom), to = Number(fyTo);
  const yearProblem =
    !fyFrom || !fyTo || !Number.isInteger(from) || !Number.isInteger(to) ? "Enter both years as four-digit numbers, for example 2022 and 2026."
    : from < 2000 ? "The first year must be 2000 or later."
    : to < from ? `The last year (${to}) is before the first year (${from}). Swap them or correct one of them.`
    : to - from > 15 ? `That is ${to - from + 1} years. Choose 16 years or fewer.`
    : null;
  const needs: Need[] = [
    {
      ok: !!companyId,
      text: "Choose the company you want to analyse",
      hint: noMatch
        ? <>No company matches “{typed}”. Check the spelling or try its NSE code (for example INFY). If the company is not listed, ask your team admin to add it.</>
        : typed
          ? "Click the company’s name in the list that appears under the box. Typing the name alone is not enough."
          : "Type part of the name or its NSE/BSE code in the Company box, then click it in the list.",
    },
    { ok: !yearProblem, text: "Enter a valid range of fiscal years", hint: yearProblem },
    {
      ok: peers.length > 0,
      text: "Tick at least one peer company to compare against",
      hint: companyId ? "Peers are similar companies. Tick one or more in the Peer set list." : "Once you choose the company, peers from the same sector are ticked for you automatically.",
    },
    { ok: !!reviewerId, text: "Choose a senior reviewer", hint: "This is the person who will check and approve your report. Pick a name in the Senior reviewer box." },
  ];
  const ready = needs.every((n) => n.ok);

  const pick = (c: Co) => {
    setCompanyId(c.id);
    setQ(`${c.name} (${c.nse})`);
    // SET-03: suggest peers from the same sector
    setPeers(props.companies.filter((x) => x.sector === c.sector && x.id !== c.id).map((x) => x.id));
  };
  const toggle = (id: string) => setPeers((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <form action={props.action} className="card space-y-5">
      <div className="relative">
        <label className="label">Company (search by name, NSE or BSE code)</label>
        <input className={`input ${noMatch ? "border-amber-300" : ""}`} value={q} onChange={(e) => { setQ(e.target.value); setCompanyId(""); }} placeholder="e.g. Infosys or INFY" aria-describedby="company-help" />
        <input type="hidden" name="companyId" value={companyId} />
        {!companyId && matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow">
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => pick(c)} className="w-full px-3 py-1.5 text-left hover:bg-gray-50">
                  {c.name} <span className="muted">{c.nse}{c.bse ? ` · BSE ${c.bse}` : ""} · {c.sector}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p id="company-help" className={`mt-1.5 text-[13px] ${noMatch ? "text-amber-800" : companyId ? "text-green-800" : "text-gray-500"}`}>
          {company
            ? <>✓ Selected: {company.name} ({company.nse}) · {company.sector}</>
            : noMatch
              ? <>No company matches “{typed}”. Check the spelling or try the NSE code. Not listed? Ask your team admin to add it.</>
              : typed
                ? "Now click the right company in the list below the box."
                : "Start typing, then click the company in the list."}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">First fiscal year</label>
          <input className="input" type="number" name="fyFrom" value={fyFrom} onChange={(e) => setFyFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Last fiscal year (base year)</label>
          <input className="input" type="number" name="fyTo" value={fyTo} onChange={(e) => setFyTo(e.target.value)} />
        </div>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" name="quarters" defaultChecked /> Latest 4 quarters ({props.quarters.join(", ")})
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label">Peer set <span className="muted font-normal">· {peers.length} ticked{company ? ` (suggested from ${company.sector})` : ""}</span></span>
          {props.templates.length > 0 && (
            <select className="input w-56" defaultValue="" onChange={(e) => { const t = props.templates.find((x) => x.id === e.target.value); if (t) setPeers(t.companyIds.filter((x) => x !== companyId)); }}>
              <option value="">Load saved template…</option>
              {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>
        <div className="grid max-h-64 grid-cols-2 gap-x-4 overflow-y-auto rounded-md border border-gray-200 p-2">
          {props.companies.filter((c) => c.id !== companyId).map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-0.5 text-sm">
              <input type="checkbox" name="peerIds" value={c.id} checked={peers.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.name} <span className="muted text-xs">{c.sector}</span>
            </label>
          ))}
        </div>
        <input className="input mt-2" name="templateName" placeholder="Save this peer set as a template (optional name)" />
      </div>

      <div>
        <label className="label">Question or purpose of the analysis</label>
        <textarea className="input" name="purpose" rows={2} placeholder="e.g. Quarterly ratio and valuation update after Q2 results" />
      </div>

      <div>
        <label className="label">Senior reviewer</label>
        <select className="input" name="reviewerId" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {props.reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <Checklist id="create-needs" title="Before you can create this analysis:" items={needs} />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={!ready} aria-describedby={ready ? undefined : "create-needs"}>Create analysis</button>
        {!ready && <span className="text-[13px] text-gray-500">The button turns on when everything in the list above is done.</span>}
      </div>
    </form>
  );
}
