import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-ink-400">Fehler 404</p>
      <h1 className="mt-2 font-display text-3xl text-ink-900 dark:text-ink-50">Diese Seite gibt es nicht</h1>
      <p className="mt-3 text-ink-600 dark:text-ink-200">Der Link ist veraltet oder die Adresse wurde falsch eingegeben.</p>
      <Link href="/" className="mt-6 inline-block font-medium text-accent-500 hover:underline dark:text-accent-100">Zur Startseite</Link>
    </main>
  );
}
