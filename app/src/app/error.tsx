"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="font-display text-3xl text-ink-900 dark:text-ink-50">Da ist etwas schiefgelaufen</h1>
      <p className="mt-3 text-ink-600 dark:text-ink-200">Die Seite konnte nicht geladen werden. Bitte versuchen Sie es erneut.</p>
      <button onClick={reset} className="mt-6 font-medium text-accent-500 hover:underline dark:text-accent-100">Erneut versuchen</button>
    </main>
  );
}
