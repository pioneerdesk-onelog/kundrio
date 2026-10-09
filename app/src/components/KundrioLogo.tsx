// Kundrio-Wortmarke (Produkt). Vorläufig in den Pioneerdesk-Farben, bis eine eigene CI steht.
// Bildmarke: zwei Bögen, die sich zu einem „K“ treffen – Kundin und Unternehmen im Gespräch.
export function KundrioLogo({ className = "h-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 210 48" role="img" aria-label="Kundrio" className={className}>
      <g fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-accent-500 dark:stroke-accent-100">
        <path d="M10 8 V40" />
        <path d="M34 8 C22 14 16 20 12 24 C16 28 22 34 34 40" />
      </g>
      <circle cx="36" cy="24" r="3.5" className="fill-accent-500 dark:fill-accent-100" />
      <text x="50" y="34" fontFamily="var(--font-display)" fontSize="30" fontWeight="600" letterSpacing="-0.5" className="fill-ink-900 dark:fill-ink-50">
        Kundrio
      </text>
    </svg>
  );
}
