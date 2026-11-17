// Tech-stack page (components/ui bento grid). Not linked from the app's navigation.
// Every number on it is read from the database here, at request time.
import TechStackBento, { type DeskStats } from "@/components/ui/interactive-tech-stack-bento-grid-with-hover-effects";
import { STATUS_LABEL } from "@/components/ui";
import { prisma } from "@/server/db";
import pkg from "../../../../package.json";

export const metadata = { title: "Tech stack · AnalystDesk" };
export const dynamic = "force-dynamic";

const DAYS = 14;
const SEVERITIES = [
  { key: "HIGH", label: "High" },
  { key: "MEDIUM", label: "Medium" },
  { key: "LOW", label: "Low" },
];

const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
// "^6.19.3" -> "6.19.3"; returns undefined when the package isn't listed
const ver = (name: string) => deps[name]?.replace(/^[^\d]*/, "");

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

async function loadStats(): Promise<DeskStats> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (DAYS - 1));

  const [byStatus, flags, audit, figures, companies, people] = await Promise.all([
    prisma.analysis.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.flag.groupBy({ by: ["severity", "status"], _count: { _all: true } }),
    prisma.auditLog.findMany({ where: { at: { gte: since } }, select: { at: true } }),
    prisma.financialValue.count(),
    prisma.company.count(),
    prisma.user.count(),
  ]);

  const perDay = new Map<string, number>();
  for (const { at } of audit) perDay.set(dayKey(at), (perDay.get(dayKey(at)) ?? 0) + 1);
  const activity = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    return {
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      count: perDay.get(dayKey(d)) ?? 0,
    };
  });

  return {
    pipeline: Object.keys(STATUS_LABEL).map((status) => ({
      status,
      label: STATUS_LABEL[status],
      count: byStatus.find((s) => s.status === status)?._count._all ?? 0,
    })),
    activity,
    checks: SEVERITIES.map(({ key, label }) => {
      const rows = flags.filter((f) => f.severity === key);
      return {
        label,
        total: rows.reduce((a, r) => a + r._count._all, 0),
        open: rows.filter((r) => r.status === "OPEN").reduce((a, r) => a + r._count._all, 0),
      };
    }),
    figures,
    companies,
    people,
    versions: {
      next: ver("next"),
      react: ver("react"),
      ts: ver("typescript"),
      tailwind: ver("tailwindcss"),
      prisma: ver("@prisma/client"),
      decimal: ver("decimal.js"),
      exceljs: ver("exceljs"),
      puppeteer: ver("puppeteer-core"),
    } as Record<string, string>,
  };
}

export default async function TechStackPage() {
  return (
    <main className="min-h-screen bg-[#07080d]">
      <TechStackBento stats={await loadStats()} />
    </main>
  );
}
