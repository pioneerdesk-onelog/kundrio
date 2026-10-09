import { describe, expect, it } from "vitest";
import { cmykToHex, findColors, findFonts, findSpotColors, normalizeHex } from "./colors";
import { analyzeCss, findLogoCandidates, pickBrandColors, stylesheetLinks } from "./css";
import { parseAiGuide, selectSections } from "./ai-parse";
import { suggestionsFromAi, suggestionsFromText } from "./derive";
import { brandGuideSchema, matchAppFont, parseGuide } from "./guide";
import { voiceFromGuide } from "./voice-text";

describe("Farberkennung", () => {
  it("findet HEX (6/3-stellig), rgb(), „RGB a b c“ und zählt", () => {
    const text = "Primärfarbe Petrol: #0B4F6C\nAkzent Orange #f2913a\nWeiß #FFF\nnochmal #0b4f6c\nRGB 11 79 108\nrgb(242, 145, 58)";
    const c = findColors(text);
    expect(c[0]).toMatchObject({ hex: "#0b4f6c", count: 3 }); // HEX zweimal + RGB 11/79/108
    expect(c.find((x) => x.hex === "#f2913a")?.count).toBe(2);
    expect(c.find((x) => x.hex === "#ffffff")).toBeTruthy();
    expect(c.find((x) => x.hex === "#0b4f6c")?.label).toMatch(/Petrol/);
  });
  it("rechnet CMYK näherungsweise um und markiert es", () => {
    expect(cmykToHex(0, 0, 0, 0)).toBe("#ffffff");
    expect(cmykToHex(0, 0, 0, 100)).toBe("#000000");
    expect(cmykToHex(100, 0, 0, 0)).toBe("#00ffff");
    const c = findColors("Hausfarbe Blau CMYK 90 / 30 / 0 / 40");
    expect(c[0].kind).toBe("cmyk");
    expect(c[0].approx).toBe(true);
    expect(c[0].hex).toBe(cmykToHex(90, 30, 0, 40));
  });
  it("ignoriert ungültige Werte", () => {
    expect(findColors("RGB 300 20 20 · CMYK 120 0 0 0 · #12345g")).toEqual([]);
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("xyz")).toBeNull();
  });
  it("findet Sonderfarben und Schriften", () => {
    expect(findSpotColors("Pantone 7708 C und HKS 44 K sowie RAL 5010")).toEqual(["Pantone 7708 C", "HKS 44 K", "RAL 5010"]);
    const fonts = findFonts("Hausschrift: Source Sans\nÜberschriften in Montserrat. Montserrat Bold für Headlines.");
    expect(fonts[0]).toBe("Montserrat");
    expect(fonts).toContain("Source Sans");
  });
});

describe("Website-CSS", () => {
  const css = `:root{--brand-primary:#0b4f6c;--color-accent: #f2913a;--text-color:#333333;--bg:#ffffff}
    body{font-family:"Inter",system-ui,sans-serif;color:#333}
    h1,h2{font-family:'Newsreader',serif}
    .btn{background:#0b4f6c}.btn:hover{background:#08405a}.badge{color:rgb(242,145,58)}`;
  it("liest Variablen, zählt Farben, erkennt Schriften", () => {
    const a = analyzeCss(css, '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Lato&display=swap" rel="stylesheet">');
    expect(a.variables.find((v) => v.name === "--brand-primary")?.hex).toBe("#0b4f6c");
    expect(a.colors[0].hex).toBe("#0b4f6c");
    expect(a.fonts).toEqual(["Inter", "Newsreader"]);
    expect(a.googleFonts).toContain("Inter");
  });
  it("wählt Primär-/Akzentfarbe aus Variablen, sonst aus Häufigkeit (ohne Grau/Weiß)", () => {
    const p = pickBrandColors(analyzeCss(css));
    expect(p.primary).toBe("#0b4f6c");
    expect(p.accent).toBe("#f2913a");
    expect(p.reason.primary).toMatch(/Variable/);
    const noVars = pickBrandColors(analyzeCss("a{color:#cc0000}b{color:#cc0000}i{color:#eeeeee}u{color:#0055aa}"));
    expect(noVars.primary).toBe("#cc0000");
    expect(noVars.accent).toBe("#0055aa");
  });
  it("findet Logo-Kandidaten und Stylesheets", () => {
    const html = `<header><a class="site-logo" href="/"><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg></a></header>
      <img src="/img/logo.png" alt="Firma Logo"><meta property="og:image" content="https://x.example/og.jpg">
      <link rel="stylesheet" href="/css/main.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`;
    const c = findLogoCandidates(html, "https://firma.example/");
    expect(c[0].kind).toBe("inline-svg");
    expect(c.find((x) => x.kind === "img")?.src).toBe("https://firma.example/img/logo.png");
    expect(c.find((x) => x.kind === "og-image")).toBeTruthy();
    expect(stylesheetLinks(html, "https://firma.example/")).toEqual(["https://firma.example/css/main.css"]);
  });
});

