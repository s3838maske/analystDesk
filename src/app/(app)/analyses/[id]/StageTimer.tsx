"use client";
// ADM-01: records active time per stage. Counts a 15-second tick only while the tab is visible
// and the user has interacted within the last 60 seconds.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const STAGES: Record<string, string> = { data: "DATA", validation: "VALIDATION", ratios: "RATIOS", model: "MODEL", report: "REPORT", review: "REVIEW" };

export default function StageTimer({ id }: { id: string }) {
  const path = usePathname();
  const seg = path.split(`/analyses/${id}`)[1]?.split("/")[1] ?? "";
  const stage = STAGES[seg];
  const last = useRef(Date.now());
  useEffect(() => {
    const bump = () => (last.current = Date.now());
    const evs = ["mousemove", "keydown", "scroll", "click"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    if (!stage) return () => evs.forEach((e) => window.removeEventListener(e, bump));
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last.current < 60_000) {
        fetch(`/api/analyses/${id}/time`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage, seconds: 15 }), keepalive: true }).catch(() => {});
      }
    }, 15_000);
    return () => {
      clearInterval(t);
      evs.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [id, stage]);
  return null;
}
