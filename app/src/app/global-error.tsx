"use client";

// Letzte Rückfallebene, wenn selbst das Grundlayout nicht lädt – daher ohne App-Styles.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="de">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "6rem 1.5rem" }}>
        <h1>Da ist etwas schiefgelaufen</h1>
        <p>Kundrio konnte nicht geladen werden. Bitte versuchen Sie es erneut.</p>
        <button onClick={reset}>Erneut versuchen</button>
      </body>
    </html>
  );
}
