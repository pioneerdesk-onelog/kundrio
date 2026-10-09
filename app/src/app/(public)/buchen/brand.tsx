import type { Workspace } from "@prisma/client";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Primärfarbe des Sub-Accounts plus lesbare Textfarbe darauf (WCAG-Kontrast grob über Luminanz). */
export function brandVars(ws: Pick<Workspace, "brandPrimary">): React.CSSProperties {
  const primary = HEX.test(ws.brandPrimary) ? ws.brandPrimary : "#0B4F6C";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(primary.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { "--bk-primary": primary, "--bk-on-primary": lum > 0.4 ? "#111827" : "#ffffff" } as React.CSSProperties;
}

export function BrandHeader({ ws }: { ws: Pick<Workspace, "name" | "legalName" | "logoSvg" | "brandPrimary"> }) {
  const name = ws.legalName ?? ws.name;
  return ws.logoSvg ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={name} className="mb-4 h-10" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(ws.logoSvg)}`} />
  ) : (
    <div className="mb-4 text-xl font-semibold" style={{ color: ws.brandPrimary }}>
      {name}
    </div>
  );
}
