"use client";

import { useState } from "react";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";

const METRIC_FIELDS: Record<string, string> = { skip: "– ignorieren –", date: "Datum", followers: "Follower", views: "Aufrufe/Impressionen", posts: "Beiträge" };
const POST_FIELDS: Record<string, string> = {
  skip: "– ignorieren –",
  id: "Beitrags-ID",
  url: "Link",
  title: "Text/Titel",
  publishedAt: "Datum",
  impressions: "Impressionen",
  views: "Aufrufe",
  likes: "Likes/Reaktionen",
  comments: "Kommentare",
  shares: "Geteilt/Reposts",
  clicks: "Klicks",
};

type Preview = { header: string[]; kind: "metrics" | "posts"; mapping: string[]; sample: string[][]; rows: number };

/** Import eines Plattform-Exports (CSV): Datei wählen → Vorschau mit Spaltenzuordnung → speichern. */
export function ImportForm({ slug, accountId }: { slug: string; accountId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [kind, setKind] = useState<"metrics" | "posts">("metrics");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMsg({});
    try {
      const res = await fetch("/api/channels/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, accountId, ...body }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
      return data;
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    setPreview(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setMsg({ error: "Datei ist größer als 2 MB." });
    if (!/\.csv$|text\/csv|text\/plain/i.test(`${file.name} ${file.type}`)) return setMsg({ error: "Bitte als CSV speichern (Excel: „Speichern unter → CSV UTF-8“)." });
    const t = await file.text();
    setText(t);
    const p = (await call({ text: t })) as Preview | null;
    if (p) {
      setPreview(p);
      setMapping(p.mapping);
      setKind(p.kind);
    }
  }

  async function switchKind(k: "metrics" | "posts") {
    if (!text) return;
    const p = (await call({ text, kind: k })) as Preview | null;
    if (p) {
      setPreview(p);
      setMapping(p.mapping);
      setKind(k);
    }
  }

  async function apply() {
    if (!text) return;
    const r = await call({ text, apply: true, kind, mapping });
    if (r?.ok) {
      setMsg({ ok: r.ok });
      setPreview(null);
      setText(null);
      // Seite neu laden, damit Kennzahlen/Beiträge erscheinen
      window.location.reload();
    }
  }

  const fields = kind === "metrics" ? METRIC_FIELDS : POST_FIELDS;
  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        <span className="mb-1 block text-ink-600 dark:text-ink-200">Export der Plattform (CSV, max. 2 MB)</span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block text-sm" disabled={busy} />
      </label>
      {preview && (
        <div className="space-y-2 rounded-md border border-ink-100 p-3 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            <span>{preview.rows} Zeilen erkannt als</span>
            <select value={kind} onChange={(e) => switchKind(e.target.value as "metrics" | "posts")} className={`${inputCls} w-auto`} aria-label="Art der Daten">
              <option value="metrics">Tageswerte (Follower/Aufrufe)</option>
              <option value="posts">Beiträge mit Kennzahlen</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  {preview.header.map((h, i) => (
                    <th key={i} className="px-1 pb-1 text-left align-bottom">
                      <div className="mb-1 font-normal text-ink-400">{h}</div>
                      <select
                        aria-label={`Zuordnung für Spalte ${h}`}
                        value={mapping[i] ?? "skip"}
                        onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? e.target.value : v)))}
                        className={`${inputCls} min-w-28 py-1 text-xs`}
                      >
                        {Object.entries(fields).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {preview.sample.map((r, i) => (
                  <tr key={i} className="border-t border-black/5 dark:border-white/5">
                    {preview.header.map((_, j) => (
                      <td key={j} className="max-w-48 truncate px-1 py-0.5">{r[j]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button type="button" className={btnCls} onClick={apply} disabled={busy}>{busy ? "Importiere …" : "Importieren"}</button>
            <button type="button" className={btnGhostCls} onClick={() => setPreview(null)} disabled={busy}>Abbrechen</button>
          </div>
        </div>
      )}
      {msg.error && <p role="alert" className="text-red-700 dark:text-red-400">{msg.error}</p>}
      {msg.ok && <p className="text-green-700 dark:text-green-400">{msg.ok}</p>}
    </div>
  );
}
