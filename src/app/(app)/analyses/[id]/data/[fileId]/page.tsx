import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { loadAnalysis, lockReason } from "@/server/analysis";
import { readStoredWorkbook } from "@/server/ingest";
import { LINE_ITEMS, suggestLineItem } from "@/lib/coa";
import { Notice } from "@/components/ui";
import MappingForm from "./MappingForm";
import { applyMapping } from "../actions";

export default async function MapPage({ params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const user = await requireUser();
  const a = await loadAnalysis(id);
  const lock = lockReason(a, user, "DATA");
  const file = await prisma.uploadedFile.findFirstOrThrow({ where: { id: fileId, analysisId: id } });
  if (lock) return <Notice kind="warn">{lock}</Notice>;
  const sheets = (await readStoredWorkbook(file.storedPath)).map((s) => ({
    name: s.name,
    rows: s.rows.slice(0, 400).map((r) => (r ?? []).slice(0, 40).map((c) => (c === null || c === undefined ? null : c instanceof Date ? c.toISOString().slice(0, 10) : typeof c === "number" ? c : String(c)))),
  }));
  const saved = await prisma.columnMapping.findUnique({ where: { sourceLabel: file.sourceLabel } });
  const allLabels = new Set(sheets.flatMap((s) => s.rows.flatMap((r) => r.filter((c) => typeof c === "string") as string[])));
  const suggestions: Record<string, string> = {};
  for (const l of allLabels) {
    const s = suggestLineItem(l);
    if (s) suggestions[l.trim()] = s;
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="h2">Map columns: {file.fileName}</h2>
        <p className="muted text-sm">Source “{file.sourceLabel}”. {saved ? `Using the mapping saved for this source (version ${saved.version}); check it and import.` : "The mapping is saved for this source, so the next file from it is pre-mapped."}</p>
      </div>
      <MappingForm
        sheets={sheets}
        saved={saved ? JSON.parse(saved.config) : null}
        suggestions={suggestions}
        lineItems={LINE_ITEMS.map((l) => ({ key: l.key, label: l.label, statement: l.statement }))}
        companies={[{ id: a.companyId, name: a.company.name }, ...a.peers.map((p) => ({ id: p.id, name: p.name }))]}
        onApply={applyMapping.bind(null, id, fileId)}
        backHref={`/analyses/${id}/data`}
      />
    </div>
  );
}
