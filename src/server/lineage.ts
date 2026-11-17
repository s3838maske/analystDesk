// AUD-01: trace any displayed number back to its source document, retrieval time and formula.
import "server-only";
import { prisma } from "./db";
import { loadDataset } from "./analysis";
import { DERIVED, MetricCtx, RATIO_BY_KEY, RATIO_FORMULA_VERSION, TraceInput } from "@/lib/ratios";
import { LINE_ITEM_BY_KEY, MAPPING_VERSION } from "@/lib/coa";
import { ASSUMPTIONS, MODEL_FORMULAS, ModelInputs, ModelOutputs } from "@/lib/model";

export interface LineageNode {
  kind: "stored" | "derived" | "ratio" | "model" | "assumption" | "unknown";
  title: string;
  value: string | null;
  format?: "inr" | "pct" | "x" | "raw";
  formula?: string;
  formulaVersion?: string;
  inputs?: TraceInput[];
  source?: {
    fileName: string | null;
    fileId: string | null;
    sourceLabel: string | null;
    uploadedBy: string | null;
    uploadedAt: Date | null;
    sourceRef: string | null;
    rawLabel: string;
    rawValue: string;
    rawUnit: string;
    mappingVersion: string;
    origin: string;
    reason: string | null;
    createdAt: Date;
  };
  history?: { value: string; origin: string; reason: string | null; createdAt: Date; active: boolean; by: string }[];
  notes?: string[];
}

const ASSUMPTION_USE: Record<string, string[]> = {
  revenue: ["revenue_growth"],
  ebitda: ["revenue_growth", "ebitda_margin"],
  dep: ["dep_pct_revenue"],
  ebit: ["ebitda_margin", "dep_pct_revenue"],
  interest: ["interest_rate"],
  tax: ["tax_rate"],
  pat: ["tax_rate", "interest_rate"],
  nwc: ["nwc_pct_revenue"],
  delta_nwc: ["nwc_pct_revenue"],
  capex: ["capex_pct_revenue"],
  fcff: ["ebitda_margin", "dep_pct_revenue", "tax_rate", "capex_pct_revenue", "nwc_pct_revenue"],
  pv_fcff: ["wacc"],
};

