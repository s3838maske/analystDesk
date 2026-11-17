"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCheckSquare, IconFile, IconGrid, IconUsers } from "./icons";

type Item = { href: string; label: string; icon: "grid" | "check" | "file" | "users"; count?: number; hot?: boolean; external?: boolean };
const ICONS = { grid: IconGrid, check: IconCheckSquare, file: IconFile, users: IconUsers };

export default function SideNav({ items }: { items: Item[] }) {
  const path = usePathname();
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow px-3 pb-1.5">Workspace</span>
      {items.map((it) => {
        const active = !it.external && (it.href === "/" ? path === "/" || path.startsWith("/analyses") : path.startsWith(it.href.split("?")[0]));
        const Icon = ICONS[it.icon];
        const cls = `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm ${active ? "bg-gray-100 font-semibold text-gray-900 shadow-[inset_0_0_0_1px_#33415f]" : "font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`;
        const inner = (
          <>
            <Icon className={active ? "text-blue-700" : ""} />
            <span className="flex-1">{it.label}</span>
            {it.count !== undefined && it.count > 0 && (
              <span className={`mono rounded-md px-1.5 py-0.5 text-xs font-semibold ${it.hot ? "bg-blue-700 text-[#04141b]" : "bg-gray-100 text-gray-700"}`}>{it.count}</span>
            )}
          </>
        );
        return it.external ? <a key={it.href} href={it.href} className={cls}>{inner}</a> : <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined} className={cls}>{inner}</Link>;
      })}
    </div>
  );
}
