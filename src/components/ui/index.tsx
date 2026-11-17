// Shared app helpers (status badges, checklist, lock notice…). Lives at components/ui/index.tsx so
// "@/components/ui" imports keep working and shadcn-style components can sit beside it in this folder.
import Link from "next/link";

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
};

const STATUS_CLS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  IN_REVIEW: "bg-purple-50 text-purple-700",
  CHANGES_REQUESTED: "bg-red-100 text-red-800",
  APPROVED: "bg-green-100 text-green-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge uppercase ${STATUS_CLS[status] ?? "bg-gray-100"}`}>{STATUS_LABEL[status] ?? status}</span>;
}

const SEV: Record<string, string> = { HIGH: "bg-red-100 text-red-800", MEDIUM: "bg-amber-100 text-amber-800", LOW: "bg-gray-100 text-gray-700" };
export function SeverityBadge({ s }: { s: string }) {
  return <span className={`badge uppercase ${SEV[s]}`}>{s.toLowerCase()}</span>;
}

const ORIGIN: Record<string, [string, string]> = {
  AUTOMATED: ["auto", "bg-blue-50 text-blue-800"],
  OVERRIDDEN: ["overridden", "bg-purple-50 text-purple-700"],
  ANALYST: ["analyst", "bg-emerald-50 text-emerald-800"],
};
/** NFR-13: every value is visibly marked as automated, overridden or analyst-entered. */
export function OriginTag({ origin }: { origin: string }) {
  const [t, c] = ORIGIN[origin] ?? [origin, "bg-gray-100"];
  return <span className={`badge ${c} ml-1 align-middle text-[10px]`}>{t}</span>;
}

/** A number that links to its lineage (AUD-01, RAT-03). */
export function Num({ analysisId, refKey, children }: { analysisId: string; refKey?: string | null; children: React.ReactNode }) {
  if (!refKey) return <>{children}</>;
  return (
    <Link className="num-link" href={`/analyses/${analysisId}/lineage?ref=${encodeURIComponent(refKey)}`} title="Show source and formula">
      {children}
    </Link>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const cls = {
    info: "border-[#3b4799] bg-purple-50 text-[#c7d2fe]",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    ok: "border-green-200 bg-green-50 text-green-900",
  }[kind];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export function Avatar({ name, tone = "indigo", size = 24 }: { name: string; tone?: "indigo" | "cyan"; size?: number }) {
  return (
    <span title={name} className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-[#0b1020] ${tone === "cyan" ? "bg-[#22d3ee]" : "bg-[#818cf8]"}`} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  );
}

export function hoursLabel(seconds: number) {
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** One thing the user must do before an action unlocks. */
export type Need = { ok: boolean; text: React.ReactNode; hint?: React.ReactNode; href?: string; cta?: string };

/**
 * Shown next to a button that is disabled or blocked: lists what is done and what is still
 * missing, in plain words, with a link to the place to fix it. Renders nothing when all is done.
 */
export function Checklist({ title, items, id, className = "" }: { title: React.ReactNode; items: Need[]; id?: string; className?: string }) {
  const left = items.filter((i) => !i.ok).length;
  if (!left) return null;
  return (
    <div id={id} role="status" aria-live="polite" className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm ${className}`}>
      <p className="font-semibold text-amber-900">
        {title} <span className="font-normal text-amber-800">({left} {left === 1 ? "thing" : "things"} left)</span>
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((i, k) => (
          <li key={k} className="flex gap-2.5">
            {i.ok ? (
              <svg aria-label="Done" className="mt-0.5 h-4 w-4 shrink-0 text-green-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="7" /><path d="M5 8.2l2 2 4-4.2" /></svg>
            ) : (
              <svg aria-label="Still needed" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="7" /><path d="M8 4.5v4M8 11.2v.3" /></svg>
            )}
            <div>
              <span className={i.ok ? "text-gray-500 line-through decoration-gray-400" : "text-gray-900"}>{i.text}</span>
              {!i.ok && i.hint && <p className="mt-0.5 text-[13px] text-gray-500">{i.hint}</p>}
              {!i.ok && i.href && <Link href={i.href} className="mt-1 inline-block text-[13px] font-semibold text-blue-700 hover:underline">{i.cta ?? "Go there"} →</Link>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Explains why a screen is read-only and what the user can do about it. */
export function Locked({ why, children }: { why: string; children?: React.ReactNode }) {
  return (
    <div role="status" className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
      <svg aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>
      <div>
        <p className="font-semibold text-amber-900">You can look, but not change anything here right now</p>
        <p className="mt-0.5 text-gray-700">{why}</p>
        {children}
      </div>
    </div>
  );
}
