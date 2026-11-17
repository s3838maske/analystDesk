import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { Avatar, StatusBadge, fmtDate } from "@/components/ui";

export default async function QueuePage() {
  const user = await requireUser(["ANALYST", "REVIEWER"]);
  const reviewer = user.role === "REVIEWER";
  const items = await prisma.analysis.findMany({
    where: reviewer ? { reviewerId: user.id, status: "IN_REVIEW" } : { ownerId: user.id, status: "CHANGES_REQUESTED" },
    include: { company: true, owner: true, changeRequests: { where: { status: "OPEN" } }, versions: { orderBy: { number: "desc" }, take: 1 } },
    orderBy: { updatedAt: "asc" },
  });
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="h1">{reviewer ? "Review queue" : "Change requests"}</h1>
        <p className="mt-1 text-[15px] text-gray-600">{reviewer ? "Reports submitted to you, oldest first." : "Analyses your reviewer sent back, oldest first."}</p>
      </div>
      <div className="flex flex-col gap-3">
        {items.map((a) => (
          <Link key={a.id} href={`/analyses/${a.id}/review`} className="card flex flex-wrap items-center gap-4 hover:bg-gray-50">
            <Avatar name={a.owner.name} size={36} />
            <div className="min-w-0 flex-[1_1_240px]">
              <p className="font-semibold">{a.company.name} <span className="muted font-normal">· FY{a.fyFrom}–FY{a.fyTo}</span></p>
              <p className="mt-0.5 truncate text-[13px] text-gray-500">
                {reviewer ? `Version ${a.versions[0]?.number ?? 1} from ${a.owner.name} · ${a.versions[0] ? fmtDate(a.versions[0].submittedAt) : ""}` : a.changeRequests.map((c) => `“${c.comment}”`).join(" · ")}
              </p>
            </div>
            <StatusBadge status={a.status} />
            <span className="btn-secondary">{reviewer ? "Open review" : "Fix"}</span>
          </Link>
        ))}
        {!items.length && <div className="card muted text-center">Nothing waiting.</div>}
      </div>
    </div>
  );
}
