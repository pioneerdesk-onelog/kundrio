import type { PlatformInfo } from "@/lib/channels/config";

// Verständlicher Einrichtungshinweis, wenn eine Plattform-Schnittstelle (noch) nicht konfiguriert ist.
export function PlatformSetup({ info, showLimits = true }: { info: PlatformInfo; showLimits?: boolean }) {
  return (
    <details className="rounded-md border border-ink-100 bg-sand-50 p-3 text-sm dark:border-white/10 dark:bg-white/5">
      <summary className="cursor-pointer font-medium">
        {info.mode === "import" ? "Nur manuell oder per Export-Import" : info.configured ? "Hinweise zur Schnittstelle" : "Schnittstelle einrichten (Admin)"}
      </summary>
      {info.setup.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {info.setup.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {info.scopes.length > 0 && (
        <p className="mt-2 text-xs text-ink-400 dark:text-ink-200">
          Angefragte Berechtigungen (nur lesend genutzt): <code>{info.scopes.join(", ")}</code>
        </p>
      )}
      {showLimits && info.limits.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-400 dark:text-ink-200">
          {info.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