describe("Vorschläge aus Brandbook-Text", () => {
  it("leitet Farben, Primär/Akzent, Schriften ab – mit Quelle", () => {
    const s = suggestionsFromText([{ source: "CI.pdf · Seite 3", text: "Primärfarbe Petrol #0B4F6C\nAkzentfarbe Orange #F2913A\nGrau #6B7280\nHausschrift: Source Sans" }], "brandbook", "CI.pdf");
    const primary = s.find((x) => x.field === "brandPrimary")!;
    expect((primary.value as { hex: string }).hex).toBe("#0B4F6C");
    expect(primary.confidence).toBeGreaterThan(0.8);
    expect((s.find((x) => x.field === "brandAccent")!.value as { hex: string }).hex).toBe("#F2913A");
    const pal = s.find((x) => x.field === "guide.colors")!.value as { data: { hex: string; role: string }[] };
    expect(pal.data.find((c) => c.hex === "#6b7280")?.role).toBe("neutral");
    expect(s.find((x) => x.field === "fontHeading")).toBeTruthy();
    expect(s.every((x) => x.sourceUrl === "CI.pdf")).toBe(true);
  });
  it("liefert nichts, wenn nichts gefunden wird", () => {
    expect(suggestionsFromText([{ source: "a", text: "Ein Text ohne Farben." }], "brandbook", "a")).toEqual([]);
  });
});

describe("KI-Ausgabe (strenges JSON)", () => {
  const raw = `Hier: {"voice":{"summary":"Klar und nahbar.","adjectives":["klar"],"sources":["CI.pdf · Seite 2","erfunden.pdf"]},
    "do":[{"text":"Kurze Sätze","source":"CI.pdf · Seite 2"},{"text":"Erfunden","source":"gibtsnicht"}],"dont":[],"audience":[],
    "writingRules":{"address":"sie","gender":null,"terms":["OneLog"],"notes":[]},"logoRules":[]}`;
  it("verwirft Aussagen mit erfundenen Quellen", () => {
    const g = parseAiGuide(raw, ["CI.pdf · Seite 2"]);
    expect(g.do).toEqual([{ text: "Kurze Sätze", source: "CI.pdf · Seite 2" }]);
    expect(g.voice?.sources).toEqual(["CI.pdf · Seite 2"]);
    const s = suggestionsFromAi(g, "brandbook", "CI.pdf");
    expect(s.map((x) => x.field).sort()).toEqual(["guide.doAndDont", "guide.voice", "guide.writingRules"]);
  });
  it("wirft bei kaputtem JSON", () => {
    expect(() => parseAiGuide("kein json", [])).toThrow();
    expect(() => parseAiGuide('{"voice":5}', [])).toThrow();
  });
  it("wählt relevante Abschnitte zuerst und begrenzt die Länge", () => {
    const secs = [{ source: "a", text: "Impressum und Kontakt" }, { source: "b", text: "Unsere Markenstimme und Tonalität: Sie-Anrede" }, { source: "c", text: "x".repeat(20_000) }];
    const out = selectSections(secs, 5000);
    expect(out[0].source).toBe("b");
    expect(out.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(5000);
  });
});

describe("Leitfaden & Markenstimme", () => {
  it("ordnet App-Schriften zu", () => {
    expect(matchAppFont("Inter")).toBe("Inter");
    expect(matchAppFont("Newsreader Variable")).toBe("Newsreader");
    expect(matchAppFont("Montserrat")).toBeNull();
  });
  it("parseGuide ist tolerant, Schema prüft Farben", () => {
    expect(parseGuide(null)).toEqual({});
    expect(brandGuideSchema.safeParse({ colors: [{ hex: "rot" }] }).success).toBe(false);
  });
  it("baut einen kurzen Stil-Hinweis", () => {
    const v = voiceFromGuide({
      voice: { summary: "Sachlich und freundlich.", adjectives: ["klar"], sources: [] },
      writingRules: { address: "sie", terms: ["E-Mail"], notes: [] },
      doAndDont: { do: [{ text: "Aktiv formulieren", source: "x" }], dont: [{ text: "Anglizismen", source: "x" }] },
    })!;
    expect(v).toMatch(/Anrede: Sie/);
    expect(v).toMatch(/Vermeiden: Anglizismen/);
    expect(voiceFromGuide({})).toBeNull();
  });
});

describe("Website-CSS – Sonderfälle (aus Probeabruf)", () => {
  it("ignoriert Emoji-/Mono-Fallbacks und löst var() sowie next/font-Namen auf", () => {
    const a = analyzeCss(`:root{--font-sans:'__Inter_a1b2c3','__Inter_Fallback_a1b2c3';--font-head:"Montserrat",sans-serif}
      body{font-family:var(--font-sans),"Apple Color Emoji"}h1{font-family:var(--font-head)}code{font-family:SFMono-Regular,Menlo,monospace}
      .e{font-family:"Apple Color Emoji","Segoe UI Emoji"}`);
    expect(a.fonts).toEqual(["Inter", "Montserrat"]);
  });
  it("wählt keine fast schwarzen Hintergrundfarben als Akzent", () => {
    const p = pickBrandColors(analyzeCss("a{background:#1a1f2e}b{background:#1a1f2e}c{background:#1a1f2e}d{color:#0e7490}e{color:#f2913a}"));
    expect(p.primary).toBe("#0e7490");
    expect(p.accent).toBe("#f2913a");
  });
});

describe("Schriftlisten mit verschachtelten var()-Fallbacks", () => {
  it("teilt klammerbewusst und löst Tailwind-v4-Muster auf", () => {
    const a = analyzeCss(`:root{--default-font-family:var(--font-sans);--font-sans:ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji"}
      html{font-family:var(--default-font-family,ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji")}
      .brand{font-family:var(--font-brand, "Source Sans 3", Arial, sans-serif)}`);
    expect(a.fonts).toEqual(["Source Sans 3"]);
  });
});

describe("Lange CSS-Variablen", () => {
  it("schneidet Schriftlisten in Variablen nicht ab", () => {
    const a = analyzeCss(`:root{--font-sans:ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji"}body{font-family:var(--font-sans)}`);
    expect(a.fonts).toEqual([]);
  });
});
