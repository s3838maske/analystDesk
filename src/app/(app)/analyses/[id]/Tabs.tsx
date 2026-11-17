"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STEPS: [string, string][] = [
  ["", "Overview"],
  ["data", "Upload data"],
  ["validation", "Flags"],
  ["ratios", "Ratios"],
  ["model", "Model"],
  ["report", "Report"],
  ["review", "Review"],
];

/** Step bar: done steps cyan, the current step indigo, the rest grey. */
export default function Tabs({ id, done }: { id: string; done: Record<string, boolean> }) {
  const path = usePathname();
  const seg = path.split(`/analyses/${id}`)[1]?.split("/")[1] ?? "";
  return (
    <div className="overflow-x-auto">
      <ol aria-label="Analysis steps" className="grid min-w-[760px] grid-cols-7 gap-2.5">
        {STEPS.map(([s, label], i) => {
          const current = seg === s;
          const bar = current ? "bg-[#818cf8]" : done[s] ? "bg-[#22d3ee]" : "bg-gray-200";
          return (
            <li key={s}>
              <Link href={`/analyses/${id}${s ? "/" + s : ""}`} aria-current={current ? "step" : undefined} className="group flex min-h-11 flex-col gap-2.5">
                <span className={`h-1 rounded-full ${bar}`} />
                <span className={`text-xs ${current ? "font-bold text-gray-900" : done[s] ? "font-semibold text-gray-700 group-hover:text-gray-900" : "font-semibold text-gray-500 group-hover:text-gray-800"}`}>
                  {String(i + 1).padStart(2, "0")} · {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
