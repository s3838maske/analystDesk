"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { audit } from "@/server/audit";
import { loadAnalysis, lockReason, rerunModel } from "@/server/analysis";
import { ASSUMPTIONS } from "@/lib/model";
import { parseDecimal } from "@/lib/decimal";

const back = (id: string, q: Record<string, string>) => redirect(`/analyses/${id}/model?${new URLSearchParams(q)}`);

/** MOD-02: analyst confirms or changes each assumption; the model then re-runs. Values are entered in %. */
export async function saveAssumptions(id: string, formData: FormData) {
  const user = await requireUser(["ANALYST"]);
  const a = await loadAnalysis(id);
  const why = lockReason(a, user, "ASSUMPTIONS");
  if (why) back(id, { err: why });
  const existing = await prisma.assumption.findMany({ where: { analysisId: id } });
  for (const def of ASSUMPTIONS) {
    const row = existing.find((e) => e.key === def.key);
    if (!row) continue;
    const raw = String(formData.get(def.key) ?? "").trim();
    const pct = parseDecimal(raw.replace(/%$/, ""));
    if (pct === null) back(id, { err: `${def.label}: type a number, for example 12.5 for 12.5%.` });
    const value = pct!.div(100).toString();
    const confirm = formData.get(`confirm_${def.key}`) === "on";
    const changed = value !== row.value;
    if (!changed && confirm === row.confirmed) continue;
    await prisma.assumption.update({
      where: { id: row.id },
      data: { value, confirmed: confirm || changed, origin: changed ? (value === row.defaultValue ? "AUTOMATED" : "ANALYST") : row.origin, updatedBy: user.id },
    });
    await audit(user, changed ? "ASSUMPTION_CHANGED" : "ASSUMPTION_CONFIRMED", "Assumption", row.id, { key: def.key, before: row.value, value, reason: String(formData.get("reason") ?? "") || undefined }, id);
  }
  const r = await rerunModel(await loadAnalysis(id), user, "assumptions saved");
  if ("error" in r) back(id, { err: r.error });
  back(id, { msg: "Assumptions saved and the model re-ran." });
}

export async function resetAssumption(id: string, key: string) {
  const user = await requireUser(["ANALYST"]);
  const a = await loadAnalysis(id);
  const why = lockReason(a, user, "ASSUMPTIONS");
  if (why) back(id, { err: why });
  const row = await prisma.assumption.findUniqueOrThrow({ where: { analysisId_key: { analysisId: id, key } } });
  await prisma.assumption.update({ where: { id: row.id }, data: { value: row.defaultValue, origin: "AUTOMATED", confirmed: false, updatedBy: user.id } });
  await audit(user, "ASSUMPTION_RESET", "Assumption", row.id, { key, before: row.value, value: row.defaultValue }, id);
  back(id, { msg: "Reset to default. Confirm it before the model runs." });
}
