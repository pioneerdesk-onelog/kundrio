import { describe, expect, it } from "vitest";
import { clipSnippet, companyNameVariants, dedupeHits, isSameSite, normalizeUrl, stripLegalForm, titleSimilarity } from "./names";
import { containsPhrase, heuristicMatch } from "./match";
import { discoverFeeds, extractArticleLinks, findNewsPages, parseFeed, parseGdelt, parseGdeltDate, parseSearxng } from "./parsers";
import { parseAnalysis } from "./analyze-schema";
import { decideStatus } from "./status";
import { searchTerms } from "./query";
import type { RawHit, ResearchEntity } from "./types";

const company: ResearchEntity = { kind: "company", companyName: "Muster Maschinenbau GmbH & Co. KG", domain: "muster-maschinenbau.example", city: "Augsburg", industry: "Maschinenbau" };

describe("Namen & URLs", () => {
  it("entfernt Rechtsformen, auch verschachtelt", () => {
    expect(stripLegalForm("Muster Maschinenbau GmbH & Co. KG")).toBe("Muster Maschinenbau");
    expect(stripLegalForm("Beispiel UG (haftungsbeschränkt)")).toBe("Beispiel");
    expect(stripLegalForm("Pioneerdesk GmbH")).toBe("Pioneerdesk");
    expect(stripLegalForm("OneLog")).toBe("OneLog");
  });
  it("liefert Varianten ohne Dubletten und ohne zu kurze Namen", () => {
    expect(companyNameVariants("Pioneerdesk GmbH")).toEqual(["Pioneerdesk GmbH", "Pioneerdesk"]);
    expect(companyNameVariants("AB AG")).toEqual(["AB AG"]);
    expect(companyNameVariants("")).toEqual([]);
  });
  it("normalisiert URLs (Tracking, www, Fragment, Slash)", () => {
    expect(normalizeUrl("http://www.Example.com/news/artikel/?utm_source=x&b=2&a=1#top")).toBe("https://example.com/news/artikel?a=1&b=2");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("ftp://example.com/x")).toBeNull();
    expect(normalizeUrl("kein link")).toBeNull();
  });
  it("erkennt Subdomains als eigene Website", () => {
    expect(isSameSite("presse.muster-maschinenbau.example", "muster-maschinenbau.example")).toBe(true);
    expect(isSameSite("muster-maschinenbau.example.evil.com", "muster-maschinenbau.example")).toBe(false);
  });
  it("kürzt Auszüge (Urheberrecht) auf ≤ 300 Zeichen", () => {
    const s = clipSnippet("Wort ".repeat(200))!;
    expect(s.length).toBeLessThanOrEqual(300);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("Entdoppeln", () => {
  const h = (url: string, title: string, kind: RawHit["sourceKind"], date?: string): RawHit => ({ url, title, sourceKind: kind, publishedAt: date ? new Date(date) : null });
  it("fasst gleiche URL und sehr ähnliche Titel zusammen, bevorzugt Treffer mit Datum", () => {
    const out = dedupeHits([
      h("https://news.example/a?utm_source=x", "Muster Maschinenbau erhält Großauftrag aus Bayern", "searxng"),
      h("https://news.example/a", "Muster Maschinenbau erhält Großauftrag aus Bayern", "gdelt", "2026-10-01"),
      h("https://other.example/b", "Muster Maschinenbau erhält Großauftrag aus Bayern!", "gdelt"),
      h("https://other.example/c", "Ganz anderes Thema: Messe in Köln", "gdelt"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].publishedAt?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(titleSimilarity("Muster erhält Auftrag", "Muster erhält Auftrag")).toBe(1);
  });
});

describe("Verwechslungsschutz", () => {
  it("Wortgrenzen: OneLog ≠ Onelogistics", () => {
    expect(containsPhrase("Neues von OneLog heute", "OneLog")).toBe(true);
    expect(containsPhrase("Onelogistics expandiert", "OneLog")).toBe(false);
  });
  it("voller Name + Ort ergibt hohe Sicherheit, fremder Text niedrige", () => {
    const strong = heuristicMatch({ url: "https://zeitung.example/x", title: "Muster Maschinenbau GmbH & Co. KG baut in Augsburg aus", sourceKind: "gdelt" }, company);
    expect(strong.score).toBeGreaterThanOrEqual(0.6);
    const none = heuristicMatch({ url: "https://zeitung.example/y", title: "Wetter in Berlin", sourceKind: "gdelt" }, company);
    expect(none.score).toBeLessThan(0.2);
  });
  it("kurzer, mehrdeutiger Name zählt wenig", () => {
    const e: ResearchEntity = { kind: "company", companyName: "Atlas AG", domain: null };
    const m = heuristicMatch({ url: "https://x.example", title: "Atlas startet neue Rakete", sourceKind: "searxng" }, e);
    expect(m.score).toBeLessThan(0.5);
  });
  it("erkennt die eigene Website", () => {
    const m = heuristicMatch({ url: "https://www.muster-maschinenbau.example/presse/1", title: "Pressemitteilung", sourceKind: "searxng" }, company);
    expect(m.ownSite).toBe(true);
  });
  it("Personen-Suche nur mit Firma (beruflicher Bezug)", () => {
    expect(searchTerms({ kind: "contact", personName: "Erika Muster", companyName: null, domain: null })).toEqual([]);
    expect(searchTerms({ kind: "contact", personName: "Erika Muster", companyName: "Muster GmbH", domain: null })).toEqual(['"Erika Muster" "Muster"']);
    expect(searchTerms(company)).toEqual(['"Muster Maschinenbau GmbH & Co. KG"', '"Muster Maschinenbau"']);
  });
});

describe("Parser", () => {
  it("GDELT artlist JSON", () => {
    const hits = parseGdelt({
      articles: [
        { url: "https://www.handelsblatt.example/a", title: "Muster Maschinenbau übernimmt Wettbewerber", seendate: "20261005T081500Z", domain: "handelsblatt.example", language: "German", sourcecountry: "Germany" },
        { url: "", title: "kaputt" },
        { title: "ohne url" },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceKind: "gdelt", language: "de", sourceHost: "handelsblatt.example" });
    expect(hits[0].publishedAt?.toISOString()).toBe("2026-10-05T08:15:00.000Z");
    expect(parseGdelt("Your query was too short")).toEqual([]);
    expect(parseGdeltDate("kaputt")).toBeNull();
  });
  it("SearXNG JSON", () => {
    const hits = parseSearxng({
      results: [
        { url: "https://news.example/x", title: "Muster Maschinenbau mit Rekordjahr", content: "Der Augsburger Hersteller …", publishedDate: "2026-09-30T10:00:00" },
        { url: "javascript:alert(1)", title: "böse" },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain("Augsburger");
    expect(hits[0].publishedAt?.getUTCFullYear()).toBe(2026);
  });
  it("RSS 2.0 mit CDATA und relativen Links", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Presse</title>
      <item><title><![CDATA[Muster & Partner: Neue Halle]]></title><link>/presse/neue-halle</link><pubDate>Mon, 05 Oct 2026 09:00:00 +0200</pubDate><description><![CDATA[<p>Wir eröffnen&nbsp;eine Halle.</p>]]></description></item>
      <item><title>Ohne Link</title></item></channel></rss>`;
    const hits = parseFeed(xml, "https://muster-maschinenbau.example/feed");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: "Muster & Partner: Neue Halle", url: "https://muster-maschinenbau.example/presse/neue-halle", sourceKind: "rss" });
    expect(hits[0].snippet).toBe("Wir eröffnen eine Halle.");
  });
  it("Atom", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Auszeichnung erhalten</title><link rel="alternate" href="https://muster.example/news/preis"/><published>2026-09-01T08:00:00Z</published><summary>Preis für Innovation</summary></entry></feed>`;
    const hits = parseFeed(xml);
    expect(hits[0]).toMatchObject({ url: "https://muster.example/news/preis", snippet: "Preis für Innovation" });
  });
  it("findet Feeds, News-Seite und Artikel-Links auf der Website", () => {
    const html = `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>
      <a href="/presse">Presse</a><a href="https://fremd.example/presse">fremd</a>
      <a href="/presse/2026/neue-halle-in-augsburg">Neue Halle in Augsburg eröffnet – 120 Arbeitsplätze</a>
      <a href="/presse/2026/neue-halle-in-augsburg">Neue Halle in Augsburg eröffnet – 120 Arbeitsplätze</a>
      <a href="/presse/archiv">mehr</a><a href="/kontakt">Kontakt</a></body></html>`;
    expect(discoverFeeds(html, "https://muster.example/")).toEqual(["https://muster.example/feed.xml"]);
    expect(findNewsPages(html, "https://muster.example/")).toEqual(["https://muster.example/presse"]);
    const links = extractArticleLinks(html, "https://muster.example/presse");
    expect(links).toHaveLength(1);
    expect(links[0].sourceKind).toBe("website");
  });
});

describe("KI-Auswertung & Status", () => {
  it("liest JSON auch mit Vortext, verwirft unbekannte Themen", () => {
    const a = parseAnalysis('Hier: ```json\n{"aboutEntity":true,"confidence":0.9,"summary":"Großauftrag.","sentiment":"positiv","relevance":0.8,"topics":["Auftrag","Quatsch"]}\n```');
    expect(a?.topics).toEqual(["Auftrag"]);
    expect(parseAnalysis("keine Ahnung")).toBeNull();
    expect(parseAnalysis('{"aboutEntity":"ja"}')).toBeNull();
  });
  it("relevant nur bei sicherer Zuordnung, Verwechslung wird verworfen, sonst neu mit Hinweis", () => {
    const base = { summary: "x", sentiment: "neutral" as const, topics: [] };
    expect(decideStatus(0.6, { ...base, aboutEntity: true, confidence: 0.9, relevance: 0.8 })).toEqual({ status: "relevant", uncertain: false });
    expect(decideStatus(0.6, { ...base, aboutEntity: false, confidence: 0.9, relevance: 0.8 }).status).toBe("irrelevant");
    expect(decideStatus(0.3, { ...base, aboutEntity: true, confidence: 0.9, relevance: 0.9 })).toEqual({ status: "new", uncertain: true });
    expect(decideStatus(0.6, null)).toEqual({ status: "new", uncertain: false });
    expect(decideStatus(0.3, null)).toEqual({ status: "new", uncertain: true });
  });
});
