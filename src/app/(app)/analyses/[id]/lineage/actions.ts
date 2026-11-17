"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { audit } from "@/server/audit";
import { afterDataChange, loadAnalysis, lockReason } from "@/server/analysis";
import { parseDecimal } from "@/lib/decimal";
import { LINE_ITEM_BY_KEY, MAPPING_VERSION } from "@/lib/coa";
import { toBase } from "@/lib/units";

/** Correct a stored value directly (used for data change requests); reason is mandatory. */
export async function correctValue(id: string, ref: string, formData: FormData) {
  const user = await requireUser(["ANALYST"]);
  const a = await loadAnalysis(id);
  const go = (q: Record<string, string>) => redirect(`/analyses/${id}/lineage?${new URLSearchParams({ ref, ...q })}`);
  const why = lockReason(a, user, "DATA");
  if (why) go({ err: why });
  const [, companyId, period, lineItem] = ref.split(":");
  const raw = parseDecimal(formData.get("value"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!raw) go({ err: "Type the new value as a number, for example 1250.5." });
  if (reason.length < 5) go({ err: "Write a short reason (at least 5 characters) so the reviewer knows why you changed this number." });
  const kind = LINE_ITEM_BY_KEY[lineItem]?.kind ?? "money";
  const value = kind === "money" ? toBase(raw!, "crore") : raw!;
  const prior = await prisma.financialValue.findMany({ where: { analysisId: id, companyId, period, lineItem, active: true } });
  const created = await prisma.financialValue.create({
    data: { analysisId: id, companyId, period, lineItem, value: value.toString(), rawValue: raw!.toString(), rawUnit: kind === "money" ? "crore" : "units", rawLabel: "Analyst correction", mappingVersion: MAPPING_VERSION, origin: prior.length ? "OVERRIDDEN" : "ANALYST", reason, supersedesId: prior[prior.length - 1]?.id ?? null, createdBy: user.id },
  });
  await prisma.financialValue.updateMany({ where: { id: { in: prior.map((p) => p.id) } }, data: { active: false } });
  await audit(user, "VALUE_CORRECTED", "FinancialValue", created.id, { companyId, period, lineItem, before: prior.map((p) => p.value), after: value.toString(), reason }, id);
  await afterDataChange(a, user, "value corrected");
  go({ msg: "Corrected. Checks, model and report re-ran." });
}
