// Analysis service: loading, permissions/locks, re-validation and model re-runs.
import "server-only";
import { prisma } from "./db";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import { Dataset } from "@/lib/dataset";
import { validateAnalysis, DEFAULT_THRESHOLDS } from "@/lib/validation";
import { ASSUMPTIONS, buildModelInputs, defaultAssumptions, MissingInputError, ModelInputs, ModelOutputs, runModel } from "@/lib/model";

export type Area = "SETUP" | "DATA" | "ASSUMPTIONS" | "WORDING";

export async function loadAnalysis(id: string) {
  const a = await prisma.analysis.findUnique({
    where: { id },
    include: { company: true, owner: true, reviewer: true },
  });
  if (!a) throw new Error("Analysis not found");
  const peerIds: string[] = JSON.parse(a.peerIds);
  const quarters: string[] = JSON.parse(a.quarters);
  const reopened: string[] = JSON.parse(a.reopened);
  const peers = await prisma.company.findMany({ where: { id: { in: peerIds } } });
  const peersOrdered = peerIds.map((pid) => peers.find((p) => p.id === pid)!).filter(Boolean);
  const names: Record<string, string> = { [a.companyId]: a.company.name };
  for (const p of peersOrdered) names[p.id] = p.name;
  return { ...a, peerIdsArr: peerIds, quartersArr: quarters, reopenedArr: reopened, peers: peersOrdered, names };
}

export type LoadedAnalysis = Awaited<ReturnType<typeof loadAnalysis>>;

export function canView(a: LoadedAnalysis, u: SessionUser): boolean {
  if (u.role === "ADMIN") return true;
  if (u.role === "COMPLIANCE") return a.status === "APPROVED";
  return a.ownerId === u.id || a.reviewerId === u.id || u.role === "REVIEWER";
}

/** Locks (REV-01, REV-04/05, REV-08): what the owner may edit in the current status. */
export function canEdit(a: LoadedAnalysis, u: SessionUser, area: Area): boolean {
  if (a.ownerId !== u.id) return false;
  if (a.status === "DRAFT") return true;
  if (a.status === "CHANGES_REQUESTED") {
    if (area === "SETUP") return false;
    if (area === "DATA") return a.reopenedArr.includes("DATA");
    if (area === "ASSUMPTIONS") return a.reopenedArr.includes("ASSUMPTIONS") || a.reopenedArr.includes("DATA");
    if (area === "WORDING") return true; // text is always fixable in a CR round
  }
  return false;
}

const AREA_WORDS: Record<Area, string> = {
  SETUP: "the company, years and peers",
  DATA: "the uploaded data and flags",
  ASSUMPTIONS: "the model assumptions",
  WORDING: "the report text",
};

/** Plain-language reason an area is read-only, and what the user can do about it. */
export function lockReason(a: LoadedAnalysis, u: SessionUser, area: Area): string | null {
  if (canEdit(a, u, area)) return null;
  const what = AREA_WORDS[area];
  if (a.ownerId !== u.id) return `Only ${a.owner.name} can change ${what}, because they created this analysis. You can still view everything.`;
  if (a.status === "IN_REVIEW") return `This analysis was sent to ${a.reviewer.name} for review, so it is locked while they check it. If they ask for changes, the parts they mention will open again for editing.`;
  if (a.status === "APPROVED") return `${a.reviewer.name} approved this report, so it is locked to keep a permanent record. To update it, start a new analysis.`;
  if (a.status === "CHANGES_REQUESTED") {
    if (area === "SETUP") return "The company, years and peers cannot change once an analysis has been submitted. If you need a different setup, start a new analysis.";
    return `The reviewer's change requests do not mention ${what}, so it stays locked. Open the Review step to see what they asked you to fix.`;
  }
  return `You cannot change ${what} right now.`;
}

export async function assertEdit(a: LoadedAnalysis, u: SessionUser, area: Area) {
  const why = lockReason(a, u, area);
  if (why) throw new Error(why);
}

export async function loadDataset(analysisId: string): Promise<Dataset> {
  const rows = await prisma.financialValue.findMany({
    where: { analysisId, active: true },
    select: { id: true, companyId: true, period: true, lineItem: true, value: true, origin: true, fileId: true, createdAt: true },
  });
  return new Dataset(rows);
}