export async function resolveLineage(analysisId: string, ref: string): Promise<LineageNode> {
  const [kind, ...rest] = ref.split(":");
  if (kind === "v") {
    const [companyId, period, lineItem] = rest;
    const all = await prisma.financialValue.findMany({ where: { analysisId, companyId, period, lineItem }, include: { file: true }, orderBy: { createdAt: "asc" } });
    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const uname = (id: string) => users.find((u) => u.id === id)?.name ?? id;
    const ds = await loadDataset(analysisId);
    const cell = ds.cell(companyId, period, lineItem);
    const active = all.find((x) => x.id === cell?.id) ?? all[all.length - 1];
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!active) return { kind: "unknown", title: `${LINE_ITEM_BY_KEY[lineItem]?.label ?? lineItem}, ${period}`, value: null, notes: ["No value stored."] };
    return {
      kind: "stored",
      title: `${company?.name ?? ""} · ${LINE_ITEM_BY_KEY[lineItem]?.label ?? lineItem} · ${period.startsWith("D") ? period.slice(1) : period}`,
      value: active.value,
      format: LINE_ITEM_BY_KEY[lineItem]?.kind === "money" || !LINE_ITEM_BY_KEY[lineItem]?.kind ? "inr" : "raw",
      source: {
        fileName: active.file?.fileName ?? null,
        fileId: active.fileId,
        sourceLabel: active.file?.sourceLabel ?? (active.origin === "ANALYST" ? "Entered by analyst" : null),
        uploadedBy: active.file ? uname(active.file.uploadedBy) : uname(active.createdBy),
        uploadedAt: active.file?.uploadedAt ?? active.createdAt,
        sourceRef: active.sourceRef,
        rawLabel: active.rawLabel,
        rawValue: active.rawValue,
        rawUnit: active.rawUnit,
        mappingVersion: active.mappingVersion,
        origin: active.origin,
        reason: active.reason,
        createdAt: active.createdAt,
      },
      history: all.map((x) => ({ value: x.value, origin: x.origin, reason: x.reason, createdAt: x.createdAt, active: x.id === active.id, by: uname(x.createdBy) })),
    };
  }
  if (kind === "d" || kind === "r") {
    const [companyId, period, key] = rest;
    const ds = await loadDataset(analysisId);
    const m = new MetricCtx(ds, companyId, period);
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const c = kind === "d" ? DERIVED[key]?.(m) : RATIO_BY_KEY[key]?.compute(m);
    if (!c) return { kind: "unknown", title: ref, value: null };
    return {
      kind: kind === "d" ? "derived" : "ratio",
      title: `${company?.name ?? ""} · ${c.label} · ${period}`,
      value: c.value?.toString() ?? null,
      format: kind === "d" ? (["eps", "bvps"].includes(key) ? "raw" : "inr") : RATIO_BY_KEY[key].format === "pct" ? "pct" : "x",
      formula: c.formula,
      formulaVersion: kind === "d" ? `${RATIO_FORMULA_VERSION} / ${MAPPING_VERSION}` : RATIO_FORMULA_VERSION,
      inputs: c.inputs,
    };
  }
  if (kind === "m") {
    const [runId, path] = rest;
    const run = await prisma.modelRun.findUnique({ where: { id: runId } });
    if (!run) return { kind: "unknown", title: ref, value: null };
    const inputs: ModelInputs = JSON.parse(run.inputs);
    const out: ModelOutputs = JSON.parse(run.outputs);
    const parts = path.split(".");
    let value: string | null = null;
    let formula = "";
    let asmKeys: string[] = [];
    let title = path;
    if (parts[0] === "forecast") {
      const [, year, item] = parts;
      value = out.forecast[year]?.[item] ?? null;
      formula = MODEL_FORMULAS[item] ?? item;
      asmKeys = ASSUMPTION_USE[item] ?? [];
      title = `Forecast ${item} · ${year}`;
    } else if (parts[0] === "dcf") {
      value = out.dcf[parts[1]] ?? null;
      formula = MODEL_FORMULAS[parts[1]] ?? parts[1];
      asmKeys = ["wacc", "terminal_growth"];
      title = `DCF · ${parts[1].replace(/_/g, " ")}`;
    } else if (parts[0] === "sensitivity") {
      const [i, j] = [Number(parts[1]), Number(parts[2])];
      value = out.sensitivity.grid[i]?.[j] ?? null;
      formula = `DCF value per share at WACC ${(Number(out.sensitivity.waccs[i]) * 100).toFixed(1)}% and terminal growth ${(Number(out.sensitivity.growths[j]) * 100).toFixed(1)}%`;
      title = "Sensitivity cell";
    } else if (parts[0] === "comps") {
      const row = parts[1] === "pe" ? out.comps.pe : parts[1] === "ev_ebitda" ? out.comps.ev_ebitda : null;
      if (parts[1] === "low" || parts[1] === "high") {
        value = out.comps[parts[1]];
        formula = `${parts[1] === "low" ? "Lowest" : "Highest"} implied value across P/E and EV/EBITDA comps`;
      } else {
        value = row?.[parts[2]] ?? null;
        formula = parts[1] === "pe" ? MODEL_FORMULAS.pe_implied : MODEL_FORMULAS.ev_ebitda_implied;
      }
      title = `Trading comps · ${parts.slice(1).join(" ")}`;
    }
    const baseInputs: TraceInput[] = Object.entries(inputs.base).map(([k, b]) => ({ name: `Base ${k.replace(/_/g, " ")} (${inputs.baseYear})`, value: b.value, ref: b.ref }));
    const asmInputs: TraceInput[] = (asmKeys.length ? asmKeys : Object.keys(inputs.assumptions)).map((k) => ({ name: ASSUMPTIONS.find((d) => d.key === k)?.label ?? k, value: inputs.assumptions[k], ref: `a:${analysisId}:${k}` }));
    const peerInputs: TraceInput[] = parts[0] === "comps" ? inputs.peers.flatMap((p) => [{ name: `${p.name} P/E`, value: p.pe, ref: "" }, { name: `${p.name} EV/EBITDA`, value: p.ev_ebitda, ref: "" }]) : [];
    return {
      kind: "model",
      title,
      value,
      format: parts[0] === "dcf" && parts[1] === "upside" ? "pct" : parts[0] === "forecast" || ["enterprise_value", "equity_value", "sum_pv_fcff", "terminal_value", "pv_terminal_value"].includes(parts[1]) ? "inr" : "raw",
      formula,
      formulaVersion: run.formulaVersion,
      inputs: [...asmInputs, ...peerInputs, ...baseInputs],
      notes: [`Model run ${run.id} at ${run.createdAt.toISOString()}. Re-running with the same inputs and formula version gives identical outputs.`],
    };
  }
  if (kind === "a") {
    const [, key] = rest;
    const a = await prisma.assumption.findUnique({ where: { analysisId_key: { analysisId, key } } });
    const def = ASSUMPTIONS.find((d) => d.key === key);
    if (!a) return { kind: "unknown", title: ref, value: null };
    const logs = await prisma.auditLog.findMany({ where: { analysisId, entity: "Assumption", entityId: a.id }, orderBy: { at: "asc" } });
    return {
      kind: "assumption",
      title: `Assumption · ${def?.label ?? key}`,
      value: a.value,
      format: "pct",
      formula: a.origin === "AUTOMATED" ? `Default: ${a.basis}` : `Set by analyst (default was ${(Number(a.defaultValue) * 100).toFixed(2)}%: ${a.basis})`,
      notes: [a.confirmed ? "Confirmed by analyst." : "Not yet confirmed."],
      history: logs.map((l) => {
        const d = JSON.parse(l.detail);
        return { value: d.value ?? "", origin: l.action, reason: d.reason ?? null, createdAt: l.at, active: false, by: l.userName };
      }),
    };
  }
  return { kind: "unknown", title: ref, value: null };
}
