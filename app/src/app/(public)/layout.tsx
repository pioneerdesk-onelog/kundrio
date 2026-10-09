// Öffentliche Seiten (Formular, DOI, Abmeldung): ohne Navigation, ohne interne Daten.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen px-4 py-10">{children}</div>;
}
