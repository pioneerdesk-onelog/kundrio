"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { btnCls, btnGhostCls } from "@/components/ui";
import type { BrandState } from "@/app/(admin)/sa/[slug]/einstellungen/brand-actions";

type FileRow = { id: string; name: string; size: number; mime: string; kind: string; createdAt: string };

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Dokumente hochladen (Drag & Drop), auswählen und auswerten. */
export function BrandUpload({ slug, files, accept, start, remove }: {
  slug: string;
  files: FileRow[];
  accept: string;
  start: (ids: string[]) => Promise<BrandState>;
  remove: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setMsg({});
    const fd = new FormData();
    for (const f of Array.from(list).slice(0, 5)) fd.append("files", f);
    try {
      const res = await fetch(`/sa/${slug}/einstellungen/dateien`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { results?: { name: string; ok: boolean; id?: string; duplicate?: boolean; error?: string }[]; error?: string };
      if (!res.ok && !data.results) throw new Error(data.error ?? `Upload fehlgeschlagen (HTTP ${res.status})`);
      const ok = (data.results ?? []).filter((r) => r.ok);
      const bad = (data.results ?? []).filter((r) => !r.ok);
      setSelected((s) => [...new Set([...s, ...ok.map((r) => r.id!)])]);
      setMsg({
        ok: ok.length ? `${ok.length} Datei(en) hochgeladen${ok.some((r) => r.duplicate) ? " (bereits vorhandene wiederverwendet)" : ""}.` : undefined,
        error: bad.length ? bad.map((r) => r.error).join(" ") : undefined,
      });
      router.refresh();
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <label
        htmlFor="brand-files"
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition ${drag ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-ink-200 dark:border-white/15"}`}
      >
        <Upload size={22} aria-hidden className="text-ink-400" />
        <span className="text-[15px]">{busy ? "Wird hochgeladen …" : "Dateien hierher ziehen oder klicken"}</span>
        <span className="text-xs text-ink-400 dark:text-ink-200">PDF, DOCX, PPTX, SVG, PNG, JPG, TXT – max. 25 MB, bis zu 5 auf einmal</span>
        <input ref={input} id="brand-files" type="file" multiple accept={accept} className="sr-only" onChange={(e) => void upload(e.target.files)} disabled={busy} />
      </label>

      {files.length > 0 && (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100 dark:divide-white/10 dark:border-white/10">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <input
                type="checkbox"
                aria-label={`${f.name} für die Auswertung auswählen`}
                checked={selected.includes(f.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id)))}
              />
              <FileText size={15} aria-hidden className="shrink-0 text-ink-400" />
              <a href={`/sa/${slug}/einstellungen/dateien/${f.id}`} className="min-w-0 flex-1 truncate hover:underline" title={f.name}>
                {f.name}
              </a>
              <span className="shrink-0 text-xs text-ink-400">{fmtSize(f.size)}</span>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-ink-400 hover:text-red-700"
                aria-label={`${f.name} löschen`}
                onClick={() => {
                  if (confirm(`„${f.name}“ endgültig löschen?`)) startTransition(() => remove(f.id).then(() => router.refresh()));
                }}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnCls}
          disabled={!selected.length || pending}
          onClick={() =>
            startTransition(async () => {
              const r = await start(selected);
              setMsg(r);
              router.refresh();
            })
          }
        >
          Ausgewählte auswerten ({selected.length})
        </button>
        {files.length > 0 && (
          <button type="button" className={btnGhostCls} onClick={() => setSelected(files.map((f) => f.id))}>
            Alle auswählen
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {msg.ok && <span className="text-emerald-700 dark:text-emerald-300">{msg.ok} </span>}
        {msg.error && <span className="text-red-700 dark:text-red-300">{msg.error}</span>}
      </p>
    </div>
  );
}
