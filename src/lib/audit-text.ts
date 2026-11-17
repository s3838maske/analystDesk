// Turns an audit-log row into one plain sentence for people who are not technical.
// The raw detail stays available next to it (and in the CSV export) for checks.

type D = Record<string, unknown>;

const crore = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return `₹${(n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} cr`;
};
const pct = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%` : String(v ?? "");
};
const words = (key: unknown) => String(key ?? "").replace(/_/g, " ");
const quote = (v: unknown) => (v ? ` Reason: “${String(v)}”.` : "");

export function auditSentence(action: string, detailJson: string, names: Record<string, string> = {}): string {
  let d: D = {};
  try {
    d = JSON.parse(detailJson) as D;
  } catch {
    /* keep empty */
  }
  const co = (id: unknown) => names[String(id)] ?? "a company";
  const label = (k: unknown) => names[String(k)] ?? words(k);
  switch (action) {
    case "LOGIN": return "Signed in.";
    case "LOGOUT": return "Signed out.";
    case "ANALYSIS_CREATED": return `Started the analysis for FY${d.fyFrom}–FY${d.fyTo} with ${(d.peerIds as unknown[] | undefined)?.length ?? 0} peer companies.${d.purpose ? ` Purpose: “${d.purpose}”.` : ""}`;
    case "FILE_UPLOADED": return `Uploaded “${d.fileName}” (source: ${d.sourceLabel}). The original file is kept unchanged.`;
    case "FILE_DOWNLOADED": return `Downloaded the original file “${d.fileName}”.`;
    case "MAPPING_SAVED": return `Matched the rows of “${d.sourceLabel}” to standard line items (${d.labels} rows).`;
    case "VALUES_IMPORTED": return `Read ${d.count} numbers from the file into the analysis.${Number(d.replaced) ? ` ${d.replaced} older numbers from the same source were replaced.` : ""}`;
    case "VALUE_ENTERED": return `Typed in a price or share count for ${co(d.companyId)}.`;
    case "VALUE_CORRECTED": {
      const before = Array.isArray(d.before) ? d.before[0] : d.before;
      return `Corrected ${label(d.lineItem)} for ${co(d.companyId)}, ${String(d.period ?? "").replace(/^D/, "")}: ${crore(before)} → ${crore(d.after)}.${quote(d.reason)}`;
    }
    case "VALIDATION_RUN": return `Checked the data: ${d.newFlags ?? 0} new problem${d.newFlags === 1 ? "" : "s"} found, ${d.cleared ?? 0} cleared.`;
    case "FLAG_CORRECTED": return `Fixed a flagged problem (${words(d.type)}) by correcting the numbers.${quote(d.reason)}`;
    case "FLAG_ACCEPTED": return `Accepted a flagged number as reported (${words(d.type)}).${quote(d.reason)}`;
    case "FLAG_OVERRIDDEN": return `Overrode a flagged problem (${words(d.type)}).${quote(d.reason)}`;
    case "ASSUMPTION_CHANGED": return `Changed the ${label(d.key)} assumption from ${pct(d.before)} to ${pct(d.value)}.${quote(d.reason)}`;
    case "ASSUMPTION_CONFIRMED": return `Confirmed the ${label(d.key)} assumption at ${pct(d.value)}.`;
    case "ASSUMPTION_RESET": return `Reset the ${label(d.key)} assumption to its default of ${pct(d.value)}.`;
    case "MODEL_RUN": return `Ran the valuation model. Value per share: ₹${Number(d.perShare).toLocaleString("en-IN", { maximumFractionDigits: 2 })}.`;
    case "REPORT_EDITED": return `Edited the “${words(d.section)}” section of the report.`;
    case "SUBMITTED": return `Sent version ${d.version} of the report to the reviewer.`;
    case "RESUBMITTED": return `Sent version ${d.version} back to the reviewer after making the requested changes.`;
    case "CHANGE_REQUESTED": return `Asked for a change (${words(d.type).toLowerCase()}): “${d.comment}”.`;
    case "APPROVED": return `Approved version ${d.version}. The report is now locked.`;
    case "EXPORTED": return `Downloaded the ${String(d.format).toUpperCase()} file.`;
    case "AUDIT_EXPORTED": return `Downloaded this audit trail (${d.rows} rows).`;
    case "PEER_TEMPLATE_SAVED": return `Saved the peer list as a template called “${d.name}”.`;
    case "USER_CREATED": return `Added ${d.name} (${d.email}) as ${words(d.role).toLowerCase()}.`;
    case "USER_UPDATED": return "Changed a user’s role or access.";
    default: return words(action).toLowerCase().replace(/^./, (c) => c.toUpperCase()) + ".";
  }
}
