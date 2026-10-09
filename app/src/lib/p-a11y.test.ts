import { describe, expect, it } from "vitest";
import { checkPage, contrastRatio, headingOutline, onColor } from "./p-a11y";
import type { PageData } from "./p-tree";

const ctx = { brandPrimary: "#0B4F6C", brandAccent: "#C0D3DA", forms: { f1: { fieldCount: 3 }, leer: { fieldCount: 0 } } };
const hero = (heading = "Titel", extra: Record<string, unknown> = {}) => ({ type: "Hero", props: { id: "h", heading, buttonLabel: "", buttonHref: "", ...extra } });
const page = (...content: { type: string; props: Record<string, unknown> }[]): PageData => ({ root: { props: {} }, content });
const rules = (r: ReturnType<typeof checkPage>, level?: "error" | "warning") => r.issues.filter((i) => !level || i.level === level).map((i) => i.rule);

describe("Kontrast", () => {
  it("rechnet nach WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("kaputt", "#fff")).toBeNull();
  });
  it("wählt lesbare Textfarbe", () => {
    expect(onColor("#0B4F6C")).toBe("#ffffff");
    expect(onColor("#F6E7DE")).toBe("#0e141b");
  });
});

describe("Überschriften", () => {
  it("baut die Gliederung inkl. Markdown", () => {
    const o = headingOutline(page(hero("A"), { type: "Text", props: { markdown: "## B\ntext\n### C" } }));
    expect(o.map((h) => h.level)).toEqual([1, 2, 3]);
  });
  it("verlangt genau eine H1", () => {
    expect(rules(checkPage(page({ type: "Heading", props: { text: "x", level: "2" } }), ctx), "error")).toContain("h1");
    expect(rules(checkPage(page(hero(), hero("Zwei")), ctx), "error")).toContain("h1");
    expect(checkPage(page(hero()), ctx).ok).toBe(true);
  });
  it("erkennt übersprungene Ebenen, auch verschachtelt in Slots", () => {
    const nested = page(hero(), { type: "Section", props: { id: "s", content: [{ type: "Heading", props: { id: "x", text: "Tief", level: "3" } }] } });
    expect(rules(checkPage(nested, ctx), "error")).toContain("ueberschriften");
  });
});

describe("Bilder, Links, Formulare", () => {
  it("fordert Alternativtext außer bei dekorativen Bildern", () => {
    const img = (p: Record<string, unknown>) => ({ type: "Image", props: { id: "i", src: "/bild.png", alt: "", decorative: "no", ...p } });
    expect(rules(checkPage(page(hero(), img({})), ctx), "error")).toContain("bild-alt");
    expect(rules(checkPage(page(hero(), img({ decorative: "yes" })), ctx), "error")).not.toContain("bild-alt");
    expect(rules(checkPage(page(hero(), img({ alt: "Bild" })), ctx), "warning")).toContain("bild-alt");
    expect(rules(checkPage(page(hero(), img({ src: "http://x.de/a.png", alt: "Team" })), ctx), "error")).toContain("bild-quelle");
    expect(rules(checkPage(page(hero(), img({ src: "https://x.de/a.png", alt: "Team" })), ctx), "warning")).toContain("bild-extern");
  });
  it("prüft Buttontexte und Ziele", () => {
    expect(rules(checkPage(page(hero("T", { buttonLabel: "Hier klicken", buttonHref: "#k" })), ctx), "warning")).toContain("link-text");
    expect(rules(checkPage(page(hero("T", { buttonLabel: "Los", buttonHref: "javascript:alert(1)" })), ctx), "error")).toContain("link-ziel");
    expect(rules(checkPage(page(hero("T", { buttonLabel: "", buttonHref: "/x" })), ctx), "error")).toContain("link-text");
    expect(checkPage(page(hero("T", { buttonLabel: "Termin buchen", buttonHref: "https://example.com" })), ctx).ok).toBe(true);
  });
  it("prüft das gewählte Formular", () => {
    const form = (formId: string) => ({ type: "Form", props: { id: "f", heading: "", formId } });
    expect(rules(checkPage(page(hero(), form("")), ctx), "error")).toContain("formular");
    expect(rules(checkPage(page(hero(), form("gibtsnicht")), ctx), "error")).toContain("formular");
    expect(rules(checkPage(page(hero(), form("leer")), ctx), "error")).toContain("formular");
    expect(checkPage(page(hero(), form("f1")), ctx).ok).toBe(true);
  });
  it("prüft den Block „Termin buchen“", () => {
    const bctx = { ...ctx, bookingPaths: ["/buchen/demo/erstgespraech"] };
    const booking = (extra: Record<string, unknown>) => ({ type: "Booking", props: { id: "b", heading: "Termin buchen", text: "", bookingPath: "/buchen/demo/erstgespraech", mode: "button", buttonLabel: "Freie Termine ansehen", ...extra } });
    expect(checkPage(page(hero(), booking({})), bctx).ok).toBe(true);
    expect(headingOutline(page(hero(), booking({}))).map((h) => h.level)).toEqual([1, 2]);
    expect(rules(checkPage(page(hero(), booking({ bookingPath: "" })), bctx), "error")).toContain("buchung");
    expect(rules(checkPage(page(hero(), booking({ bookingPath: "https://evil.example" })), bctx), "error")).toContain("buchung");
    expect(rules(checkPage(page(hero(), booking({ bookingPath: "/buchen/demo/gibt-es-nicht" })), bctx), "error")).toContain("buchung");
    expect(rules(checkPage(page(hero(), booking({ buttonLabel: "Hier klicken" })), bctx), "warning")).toContain("link-text");
    expect(rules(checkPage(page(hero(), booking({ mode: "embed", heading: "" })), bctx), "warning")).toContain("buchung");
  });
  it("warnt bei blassen Markenfarben und blockiert ungültige", () => {
    // Auf Buttons wird automatisch dunkle Schrift gewählt (ok), als Akzent auf Weiß ist die Farbe aber zu blass
    const pale = checkPage(page(hero()), { ...ctx, brandPrimary: "#88AACC" });
    expect(pale.ok).toBe(true);
    expect(rules(pale, "warning")).toContain("kontrast");
    expect(rules(checkPage(page(hero()), { ...ctx, brandPrimary: "kaputt" }), "error")).toContain("kontrast");
  });
});
