import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getUser, logout, ROLE_LABEL } from "@/server/auth";
import { audit } from "@/server/audit";
import SideNav from "@/components/SideNav";
import { IconLogout, Logo } from "@/components/icons";
import { initials } from "@/components/ui";

async function doLogout() {
  "use server";
  const u = await getUser();
  if (u) await audit(u, "LOGOUT", "User", u.id, {});
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [mine, queue, timeAgg, approvedThisMonth] = await Promise.all([
    prisma.analysis.count({ where: user.role === "ADMIN" ? { status: { not: "APPROVED" } } : { ownerId: user.id, status: { not: "APPROVED" } } }),
    prisma.analysis.count({ where: user.role === "REVIEWER" ? { reviewerId: user.id, status: "IN_REVIEW" } : { ownerId: user.id, status: "CHANGES_REQUESTED" } }),
    prisma.timeEntry.aggregate({ _sum: { seconds: true }, where: { day: { gte: monthStart.toISOString().slice(0, 10) } } }),
    prisma.analysis.count({ where: { status: "APPROVED", approvedAt: { gte: monthStart } } }),
  ]);
  const hours = (timeAgg._sum.seconds ?? 0) / 3600;
  const items = [
    { href: "/", label: user.role === "COMPLIANCE" ? "Approved reports" : "Dashboard", icon: "grid" as const, count: user.role === "COMPLIANCE" ? undefined : mine },
    ...(user.role === "ANALYST" || user.role === "REVIEWER" ? [{ href: "/queue", label: user.role === "REVIEWER" ? "Review queue" : "Change requests", icon: "check" as const, count: queue, hot: true }] : []),
    ...(user.role === "ADMIN" ? [{ href: "/admin/users", label: "Users and roles", icon: "users" as const }] : []),
    { href: "/api/template", label: "Upload template", icon: "file" as const, external: true },
  ];

  return (
    <div className="flex min-h-screen flex-wrap bg-[#0b1020]">
      <nav aria-label="Main navigation" className="flex shrink-0 grow basis-[248px] flex-col gap-6 border-r border-gray-200 bg-[#0e1527] px-3.5 py-5 lg:sticky lg:top-0 lg:h-screen lg:grow-0">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <Logo />
          <span className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight">AnalystDesk</span>
        </Link>
        <SideNav items={items} />
        <div className="mt-auto flex flex-col gap-3.5">
          {user.role !== "COMPLIANCE" && (
            <div className="hidden rounded-2xl border border-gray-200 bg-gray-50 p-3.5 lg:block">
              <p className="eyebrow">Team this month</p>
              <p className="mono mt-1.5 text-2xl font-semibold text-blue-700">{hours.toFixed(1)} h</p>
              <p className="mt-1 text-xs text-gray-500">active analysis time · {approvedThisMonth} report{approvedThisMonth === 1 ? "" : "s"} approved</p>
            </div>
          )}
          <div className="flex items-center gap-2.5 px-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#818cf8] text-[13px] font-bold text-[#0b1020]">{initials(user.name)}</span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{user.name}</span>
              <span className="text-xs text-gray-500">{ROLE_LABEL[user.role]}</span>
            </div>
            <form action={doLogout}>
              <button aria-label="Sign out" title="Sign out" className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900"><IconLogout /></button>
            </form>
          </div>
        </div>
      </nav>
      <main className="min-w-0 grow-[999] basis-[560px] px-5 py-7 sm:px-9">
        <div className="mx-auto max-w-[1280px]">{children}</div>
      </main>
    </div>
  );
}
