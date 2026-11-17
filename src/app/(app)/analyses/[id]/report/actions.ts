"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { audit } from "@/server/audit";
import { loadAnalysis, lockReason } from "@/server/analysis";
import { ensureReport } from "@/server/report";
import type { Section } from "@/lib/report";
import { lineDiff } from "@/lib/report";

/** REP-03: save one section's text. */
export async function saveSection(id: string, key: string, body: string, title?: string) {
  const user = await requireUser(["ANALYST"]);
  const a = await loadAnalysis(id);
  const why = lockReason(a, user, "WORDING");
  if (why) return { error: why };
  const r = await ensureReport(id);
  const sections: Section[] = JSON.parse(r.sections);
  const s = sections.find((x) => x.key === key);
  if (!s) return { error: "Unknown section" };
  if (s.body === body && (!title || s.title === title)) return { ok: true };
  const diff = lineDiff(s.body.split("\n"), body.split("\n")).filter((d) => d.op !== "same");
  s.body = body;
  if (title) s.title = title;
  await prisma.report.update({ where: { id: r.id }, data: { sections: JSON.stringify(sections) } });
  await audit(user, "REPORT_EDITED", "Report", r.id, { section: key, changes: diff.slice(0, 20) }, id);
  revalidatePath(`/analyses/${id}/report`);
  return { ok: true };
}
