// Landingpages auf eigenen Kundendomains (über src/middleware.ts umgeschrieben) – gleiche Darstellung wie /p.
export default function DomainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Ohne JavaScript bleiben animierte Blöcke sonst unsichtbar (Motion rendert serverseitig opacity:0) */}
      <noscript>
        <style>{`[data-anim]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      {children}
    </>
  );
}
