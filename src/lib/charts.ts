// Static SVG charts shared by the in-app report, the PDF and the Word export (rasterised there).
import type { ChartSpec } from "./report";

export type ChartTheme = "light" | "dark";
const THEMES = {
  light: { bg: "#ffffff", ink: "#1f2937", muted: "#4b5563", grid: "#e5e7eb", s1: "#0891b2", s2: "#6366f1", marker: "#dc2626", halo: "#ffffff" },
  dark: { bg: "#121a2e", ink: "#eef2fa", muted: "#a3aec4", grid: "#26324f", s1: "#22d3ee", s2: "#818cf8", marker: "#fbbf24", halo: "#121a2e" },
};
let C = THEMES.light;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toLocaleString("en-IN", { maximumFractionDigits: 1 }));

export function chartSvg(spec: ChartSpec, width = 640, theme: ChartTheme = "light"): string {
  C = THEMES[theme];
  return spec.kind === "range" ? rangeChart(spec, width) : barChart(spec, width);
}

function barChart(spec: ChartSpec, W: number): string {
  const H = 280, L = 64, R = 16, T = 40, B = 36;
  const vals = spec.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const min = Math.min(0, ...vals);
  const max = niceMax(Math.max(0, ...vals));
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const groupW = (W - L - R) / spec.labels.length;
  const barW = Math.min(28, (groupW * 0.7) / spec.series.length);
  const colors = [C.s1, C.s2];
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Arial, sans-serif" font-size="11" role="img" aria-label="${esc(spec.title)}">`;
  out += `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  out += `<text x="${L}" y="18" font-size="13" font-weight="600" fill="${C.ink}">${esc(spec.title)}</text>`;
  spec.series.forEach((s, i) => {
    const lx = W - R - 150 + i * 80;
    out += `<rect x="${lx}" y="9" width="10" height="10" rx="2" fill="${colors[i % 2]}"/><text x="${lx + 14}" y="18" fill="${C.ink}">${esc(s.name)}</text>`;
  });
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    out += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="${C.muted}">${fmt(v)}</text>`;
  }
  spec.labels.forEach((lab, gi) => {
    const gx = L + gi * groupW + (groupW - barW * spec.series.length) / 2;
    spec.series.forEach((s, si) => {
      const v = s.values[gi];
      if (v === null) return;
      const y0 = y(0), y1 = y(v);
      out += `<rect x="${gx + si * barW}" y="${Math.min(y0, y1)}" width="${barW - 3}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="2" fill="${colors[si % 2]}"><title>${esc(s.name)} ${esc(lab)}: ${fmt(v)}</title></rect>`;
    });
    out += `<text x="${L + gi * groupW + groupW / 2}" y="${H - B + 16}" text-anchor="middle" fill="${C.muted}">${esc(lab)}</text>`;
  });
  return out + `</svg>`;
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function rangeChart(spec: ChartSpec, W: number): string {
  const rows = spec.ranges ?? [];
  const rowH = 34, T = 44, L = 170, R = 24, B = 34;
  const H = T + rows.length * rowH + B;
  const vals = [...rows.flatMap((r) => [r.low, r.high]), spec.marker?.value ?? NaN].filter((v) => Number.isFinite(v));
  const step = niceStep((Math.max(...vals) - Math.min(...vals)) / 4);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - step * 0.3) / step) * step);
  const hi = Math.ceil((Math.max(...vals) + step * 0.3) / step) * step;
  const x = (v: number) => L + ((W - L - R) * (v - lo)) / (hi - lo || 1);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Arial, sans-serif" font-size="11" role="img" aria-label="${esc(spec.title)}">`;
  out += `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  out += `<text x="16" y="18" font-size="13" font-weight="600" fill="${C.ink}">${esc(spec.title)}</text>`;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    out += `<line x1="${x(v)}" x2="${x(v)}" y1="${T - 6}" y2="${H - B}" stroke="${C.grid}"/><text x="${x(v)}" y="${H - B + 16}" text-anchor="middle" fill="${C.muted}">${fmt(v)}</text>`;
  }
  if (spec.marker) {
    const mx = x(spec.marker.value);
    const anchor = mx > L + (W - L - R) * 0.6 ? "end" : "start";
    out += `<line x1="${mx}" x2="${mx}" y1="${T - 10}" y2="${H - B}" stroke="${C.marker}" stroke-width="2" stroke-dasharray="4 3"/><text x="${anchor === "end" ? mx - 4 : mx + 4}" y="${T - 14}" text-anchor="${anchor}" fill="${C.marker}">${esc(spec.marker.label)}</text>`;
  }
  rows.forEach((r, i) => {
    const cy = T + i * rowH + rowH / 2;
    const x0 = x(r.low), x1 = x(r.high);
    out += `<text x="${L - 10}" y="${cy + 4}" text-anchor="end" fill="${C.ink}">${esc(r.label)}</text>`;
    out += `<rect x="${x0}" y="${cy - 8}" width="${Math.max(2, x1 - x0)}" height="16" rx="3" fill="${i === 0 ? C.s1 : C.s2}" opacity="0.85"><title>${esc(r.label)}: ${fmt(r.low)} – ${fmt(r.high)}</title></rect>`;
    const label = `${fmt(r.low)} – ${fmt(r.high)}`;
    const right = x1 + 6 + label.length * 6 < W - R;
    out += right
      ? `<text x="${x1 + 6}" y="${cy + 4}" fill="${C.muted}" font-size="10" paint-order="stroke" stroke="${C.halo}" stroke-width="4">${label}</text>`
      : `<text x="${x0 - 6}" y="${cy + 4}" text-anchor="end" fill="${C.muted}" font-size="10" paint-order="stroke" stroke="${C.halo}" stroke-width="4">${label}</text>`;
  });
  return out + `</svg>`;
}