/** Re-run validation: open flags are replaced; accepted/overridden flags are never re-raised (same signature). */
export async function revalidate(a: LoadedAnalysis, user: SessionUser) {
  const ds = await loadDataset(a.id);
  const drafts = validateAnalysis({
    ds,
    subjectId: a.companyId,
    peerIds: a.peerIdsArr,
    fyFrom: a.fyFrom,
    fyTo: a.fyTo,
    quarters: a.quartersArr,
    names: a.names,
    thresholds: DEFAULT_THRESHOLDS,
  });
  const existing = await prisma.flag.findMany({ where: { analysisId: a.id } });
  const resolvedSigs = new Set(existing.filter((f) => f.status === "ACCEPTED" || f.status === "OVERRIDDEN").map((f) => f.signature));
  const openBySig = new Map(existing.filter((f) => f.status === "OPEN").map((f) => [f.signature, f]));
  const keep = new Set<string>();
  let created = 0;
  for (const d of drafts) {
    if (resolvedSigs.has(d.signature)) continue;
    const prior = openBySig.get(d.signature);
    if (prior) {
      keep.add(prior.id);
      await prisma.flag.update({ where: { id: prior.id }, data: { message: d.message, affected: JSON.stringify(d.affected), severity: d.severity } });
      continue;
    }
    await prisma.flag.create({
      data: { analysisId: a.id, signature: d.signature, companyId: d.companyId, period: d.period, type: d.type, severity: d.severity, message: d.message, affected: JSON.stringify(d.affected) },
    });
    created++;
  }
  // open flags that no longer reproduce are cleared (the underlying data was fixed)
  const cleared = [...openBySig.values()].filter((f) => !keep.has(f.id));
  for (const f of cleared) {
    await prisma.flag.update({ where: { id: f.id }, data: { status: "CORRECTED", resolution: "Cleared automatically: the check passes after a data change", resolvedBy: "system", resolvedAt: new Date() } });
  }
  await audit(user, "VALIDATION_RUN", "Analysis", a.id, { newFlags: created, cleared: cleared.length, total: drafts.length }, a.id);
  return { created, cleared: cleared.length };
}

export async function openHighFlags(analysisId: string) {
  return prisma.flag.count({ where: { analysisId, status: "OPEN", severity: "HIGH" } });
}

/** MOD-01: create default assumptions the first time (marked AUTOMATED, unconfirmed). */
export async function ensureAssumptions(a: LoadedAnalysis) {
  const have = await prisma.assumption.findMany({ where: { analysisId: a.id } });
  if (have.length) return have;
  const ds = await loadDataset(a.id);
  const defs = defaultAssumptions(ds, a.companyId, a.fyTo);
  await prisma.assumption.createMany({
    data: defs.map((d) => ({ analysisId: a.id, key: d.key, value: d.value, defaultValue: d.value, basis: d.basis, origin: "AUTOMATED", confirmed: !ASSUMPTIONS.find((x) => x.key === d.key)!.key_ })),
  });
  return prisma.assumption.findMany({ where: { analysisId: a.id } });
}

export type ModelState =
  | { ok: true; run: { id: string; createdAt: Date; inputs: ModelInputs; outputs: ModelOutputs } }
  | { ok: false; reason: string };

export async function modelBlockers(a: LoadedAnalysis): Promise<string | null> {
  const high = await openHighFlags(a.id);
  if (high) return `${high} serious data problem${high > 1 ? "s are" : " is"} still open. Fix or accept ${high > 1 ? "them" : "it"} on the Flags step first.`;
  const asm = await prisma.assumption.findMany({ where: { analysisId: a.id } });
  if (!asm.length) return "The model assumptions have not been filled in yet. Open the Model step to set them.";
  const unconfirmed = asm.filter((x) => ASSUMPTIONS.find((d) => d.key === x.key)?.key_ && !x.confirmed);
  if (unconfirmed.length) return `Tick the “Confirmed” box next to ${unconfirmed.length > 1 ? "these key assumptions" : "this key assumption"} on the Model step, then press “Save and run model”: ${unconfirmed.map((u) => ASSUMPTIONS.find((d) => d.key === u.key)!.label).join(", ")}.`;
  return null;
}

/** Re-run the model from current data and assumptions (REV-04). Returns null when blocked. */
export async function rerunModel(a: LoadedAnalysis, user: SessionUser, reason: string): Promise<{ id: string } | { error: string }> {
  const blocker = await modelBlockers(a);
  if (blocker) return { error: blocker };
  const ds = await loadDataset(a.id);
  const asm = await prisma.assumption.findMany({ where: { analysisId: a.id } });
  let inputs: ModelInputs;
  try {
    inputs = buildModelInputs({ ds, companyId: a.companyId, peerIds: a.peerIdsArr, names: a.names, fyTo: a.fyTo, assumptions: Object.fromEntries(asm.map((x) => [x.key, x.value])) });
  } catch (e) {
    if (e instanceof MissingInputError) return { error: e.message };
    throw e;
  }
  let outputs: ModelOutputs;
  try {
    outputs = runModel(inputs);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const run = await prisma.modelRun.create({
    data: { analysisId: a.id, formulaVersion: inputs.formulaVersion, inputs: JSON.stringify(inputs), outputs: JSON.stringify(outputs), createdBy: user.id },
  });
  await audit(user, "MODEL_RUN", "ModelRun", run.id, { reason, perShare: outputs.dcf.per_share, formulaVersion: inputs.formulaVersion }, a.id);
  return { id: run.id };
}

export async function latestRun(analysisId: string) {
  const r = await prisma.modelRun.findFirst({ where: { analysisId }, orderBy: { createdAt: "desc" } });
  if (!r) return null;
  return { id: r.id, createdAt: r.createdAt, formulaVersion: r.formulaVersion, inputs: JSON.parse(r.inputs) as ModelInputs, outputs: JSON.parse(r.outputs) as ModelOutputs };
}

/** After any data change: re-validate, then re-run the model if it can run (REV-04 automatic re-run). */
export async function afterDataChange(a: LoadedAnalysis, user: SessionUser, reason: string) {
  await revalidate(a, user);
  const hasRun = await prisma.modelRun.count({ where: { analysisId: a.id } });
  if (hasRun) await rerunModel(a, user, reason);
}
