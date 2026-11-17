// In-memory view of an analysis's active financial values, used by validation, ratios and the model.
import { D, Decimal } from "./decimal";
import { isPriceDate } from "./periods";

export interface ValueRow {
  id: string;
  companyId: string;
  period: string;
  lineItem: string;
  value: string;
  origin: string;
  fileId?: string | null;
  createdAt?: Date | string;
}

export interface Cell {
  id: string;
  value: Decimal;
  origin: string;
}

export class Dataset {
  private map = new Map<string, Cell>();
  /** all active rows per key (more than one = conflicting uploads / restatement) */
  private all = new Map<string, ValueRow[]>();

  constructor(rows: ValueRow[]) {
    // later rows win: analyst/overridden values beat automated; otherwise latest upload wins
    const rank = (o: string) => (o === "AUTOMATED" ? 0 : 1);
    const sorted = [...rows].sort((a, b) => {
      const r = rank(a.origin) - rank(b.origin);
      if (r) return r;
      return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
    });
    for (const r of sorted) {
      const k = Dataset.key(r.companyId, r.period, r.lineItem);
      this.map.set(k, { id: r.id, value: D(r.value), origin: r.origin });
      const list = this.all.get(k) ?? [];
      list.push(r);
      this.all.set(k, list);
    }
  }

  static key(companyId: string, period: string, lineItem: string) {
    return `${companyId}|${period}|${lineItem}`;
  }

  get(companyId: string, period: string, lineItem: string): Decimal | null {
    return this.map.get(Dataset.key(companyId, period, lineItem))?.value ?? null;
  }

  cell(companyId: string, period: string, lineItem: string): Cell | null {
    return this.map.get(Dataset.key(companyId, period, lineItem)) ?? null;
  }

  conflicts(): { key: string; rows: ValueRow[] }[] {
    const out: { key: string; rows: ValueRow[] }[] = [];
    for (const [key, rows] of this.all) {
      const automated = rows.filter((r) => r.origin === "AUTOMATED");
      const distinct = new Set(automated.map((r) => D(r.value).toString()));
      const hasAnalyst = rows.some((r) => r.origin !== "AUTOMATED");
      if (distinct.size > 1 && !hasAnalyst) out.push({ key, rows: automated });
    }
    return out;
  }

  periods(companyId: string): string[] {
    const s = new Set<string>();
    for (const k of this.map.keys()) {
      const [c, p] = k.split("|");
      if (c === companyId) s.add(p);
    }
    return [...s];
  }

  /** Latest price on or before a date (YYYY-MM-DD). */
  priceOn(companyId: string, date: string): { date: string; value: Decimal; id: string } | null {
    let best: { date: string; value: Decimal; id: string } | null = null;
    for (const [k, c] of this.map) {
      const [cid, p, li] = k.split("|");
      if (cid !== companyId || li !== "price" || !isPriceDate(p)) continue;
      const d = p.slice(1);
      if (d <= date && (!best || d > best.date)) best = { date: d, value: c.value, id: c.id };
    }
    return best;
  }

  /** Latest shares outstanding on or before a date; falls back to annual figures. */
  sharesOn(companyId: string, date: string): { date: string; value: Decimal; id: string } | null {
    let best: { date: string; value: Decimal; id: string } | null = null;
    for (const [k, c] of this.map) {
      const [cid, p, li] = k.split("|");
      if (cid !== companyId || li !== "shares_outstanding") continue;
      const d = isPriceDate(p) ? p.slice(1) : /^FY(\d{4})$/.test(p) ? `${p.slice(2)}-03-31` : null;
      if (!d) continue;
      if (d <= date && (!best || d > best.date)) best = { date: d, value: c.value, id: c.id };
    }
    return best;
  }

  latestPrice(companyId: string) {
    return this.priceOn(companyId, "9999-12-31");
  }
}
