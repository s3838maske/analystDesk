// Indian fiscal years run April–March. FY2025 = Apr 2024 – Mar 2025. Quarters: Q1FY26 = Apr–Jun 2025.

export function fyLabel(fy: number): string {
  return `FY${fy}`;
}

export function annualPeriods(from: number, to: number): string[] {
  const out: string[] = [];
  for (let y = from; y <= to; y++) out.push(fyLabel(y));
  return out;
}

export function isAnnual(p: string): boolean {
  return /^FY\d{4}$/.test(p);
}
export function isQuarter(p: string): boolean {
  return /^Q[1-4]FY\d{2}$/.test(p);
}
export function isPriceDate(p: string): boolean {
  return /^D\d{4}-\d{2}-\d{2}$/.test(p);
}

export function fyOf(p: string): number | null {
  const m = /^FY(\d{4})$/.exec(p);
  return m ? Number(m[1]) : null;
}

/** Latest N quarters ending with the quarter that contains `today`'s previous completed quarter. */
export function latestQuarters(n: number, today = new Date()): string[] {
  // last completed quarter
  const m = today.getMonth(); // 0=Jan
  const y = today.getFullYear();
  // quarter end months: Jun(5)=Q1, Sep(8)=Q2, Dec(11)=Q3, Mar(2)=Q4
  let qEndMonth: number;
  let qEndYear: number;
  if (m >= 9) { qEndMonth = 8; qEndYear = y; }
  else if (m >= 6) { qEndMonth = 5; qEndYear = y; }
  else if (m >= 3) { qEndMonth = 2; qEndYear = y; }
  else { qEndMonth = 11; qEndYear = y - 1; }
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const q = qEndMonth === 5 ? 1 : qEndMonth === 8 ? 2 : qEndMonth === 11 ? 3 : 4;
    const fy = qEndMonth === 2 ? qEndYear : qEndYear + 1;
    out.unshift(`Q${q}FY${String(fy).slice(-2)}`);
    qEndMonth -= 3;
    if (qEndMonth < 0) { qEndMonth += 12; qEndYear -= 1; }
  }
  return out;
}

/** Last completed fiscal year as of today. */
export function lastCompletedFY(today = new Date()): number {
  return today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
}

/**
 * Parse a period header from a spreadsheet into our label.
 * Accepts: FY2025, FY25, FY 2025, Mar-25, Mar 2025, 2025-03-31, 2025, Q1FY26, Q1 FY26, Jun-25 (quarterly when quarterly=true)
 */
export function parsePeriodHeader(raw: unknown, quarterly = false): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return dateToPeriod(raw, quarterly);
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  let m = /^FY'?(\d{4}|\d{2})$/.exec(s);
  if (m) return `FY${m[1].length === 2 ? "20" + m[1] : m[1]}`;
  m = /^Q([1-4])FY'?(\d{2}|\d{4})$/.exec(s);
  if (m) return `Q${m[1]}FY${m[2].slice(-2)}`;
  m = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-'/ ]?(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(m[1]);
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return dateToPeriod(new Date(Date.UTC(year, month, 28)), quarterly);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return dateToPeriod(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), quarterly);
  m = /^(\d{4})$/.exec(s);
  if (m && !quarterly) return `FY${m[1]}`;
  return null;
}

function dateToPeriod(d: Date, quarterly: boolean): string | null {
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  if (!quarterly) {
    if (month !== 2) return null; // annual figures must be March year-ends
    return `FY${year}`;
  }
  const map: Record<number, [number, number]> = { 5: [1, year + 1], 8: [2, year + 1], 11: [3, year + 1], 2: [4, year] };
  const q = map[month];
  if (!q) return null;
  return `Q${q[0]}FY${String(q[1]).slice(-2)}`;
}

/** Fiscal year end date for an annual period. */
export function fyEndDate(fy: number): string {
  return `${fy}-03-31`;
}

export function sortPeriods(ps: string[]): string[] {
  const key = (p: string) => {
    let m = /^FY(\d{4})$/.exec(p);
    if (m) return Number(m[1]) * 10 + 5;
    m = /^Q([1-4])FY(\d{2})$/.exec(p);
    if (m) return (2000 + Number(m[2])) * 10 + Number(m[1]);
    return 0;
  };
  return [...ps].sort((a, b) => key(a) - key(b));
}
