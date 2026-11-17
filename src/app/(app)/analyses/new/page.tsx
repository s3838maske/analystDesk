import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { audit } from "@/server/audit";
import { lastCompletedFY, latestQuarters } from "@/lib/periods";
import { Notice } from "@/components/ui";
import SetupForm from "./SetupForm";

async function create(formData: FormData) {
  "use server";
  const user = await requireUser(["ANALYST"]);
  const companyId = String(formData.get("companyId") ?? "");
  const reviewerId = String(formData.get("reviewerId") ?? "");
  const fyFrom = Number(formData.get("fyFrom"));
  const fyTo = Number(formData.get("fyTo"));
  const peerIds = formData.getAll("peerIds").map(String).filter((p) => p && p !== companyId);
  const purpose = String(formData.get("purpose") ?? "").trim() || null;
  const saveTemplate = String(formData.get("templateName") ?? "").trim();
  const err = (m: string) => redirect(`/analyses/new?err=${encodeURIComponent(m)}`);
  if (!companyId) err("Choose a company: type its name in the Company box, then click it in the list.");
  if (!reviewerId) err("Choose a senior reviewer: the person who will check and approve your report.");
  if (!(fyFrom >= 2000 && fyTo >= fyFrom && fyTo - fyFrom <= 15)) err("Check the years: the first year must be 2000 or later, the last year cannot be before the first, and the range can be at most 16 years.");
  if (!peerIds.length) err("Tick at least one peer company to compare against.");
  const quarters = formData.get("quarters") === "on" ? latestQuarters(4) : [];
  if (saveTemplate) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const t = await prisma.peerSetTemplate.create({ data: { name: saveTemplate, sector: company?.sector, companyIds: JSON.stringify(peerIds) } });
    await audit(user, "PEER_TEMPLATE_SAVED", "PeerSetTemplate", t.id, { name: saveTemplate, peerIds });
  }
  const a = await prisma.analysis.create({
    data: { companyId, reviewerId, fyFrom, fyTo, quarters: JSON.stringify(quarters), peerIds: JSON.stringify(peerIds), purpose, ownerId: user.id },
  });
  await audit(user, "ANALYSIS_CREATED", "Analysis", a.id, { companyId, peerIds, fyFrom, fyTo, quarters, reviewerId, purpose }, a.id);
  redirect(`/analyses/${a.id}/data`);
}

export default async function NewAnalysis({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireUser(["ANALYST"]);
  const { err } = await searchParams;
  const [companies, reviewers, templates] = await Promise.all([
    prisma.company.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "REVIEWER", active: true }, orderBy: { name: "asc" } }),
    prisma.peerSetTemplate.findMany({ orderBy: { name: "asc" } }),
  ]);
  const fy = lastCompletedFY();
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="h1">New analysis</h1>
      {err && <Notice kind="error">{err}</Notice>}
      <SetupForm
        action={create}
        companies={companies.map((c) => ({ id: c.id, name: c.name, nse: c.nse, bse: c.bse, sector: c.sector }))}
        reviewers={reviewers.map((r) => ({ id: r.id, name: r.name }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, companyIds: JSON.parse(t.companyIds) as string[] }))}
        defaultFrom={fy - 4}
        defaultTo={fy}
        quarters={latestQuarters(4)}
      />
    </div>
  );
}
