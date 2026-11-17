import type { Block, RenderedSection, Run } from "@/lib/report";
import { chartSvg } from "@/lib/charts";
import { Num } from "./ui";

function Runs({ runs, id }: { runs: Run[]; id: string }) {
  return (
    <>
      {runs.map((r, i) =>
        r.token ? (
          r.text.startsWith("[missing") ? <span key={i} className="rounded bg-red-50 px-1 text-red-700">{r.text}</span> : <span key={i} className="font-medium text-blue-900"><Num analysisId={id} refKey={r.ref}>{r.text}</Num></span>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

export function BlockView({ b, id }: { b: Block; id: string }) {
  if (b.type === "p") return <p className="mb-2 leading-relaxed"><Runs runs={b.runs} id={id} /></p>;
  if (b.type === "bullets") return <ul className="mb-2 list-disc pl-5">{b.items.map((it, i) => <li key={i}><Runs runs={it} id={id} /></li>)}</ul>;
  if (b.type === "chart") return <figure className="my-3 max-w-2xl" dangerouslySetInnerHTML={{ __html: chartSvg(b.chart, 640, "dark") }} />;
  if (b.type === "table")
    return (
      <figure className="my-3 overflow-x-auto">
        <figcaption className="mb-1 text-sm font-semibold">{b.title}</figcaption>
        <table className="tbl">
          <thead><tr>{b.header.map((h, i) => <th key={i} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i} className={r.emphasis ? "bg-blue-50 font-medium" : ""}>
                {r.cells.map((c, j) => (j === 0 ? <td key={j}>{c.text}</td> : <td key={j} className="num"><Num analysisId={id} refKey={c.ref}>{c.text}</Num></td>))}
              </tr>
            ))}
          </tbody>
        </table>
        {b.note && <p className="muted mt-1 text-xs">{b.note}</p>}
      </figure>
    );
  return <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">[{b.token} not available yet — run the model first]</p>;
}

export default function ReportView({ sections, id }: { sections: RenderedSection[]; id: string }) {
  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <section key={s.key}>
          <h2 className="mb-2 border-b border-gray-200 pb-1 text-lg font-semibold">{s.title}</h2>
          {s.blocks.length ? s.blocks.map((b, i) => <BlockView key={i} b={b} id={id} />) : <p className="italic text-red-600">Empty — to be written by the analyst.</p>}
        </section>
      ))}
    </div>
  );
}
