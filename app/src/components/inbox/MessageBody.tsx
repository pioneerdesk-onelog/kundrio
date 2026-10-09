import Link from "next/link";
import { sanitizeEmailHtml } from "@/lib/inbox/sanitize";

/**
 * Nachrichteninhalt: HTML nur bereinigt und zusätzlich in einem abgeschotteten iframe (sandbox ohne
 * Skripte, ohne gleiche Herkunft). Externe Bilder sind blockiert, bis „Bilder laden“ gewählt wird.
 */
export function MessageBody({ text, html, showImages, imagesHref }: { text: string; html: string | null; showImages: boolean; imagesHref: string }) {
  if (!html) {
    return <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{text}</div>;
  }
  const clean = sanitizeEmailHtml(html, { allowRemoteImages: showImages });
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font:15px/1.55 system-ui,sans-serif;color:#1f2a37;margin:0;padding:4px;word-wrap:break-word}img{max-width:100%;height:auto}[data-pd-blocked]{display:inline-block;padding:2px 6px;border:1px dashed #ced4da;color:#5f6b78;font-size:12px}[data-pd-blocked]::before{content:"Bild blockiert"}table{max-width:100%}</style></head><body>${clean.html}</body></html>`;
  return (
    <div>
      {(clean.blockedImages > 0 || clean.trackingPixels > 0) && (
        <p className="mb-2 text-sm text-ink-400 dark:text-ink-200">
          {clean.blockedImages > 0 && <>{clean.blockedImages} externe(s) Bild(er) blockiert (Datenschutz). <Link className="underline" href={imagesHref}>Bilder laden</Link>. </>}
          {clean.trackingPixels > 0 && <>{clean.trackingPixels} Zählpixel entfernt.</>}
        </p>
      )}
      <iframe
        title="Nachrichteninhalt"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        className="h-[420px] w-full rounded-md border border-ink-100 bg-white dark:border-white/10"
      />
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-400 dark:text-ink-200">Textfassung</summary>
        <div className="mt-1 whitespace-pre-wrap break-words">{text}</div>
      </details>
    </div>
  );
}
