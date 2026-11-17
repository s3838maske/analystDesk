"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { audit } from "@/server/audit";
import { latestRun, loadAnalysis, modelBlockers, openHighFlags } from "@/server/analysis";
import { ensureReport, snapshotVersion } from "@/server/report";
import type { Section } from "@/lib/report";

const back = (id: string, q: Record<string, string>) => redirect(`/analyses/${id}/review?${new URLSearchParams(q)}`);

/** REV-01: submit (or resubmit) for review; the analysis locks. */
export async function submitForReview(id: string) {
  const user = await requireUser(["ANALYST"]);
  const a = await loadAnalysis(id);
  if (a.ownerId !== user.id) back(id, { err: "Only the analyst who owns this analysis can submit it." });
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(a.status)) back(id, { err: "This analysis has already been sent for review, so there is nothing to submit." });
  if (await openHighFlags(id)) back(id, { err: "Some serious data problems are still open. Fix or accept them on the Flags step, then submit again." });
  const blocker = await modelBlockers(a);
  if (blocker) back(id, { err: blocker });
  if (!(await latestRun(id))) back(id, { err: "The model has not been run yet. On the Model step, press “Save and run model”, then submit again." });
  const r = await ensureReport(id);
  const empty = (JSON.parse(r.sections) as Section[]).filter((s) => s.analystOnly && !s.body.trim());
  if (empty.length) back(id, { err: `Before submitting, write the ${empty.map((s) => s.title.toLowerCase()).join(", ")} section${empty.length > 1 ? "s" : ""} on the Report step. The app cannot write ${empty.length > 1 ? "these" : "this"} for you.` });
  const v = await snapshotVersion(a, user.id);
  const addressed = await prisma.changeRequest.updateMany({ where: { analysisId: id, status: "OPEN" }, data: { status: "ADDRESSED", addressedAt: new Date() } });
  await prisma.analysis.update({ where: { id }, data: { status: "IN_REVIEW", reopened: "[]" } });
  await audit(user, v.number === 1 ? "SUBMITTED" : "RESUBMITTED", "ReportVersion", v.id, { version: v.number, addressedCRs: addressed.count }, id);
  back(id, { msg: `Version ${v.number} submitted to ${a.reviewer.name}. The analysis is locked until review.` });
}

async function reviewerCtx(id: string) {
  const user = await requireUser(["REVIEWER"]);
  const a = await loadAnalysis(id);
  if (a.reviewerId !== user.id) back(id, { err: "Only the senior reviewer chosen for this analysis can approve it or ask for changes." });
  if (a.status !== "IN_REVIEW") back(id, { err: "This analysis is not waiting for review right now, so there is nothing to approve or send back." });
  return { user, a };
}

/** REV-08 / CMP-02: approval records the approver's name and time; the report becomes read-only. */
export async function approve(id: string, formData: FormData) {
  const { user } = await reviewerCtx(id);
  if (formData.get("confirm") !== "on") back(id, { err: "To approve, first tick the box that says you have reviewed this version." });
  const at = new Date();
  await prisma.analysis.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: at } });
  const v = await prisma.reportVersion.findFirst({ where: { analysisId: id }, orderBy: { number: "desc" } });
  await audit(user, "APPROVED", "ReportVersion", v?.id ?? null, { version: v?.number, approver: user.name, at: at.toISOString() }, id);
  back(id, { msg: `Approved by ${user.name}. The report is now read-only.` });
}

const AREA: Record<string, string> = { DATA: "DATA", ASSUMPTION: "ASSUMPTIONS", WORDING: "WORDING" };

/** REV-02..05: raise one or more typed change requests, each anchored to a number, chart or paragraph. */
export async function requestChanges(id: string, formData: FormData) {
  const { user } = await reviewerCtx(id);
  const v = await prisma.reportVersion.findFirst({ where: { analysisId: id }, orderBy: { number: "desc" } });
  const crs: { type: string; anchor: string; comment: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const comment = String(formData.get(`comment_${i}`) ?? "").trim();
    if (!comment) continue;
    const type = String(formData.get(`type_${i}`));
    const anchor = String(formData.get(`anchor_${i}`) ?? "");
    if (!AREA[type]) back(id, { err: "Each change request needs a type: Data, Assumption or Wording." });
    if (!anchor) back(id, { err: "Each change request must point to what it is about. Use the “Anchor to…” box to pick the number, table, chart or section." });
    crs.push({ type, anchor, comment });
  }
  if (!crs.length) back(id, { err: "Write at least one change request: say what should change in the comment box." });
  for (const c of crs) {
    const cr = await prisma.changeRequest.create({ data: { analysisId: id, versionNo: v?.number ?? 1, ...c, createdBy: user.id } });
    await audit(user, "CHANGE_REQUESTED", "ChangeRequest", cr.id, c, id);
  }
  const reopened = [...new Set(crs.map((c) => AREA[c.type]))];
  await prisma.analysis.update({ where: { id }, data: { status: "CHANGES_REQUESTED", reopened: JSON.stringify(reopened) } });
  back(id, { msg: `${crs.length} change request(s) sent. Reopened: ${reopened.join(", ").toLowerCase()}.` });
}
