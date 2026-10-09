"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { btnCls } from "@/components/ui";
import { researchStatus, startResearch } from "@/app/(admin)/sa/[slug]/erwaehnungen/actions";

const LABEL: Record<string, string> = { queued: "wartet auf den Worker …", running: "recherchiert …", done: "fertig", failed: "fehlgeschlagen" };

/** Startet die Recherche als Job und verfolgt den Status, bis der Worker fertig ist. */
export function ResearchButton({ slug, objectType, objectId }: { slug: string; objectType: "company" | "contact"; objectId: string }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      const s = await researchStatus(slug, jobId);
      setStatus(s.status);
      if (s.status === "done" || s.status === "failed" || s.status === "unbekannt") {
        if (timer.current) clearInterval(timer.current);
        if (s.status === "failed" && s.error) setError(s.error);
        router.refresh();
      }
    };
    timer.current = setInterval(tick, 3000);
    void tick();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [jobId, slug, router]);

  const running = status === "queued" || status === "running";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={btnCls}
        disabled={pending || running}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startResearch(slug, objectType, objectId);
            if (r.error) setError(r.error);
            else if (r.jobId) {
              setStatus("queued");
              setJobId(r.jobId);
            }
          })
        }
      >
        <Search size={16} aria-hidden /> Jetzt recherchieren
      </button>
      <span role="status" aria-live="polite" className="text-sm text-ink-400 dark:text-ink-200">
        {status ? `Recherche: ${LABEL[status] ?? status}` : ""}
      </span>
      {error && (
        <span role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </div>
  );
}
