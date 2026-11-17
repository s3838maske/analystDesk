"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { audit } from "@/server/audit";
import { afterDataChange, loadAnalysis, lockReason, revalidate } from "@/server/analysis";
import { parseDecimal } from "@/lib/decimal";
import { LINE_ITEM_BY_KEY, MAPPING_VERSION } from "@/lib/coa";
import { toBase } from "@/lib/units";
import type { AffectedValue } from "@/lib/validation";

const back = (id: string, q: Record<string, string>) => redirect(`/analyses/${id}/validation?${new URLSearchParams(q)}`);

export async function rerunValidation(id: string) {
  const user = await requireUser(["ANALYST"]);
  const a = await loadAnalysis(id);
  const why = lockReason(a, user, "DATA");
  if (why) back(id, { err: why });
  const r = await revalidate(a, user);
  back(id, { msg: `Checks re-run: ${r.created} new flag(s), ${r.cleared} cleared.` });
}

/** VAL-06: accept, correct (mandatory reason) or override (mandatory reason) a flag. */
export async function resolveFlag(id: string, flagId: string, formData: FormData) {
  const user = await requireUser(["ANALYST"]);
  const a = await loadAnalysis(id);
  const why = lockReason(a, user, "DATA");
  if (why) back(id, { err: why });
  const flag = await prisma.flag.findFirstOrThrow({ where: { id: flagId, analysisId: id } });
  const action = String(formData.get("action"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (flag.status !== "OPEN") back(id, { err: "Someone already dealt with this flag, so there is nothing left to do here. The page now shows its current state." });
  if ((action === "CORRECT" || action === "OVERRIDE") && reason.length < 5) back(id, { err: "Write a short reason (at least 5 characters) before you correct or override a flag. The reviewer will see it.", open: flagId });

  if (action === "ACCEPT" || action === "OVERRIDE") {
    await prisma.flag.update({ where: { id: flagId }, data: { status: action === "ACCEPT" ? "ACCEPTED" : "OVERRIDDEN", resolution: reason || "Accepted as reported", resolvedBy: user.id, resolvedAt: new Date() } });
    await audit(user, action === "ACCEPT" ? "FLAG_ACCEPTED" : "FLAG_OVERRIDDEN", "Flag", flagId, { type: flag.type, signature: flag.signature, reason }, id);
    await afterDataChange(a, user, `flag ${action.toLowerCase()}`);
    back(id, { msg: action === "ACCEPT" ? "Flag accepted." : "Flag overridden." });
  }

  if (action === "CORRECT") {
    const affected: AffectedValue[] = JSON.parse(flag.affected);
    let changed = 0;
    for (const af of affected) {
      const raw = String(formData.get(`v:${af.companyId}|${af.period}|${af.lineItem}`) ?? "").trim();
      if (!raw) continue;
      const d = parseDecimal(raw);
      if (!d) back(id, { err: `“${raw}” is not a number we can read. Use digits only, for example 1250.5 or -320 (no commas or letters).`, open: flagId });
      const kind = LINE_ITEM_BY_KEY[af.lineItem]?.kind ?? "money";
      const base = kind === "money" ? toBase(d!, "crore") : d!;
      if (af.value !== null && base.eq(af.value)) continue;
      const created = await prisma.financialValue.create({
        data: {
          analysisId: id, companyId: af.companyId, period: af.period, lineItem: af.lineItem, value: base.toString(),
          rawValue: d!.toString(), rawUnit: kind === "money" ? "crore" : "units", rawLabel: "Analyst correction",
          mappingVersion: MAPPING_VERSION, origin: af.valueId ? "OVERRIDDEN" : "ANALYST", reason, supersedesId: af.valueId, createdBy: user.id,
        },
      });
      // the raw upload row is kept (never deleted); it just stops being used
      if (af.valueId) await prisma.financialValue.update({ where: { id: af.valueId }, data: { active: false } });
      await audit(user, "VALUE_CORRECTED", "FinancialValue", created.id, { flagId, companyId: af.companyId, period: af.period, lineItem: af.lineItem, before: af.value, after: base.toString(), reason }, id);
      changed++;
    }
    if (!changed) back(id, { err: "Type the corrected number in at least one box before pressing Save correction.", open: flagId });
    await prisma.flag.update({ where: { id: flagId }, data: { status: "CORRECTED", resolution: reason, resolvedBy: user.id, resolvedAt: new Date() } });
    await audit(user, "FLAG_CORRECTED", "Flag", flagId, { type: flag.type, changed, reason }, id);
    await afterDataChange(a, user, "data correction");
    back(id, { msg: `Corrected ${changed} value(s). Checks, model and report re-ran.` });
  }
  back(id, { err: "Something went wrong with that button. Please reload the page and try again." });
}
