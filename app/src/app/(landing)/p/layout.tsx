// Landingpages: randlos, eigenes Branding je Sub-Account (Theme in den Blöcken).
export default function LandingLayout({ children }: { children: React.ReactNode }) {
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
