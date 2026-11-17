"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Section } from "@/lib/report";

export default function Editor({ sections, tokens, onSave }: { sections: Section[]; tokens: string[]; onSave: (key: string, body: string) => Promise<{ ok?: boolean; error?: string }> }) {
  const [active, setActive] = useState(sections.find((s) => s.analystOnly && !s.body.trim())?.key ?? sections[0].key);
  const [bodies, setBodies] = useState<Record<string, string>>(Object.fromEntries(sections.map((s) => [s.key, s.body])));
  const [status, setStatus] = useState<string>("");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const sec = sections.find((s) => s.key === active)!;
  const dirty = (k: string) => bodies[k] !== sections.find((s) => s.key === k)!.body;

  const insert = (t: string) => {
    const el = ref.current;
    const tok = t.startsWith("table:") || t.startsWith("chart:") ? `\n\n{{${t}}}\n\n` : `{{${t}}}`;
    const b = bodies[active];
    const pos = el ? el.selectionStart : b.length;
    setBodies((x) => ({ ...x, [active]: b.slice(0, pos) + tok + b.slice(pos) }));
  };
  const save = () =>
    start(async () => {
      const r = await onSave(active, bodies[active]);
      setStatus(r.error ? `Error: ${r.error}` : "Saved. Your changes are stored.");
      router.refresh();
    });

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap gap-1">
        {sections.map((s) => (
          <button key={s.key} onClick={() => { setActive(s.key); setStatus(""); }} className={`badge ${s.key === active ? "bg-blue-700 text-white" : s.analystOnly && !bodies[s.key].trim() ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700"}`}>
            {s.title}{dirty(s.key) ? " •" : ""}
          </button>
        ))}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label">{sec.title} {sec.analystOnly ? "(written by the analyst)" : "(auto-drafted; edit freely)"}</span>
          <select className="input w-56" value="" onChange={(e) => e.target.value && insert(e.target.value)}>
            <option value="">Insert linked number…</option>
            {tokens.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <textarea ref={ref} className="input font-mono text-[13px]" rows={18} value={bodies[active]} onChange={(e) => setBodies((x) => ({ ...x, [active]: e.target.value }))} placeholder={sec.analystOnly ? "Write this section. Blank line = new paragraph; lines starting with “- ” = bullets." : ""} />
        <p className="muted mt-1 text-xs">Blank line = new paragraph. “- ” = bullet. {"{{token}}"} = number linked to the model. A table or chart token goes on its own line.</p>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" onClick={save} disabled={pending || !dirty(active)}>{pending ? "Saving…" : "Save section"}</button>
        <span className={`text-sm ${status.startsWith("Error") ? "text-red-700" : "text-gray-500"}`}>
          {pending ? "" : status && !dirty(active) ? status : dirty(active) ? "You have unsaved changes in this section." : "Nothing to save yet. The button turns on as soon as you change the text above."}
        </span>
      </div>
    </div>
  );
}
