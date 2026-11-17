// Inline stroke icons (decorative; labels carry the meaning).
type P = { size?: number; className?: string };
const base = (size = 18, className = "") => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className });

export const Logo = ({ size = 34 }: { size?: number }) => (
  <span className="flex items-center justify-center rounded-[10px] bg-blue-700 text-[#04141b]" style={{ width: size, height: size }}>
    <svg {...base(size * 0.56)} strokeWidth={2.4}><path d="M4 20V11" /><path d="M10 20V5" /><path d="M16 20v-6" /><path d="M21 4l-5 5-3-3-4 4" /></svg>
  </span>
);
export const IconGrid = (p: P) => <svg {...base(p.size, p.className)}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>;
export const IconLayers = (p: P) => <svg {...base(p.size, p.className)}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>;
export const IconCheckSquare = (p: P) => <svg {...base(p.size, p.className)}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></svg>;
export const IconFile = (p: P) => <svg {...base(p.size, p.className)}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>;
export const IconUsers = (p: P) => <svg {...base(p.size, p.className)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14a6 6 0 0 1 3.5 6" /></svg>;
export const IconPlus = (p: P) => <svg {...base(p.size ?? 16, p.className)} strokeWidth={2.6}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
export const IconAlert = (p: P) => <svg {...base(p.size, p.className)} strokeWidth={2.2}><path d="M12 3l10 18H2z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>;
export const IconSliders = (p: P) => <svg {...base(p.size, p.className)} strokeWidth={2.2}><path d="M4 6h10" /><path d="M4 12h4" /><path d="M12 12h8" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /></svg>;
export const IconPen = (p: P) => <svg {...base(p.size, p.className)} strokeWidth={2.2}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>;
export const IconArrowRight = (p: P) => <svg {...base(p.size, p.className)} strokeWidth={2.4}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>;
export const IconLogout = (p: P) => <svg {...base(p.size, p.className)}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h11" /></svg>;
export const IconShield = (p: P) => <svg {...base(p.size, p.className)}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;
export const IconClock = (p: P) => <svg {...base(p.size, p.className)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>;
