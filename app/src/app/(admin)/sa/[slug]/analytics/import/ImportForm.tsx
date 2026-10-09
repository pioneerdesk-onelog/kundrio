"use client";

import { useState } from "react";
import { btnCls, inputCls, labelCls } from "@/components/ui";

type Result = { error?: string; mode?: string; lines?: number; imported?: number; duplicates?: number; ignored?: number; invalid?: number; queued?: number };

export function ImportForm({ slug }: { slug: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("ws", slug);
      const res = await fetch("/api/a/import", { method: "POST", body: fd });
      setResult((await res.json()) as Result);
    } catch {
      setResult({ error: "Upload fehlgeschlagen." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className={labelCls}>Access-Log (nginx/Apache „combined“ oder Caddy-JSON, max. 20 MB)</span>
        <input type="file" name="file" accept=".log,.txt,.json,text/plain" required className={inputCls} />
      </label>
      <button className={btnCls} disabled={pending}>{pending ? "Importiere …" : "Importieren"}</button>
      <div aria-live="polite">
        {result?.error && <p role="alert" className="text-red-700 dark:text-red-300">{result.error}</p>}
        {result && !result.error && result.mode === "direkt" && (
          <p className="text-emerald-800 dark:text-emerald-200">
            {result.imported} Einträge importiert ({result.lines} Zeilen gelesen, {result.duplicates} bereits vorhanden, {result.ignored} nicht relevant,{" "}
            {result.invalid} nicht lesbar).
          </p>
        )}
        {result && !result.error && result.mode === "hintergrund" && (
          <p className="text-emerald-800 dark:text-emerald-200">
            Große Datei: in {result.queued} Teilen zur Verarbeitung eingereiht. Der Hintergrund-Worker (<code>npm run worker</code>) importiert sie.
          </p>
        )}
      </div>
    </form>
  );
}
