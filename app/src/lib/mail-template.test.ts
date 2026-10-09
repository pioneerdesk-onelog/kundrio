import { describe, expect, it } from "vitest";
import { htmlToPlainText, renderTemplate } from "./mail-template";

describe("renderTemplate", () => {
  it("ersetzt params und contact, auch verschachtelt und mit Leerzeichen", () => {
    const out = renderTemplate("Hallo {{params.name}} / {{ params.order.id }} / {{ contact.FIRSTNAME }}", { params: { name: "Erika", order: { id: 42 } }, contact: { FIRSTNAME: "E." } }, { html: false });
    expect(out).toBe("Hallo Erika / 42 / E.");
  });

  it("escaped Werte im HTML, nicht im Text", () => {
    const ctx = { params: { name: '<script>alert("x")</script>&' } };
    expect(renderTemplate("<p>{{ params.name }}</p>", ctx, { html: true })).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;</p>");
    expect(renderTemplate("{{ params.name }}", ctx, { html: false })).toBe('<script>alert("x")</script>&');
  });

  it("nutzt default bei leeren/fehlenden Werten", () => {
    expect(renderTemplate('Hi {{ params.name | default: "Gast" }}', { params: {} }, { html: true })).toBe("Hi Gast");
    expect(renderTemplate("Hi {{ params.name | default: 'Gast' }}", { params: { name: "" } }, { html: true })).toBe("Hi Gast");
  });

  it("gibt unbekannte Platzhalter leer aus und führt keinen Code aus", () => {
    expect(renderTemplate("[{{ params.x }}][{{ params.__proto__.polluted }}][{{ params.constructor }}]", { params: {} }, { html: true })).toBe("[][][]");
    expect(renderTemplate("{{ 7*7 }} {% if x %}", { params: {} }, { html: true })).toBe("{{ 7*7 }} {% if x %}");
  });

  it("gibt Objekte nicht aus", () => {
    expect(renderTemplate("{{ params.obj }}", { params: { obj: { a: 1 } } }, { html: false })).toBe("");
  });
});

describe("htmlToPlainText", () => {
  it("wandelt Absätze, Umbrüche und Links um", () => {
    const t = htmlToPlainText('<h2>Titel</h2><p>Zeile&nbsp;1<br>Zeile 2</p><p><a href="https://x.de/a">Klick</a></p><style>p{}</style>');
    expect(t).toBe("Titel\nZeile 1\nZeile 2\nKlick (https://x.de/a)");
  });
});
