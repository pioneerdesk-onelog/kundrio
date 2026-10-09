import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./svg-sanitize";

describe("sanitizeSvg", () => {
  it("behält einfache Formen und viewBox", () => {
    const out = sanitizeSvg('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" fill="#0B4F6C"/></svg>');
    expect(out).toContain('viewBox="0 0 10 10"');
    expect(out).toContain("<circle");
  });
  it("entfernt Skripte, Event-Handler und foreignObject", () => {
    const out = sanitizeSvg('<svg onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><rect onclick="x()" width="1" height="1"/></svg>');
    expect(out).not.toMatch(/script|onload|onclick|foreignObject|<div/i);
    expect(out).toContain("<rect");
  });
  it("entfernt externe Referenzen, behält interne", () => {
    const out = sanitizeSvg('<svg><use href="https://evil.example/x.svg#a"/><use href="#ok"/><rect fill="url(https://evil/x)" width="1" height="1"/><rect fill="url(#g)" width="1" height="1"/></svg>');
    expect(out).not.toContain("evil");
    expect(out).toContain('href="#ok"');
    expect(out).toContain('fill="url(#g)"');
  });
  it("lehnt Nicht-SVG ab", () => {
    expect(() => sanitizeSvg("<div>hallo</div>")).toThrow();
  });
  it("entfernt javascript:-URLs", () => {
    expect(sanitizeSvg('<svg><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>')).not.toContain("javascript");
  });
});
