import { describe, expect, it } from "vitest";
import { extractJson, parseDraft, parseTranslation } from "./p-draft";
import { applyTexts, collectTexts, safeHref, walkBlocks, withFreshIds, type PageData } from "./p-tree";

const opts = { title: "Webinar", formIds: ["form1"] };

describe("parseDraft", () => {
  it("liest JSON auch mit Codeblock und Vortext", () => {
    expect(extractJson('Hier:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("normalisiert Blöcke, sichert Links und hängt den Fuß an", () => {
    const raw = JSON.stringify({
      seoTitle: "Webinar IT-Sicherheit",
      seoDescription: "Kurz erklärt.",
      blocks: [
        { type: "Text", props: { markdown: "# Große Überschrift\nText" } },
        { type: "Hero", props: { heading: "Sicher in 60 Minuten", buttonLabel: "Anmelden", buttonHref: "javascript:alert(1)" } },
        { type: "Hero", props: { heading: "Zweiter Hero" } },
        { type: "Form", props: { heading: "Anmeldung", formId: "erfunden" } },
        { type: "Form", props: { heading: "Anmeldung", formId: "form1" } },
        { type: "Unbekannt", props: {} },
      ],
    });
    const r = parseDraft(raw, opts);
    const types = r.data.content!.map((b) => b.type);
    expect(types[0]).toBe("Hero");
    expect(types.at(-1)).toBe("Footer");
    expect(types.filter((t) => t === "Hero")).toHaveLength(1);
    expect(types).toContain("Heading"); // zweiter Hero → H2
    expect(r.dropped).toBe(2); // erfundenes Formular + unbekannter Block
    const hero = r.data.content!.find((b) => b.type === "Hero")!;
    expect(hero.props.buttonHref).toBe("#kontakt");
    const text = r.data.content!.find((b) => b.type === "Text")!;
    expect(text.props.markdown).toMatch(/^## Große/);
    expect(new Set(r.data.content!.map((b) => b.props.id)).size).toBe(r.data.content!.length);
  });

  it("übernimmt „Termin buchen“ nur mit existierender Buchungsseite", () => {
    const raw = JSON.stringify({
      blocks: [
        { type: "Hero", props: { heading: "Beratung" } },
        { type: "Text", props: { markdown: "Kostenloses Erstgespräch." } },
        { type: "Booking", props: { heading: "Termin wählen", bookingPath: "/buchen/demo/erstgespraech", mode: "embed" } },
        { type: "Booking", props: { heading: "Erfunden", bookingPath: "/buchen/demo/erfunden" } },
      ],
    });
    const withPaths = parseDraft(raw, { ...opts, bookingPaths: ["/buchen/demo/erstgespraech"] });
    const b = withPaths.data.content!.filter((x) => x.type === "Booking");
    expect(b).toHaveLength(1);
    expect(b[0].props.bookingPath).toBe("/buchen/demo/erstgespraech");
    expect(b[0].props.buttonLabel).toBe("Freie Termine ansehen");
    expect(withPaths.dropped).toBe(1);
    expect(parseDraft(raw, opts).data.content!.some((x) => x.type === "Booking")).toBe(false);
  });

  it("ergänzt einen Hero, wenn keiner geliefert wurde", () => {
    const r = parseDraft(JSON.stringify({ blocks: [{ type: "Text", props: { markdown: "a" } }, { type: "Spacer", props: { size: "s" } }] }), opts);
    expect(r.data.content![0].type).toBe("Hero");
    expect(r.data.content![0].props.heading).toBe("Webinar");
  });

  it("lehnt Unbrauchbares ab", () => {
    expect(() => parseDraft("keine Ahnung", opts)).toThrow();
    expect(() => parseDraft(JSON.stringify({ blocks: [] }), opts)).toThrow();
  });
});

describe("Übersetzung", () => {
  const data: PageData = {
    root: { props: { title: "T" } },
    content: [
      { type: "Hero", props: { id: "1", heading: "Hallo", buttonHref: "https://x.de", align: "left" } },
      { type: "Section", props: { id: "2", background: "sand", content: [{ type: "FAQ", props: { id: "3", items: [{ question: "Was?", answer: "Das." }] } }] } },
    ],
  };
  it("sammelt nur Texte, keine Links/IDs/Auswahlwerte, auch in Slots", () => {
    expect(collectTexts(data).map((i) => i.value)).toEqual(["Hallo", "Was?", "Das."]);
  });
  it("setzt Übersetzungen ein, ohne das Original zu ändern", () => {
    const items = collectTexts(data);
    const out = applyTexts(data, items, ["Hello", "What?", "This."]);
    expect(collectTexts(out).map((i) => i.value)).toEqual(["Hello", "What?", "This."]);
    expect(collectTexts(data)[0].value).toBe("Hallo");
    expect(walkBlocks(out)[0].props.buttonHref).toBe("https://x.de");
  });
  it("prüft Länge und Typ der Antwort", () => {
    expect(parseTranslation('```json\n["a","b"]\n```', 2)).toEqual(["a", "b"]);
    expect(() => parseTranslation('["a"]', 2)).toThrow();
    expect(() => parseTranslation('["a", 3]', 2)).toThrow();
  });
  it("vergibt frische IDs", () => {
    const f = withFreshIds(data);
    expect(walkBlocks(f).map((b) => b.props.id)).not.toContain("1");
  });
});

describe("safeHref", () => {
  it("lässt nur sichere Ziele zu", () => {
    for (const ok of ["https://a.de", "/pfad", "#kontakt", "mailto:a@b.de", "tel:+49123"]) expect(safeHref(ok)).toBe(ok);
    for (const bad of ["javascript:alert(1)", "//evil.com", "data:text/html,x", "", "  ", 42]) expect(safeHref(bad)).toBeNull();
  });
});
