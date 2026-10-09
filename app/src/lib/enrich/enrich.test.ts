import { describe, expect, it } from "vitest";
import { findVatId, isValidGermanVatId, parseImpressum } from "./impressum";
import { detectSocialLinks, extractLinks, findPages, professionalProfileNet } from "./links";
import { parseRobots, robotsAllows } from "./fetch-rules";
import { personEnrichmentBlocked, matchProfileResult, jobTitleFromText } from "./persons-rules";

// Fiktive Impressum-Texte (wie nach htmlToText), alle Daten erfunden
const GMBH = `Impressum
Angaben gemäß § 5 DDG
Muster Maschinenbau GmbH
Industriestraße 12
85354 Freising
Telefon: +49 8161 123 45-0
E-Mail: info@muster-maschinenbau.example
Vertreten durch die Geschäftsführer: Anna Beispiel, Dr. Bernd Probe
Registergericht: Amtsgericht München
Registernummer: HRB 123456
Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG: DE 123 456 788`;

const UG = `Impressum
Klein & Fein UG (haftungsbeschränkt)
Hauptstr. 5a, 10115 Berlin
Geschäftsführerin: Clara Muster
Handelsregister: HRB 98765 B, Amtsgericht Charlottenburg
USt-IdNr.: DE812345673
Mail: kontakt[at]kleinundfein.example`;

const AG = `Anbieter
Beispiel Software AG
Am Seestern 3
40547 Düsseldorf
Vorstand: Dieter Vorstandsmann, Erika Musterfrau
Aufsichtsratsvorsitzender: Max Aufsicht
Eingetragen im Handelsregister beim Amtsgericht Düsseldorf, HRB 55555
USt-ID: DE276051327
Tel. 0211 / 555 66 77`;

const EK = `Impressum
Gärtnerei Grünwald e.K.
Inhaber: Georg Grünwald
Feldweg 7
84030 Ergolding
Telefon 0871 99887
Amtsgericht Landshut HRA 1234`;

const KG = `Impressum
Holzbau Huber GmbH & Co. KG
Waldstraße 21
83022 Rosenheim
Persönlich haftende Gesellschafterin: Holzbau Huber Verwaltungs GmbH
Geschäftsführer: Hans Huber
Registergericht: Amtsgericht Traunstein, HRA 9876
USt-IdNr.: DE112233446`;

const OHNE_UST = `Impressum
Beratung Becker GmbH
Lindenallee 2
50667 Köln
Geschäftsführer: Paula Becker
Amtsgericht Köln HRB 4711
Kleinunternehmerin? Nein – USt-IdNr. wird beantragt.`;

describe("Impressum-Parser", () => {
  it("GmbH: alle Pflichtangaben", () => {
    const d = parseImpressum(GMBH);
    expect(d.legalName).toBe("Muster Maschinenbau GmbH");
    expect(d.legalForm).toBe("GmbH");
    expect(d.address).toBe("Industriestraße 12\n85354 Freising");
    expect(d.phone).toBe("+49 8161 123 45-0");
    expect(d.email).toBe("info@muster-maschinenbau.example");
    expect(d.registerCourt).toBe("Amtsgericht München");
    expect(d.registerNumber).toBe("HRB 123456");
    expect(d.vatId).toBe("DE123456788");
    expect(d.managingDirectors).toEqual(["Anna Beispiel", "Bernd Probe"]);
  });
  it("UG (haftungsbeschränkt) mit [at]-Adresse und Registerzusatz B", () => {
    const d = parseImpressum(UG);
    expect(d.legalName).toBe("Klein & Fein UG (haftungsbeschränkt)");
    expect(d.address).toBe("Hauptstr. 5a\n10115 Berlin");
    expect(d.registerNumber).toBe("HRB 98765 B");
    expect(d.registerCourt).toBe("Amtsgericht Charlottenburg");
    expect(d.vatId).toBe("DE812345673");
    expect(d.email).toBe("kontakt@kleinundfein.example");
    expect(d.managingDirectors).toEqual(["Clara Muster"]);
  });
  it("AG mit Vorstand (Aufsichtsrat wird nicht als Geschäftsführung gelesen)", () => {
    const d = parseImpressum(AG);
    expect(d.legalForm).toBe("AG");
    expect(d.managingDirectors).toEqual(["Dieter Vorstandsmann", "Erika Musterfrau"]);
    expect(d.registerCourt).toBe("Amtsgericht Düsseldorf");
    expect(d.vatId).toBe("DE276051327");
    expect(d.phone).toBe("0211 / 555 66 77");
  });
  it("e.K. mit Inhaber und HRA", () => {
    const d = parseImpressum(EK);
    expect(d.legalName).toBe("Gärtnerei Grünwald e.K.");
    expect(d.managingDirectors).toEqual(["Georg Grünwald"]);
    expect(d.registerNumber).toBe("HRA 1234");
    expect(d.registerCourt).toBe("Amtsgericht Landshut");
    expect(d.vatId).toBeUndefined();
  });
  it("GmbH & Co. KG: Firmierung der KG, nicht der Komplementärin", () => {
    const d = parseImpressum(KG);
    expect(d.legalName).toBe("Holzbau Huber GmbH & Co. KG");
    expect(d.legalForm).toBe("GmbH & Co. KG");
    expect(d.registerNumber).toBe("HRA 9876");
    expect(d.managingDirectors).toEqual(["Hans Huber"]);
  });
  it("ohne USt-IdNr.: kein erfundener Wert", () => {
    const d = parseImpressum(OHNE_UST);
    expect(d.vatId).toBeUndefined();
    expect(d.registerNumber).toBe("HRB 4711");
    expect(d.address).toBe("Lindenallee 2\n50667 Köln");
  });
});

describe("USt-IdNr.", () => {
  it("prüft die deutsche Prüfziffer", () => {
    expect(isValidGermanVatId("DE123456788")).toBe(true);
    expect(isValidGermanVatId("DE123456789")).toBe(false);
    expect(isValidGermanVatId("DE12345678")).toBe(false);
  });
  it("ignoriert DE-Nummern mit falscher Prüfziffer", () => {
    expect(findVatId("USt-IdNr.: DE123456789")).toBeUndefined();
    expect(findVatId("VAT ID: ATU12345678")).toBe("ATU12345678");
  });
});

describe("Links & Social", () => {
  const html = `<a href="/impressum">Impressum</a><a href="/kontakt/">Kontakt</a><a href="https://www.linkedin.com/company/muster-gmbh/">LinkedIn</a>
  <a href="https://www.xing.com/pages/muster-gmbh">XING</a><a href="https://www.instagram.com/muster.gmbh/">Insta</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=x">teilen</a><a href="https://www.youtube.com/@mustergmbh">YT</a>
  <a href="https://twitter.com/intent/tweet">tweet</a><a href="https://x.com/mustergmbh">X</a><a href="https://other.example/impressum">fremd</a>
  <a href="javascript:void(0)">js</a><a href="#top">top</a>`;
  const links = extractLinks(html, "https://www.muster.example/");
  it("findet Impressum/Kontakt nur auf der eigenen Website", () => {
    const p = findPages(links, "https://www.muster.example/");
    expect(p.impressum).toEqual(["https://www.muster.example/impressum"]);
    expect(p.contact).toEqual(["https://www.muster.example/kontakt/"]);
  });
  it("erkennt Social-Profile, ignoriert Teilen-Links", () => {
    expect(detectSocialLinks(links)).toEqual({
      linkedin: "https://www.linkedin.com/company/muster-gmbh",
      xing: "https://www.xing.com/pages/muster-gmbh",
      instagram: "https://www.instagram.com/muster.gmbh",
      youtube: "https://www.youtube.com/@mustergmbh",
      x: "https://x.com/mustergmbh",
    });
  });
  it("berufliche Personenprofile", () => {
    expect(professionalProfileNet("https://de.linkedin.com/in/anna-beispiel-123")).toBe("linkedin");
    expect(professionalProfileNet("https://www.xing.com/profile/Anna_Beispiel")).toBe("xing");
    expect(professionalProfileNet("https://www.instagram.com/anna")).toBeNull();
  });
});

describe("robots.txt", () => {
  it("beachtet Disallow/Allow für * und eigenen Agenten", () => {
    const r = parseRobots("User-agent: *\nDisallow: /intern\nAllow: /intern/presse\n\nUser-agent: BadBot\nDisallow: /");
    expect(robotsAllows(r, "/impressum")).toBe(true);
    expect(robotsAllows(r, "/intern/x")).toBe(false);
    expect(robotsAllows(r, "/intern/presse/1")).toBe(true);
    const own = parseRobots("User-agent: *\nAllow: /\nUser-agent: Kundrio-Enrichment\nDisallow: /");
    expect(robotsAllows(own, "/")).toBe(false);
  });
});

describe("Personen-Regeln", () => {
  it("nur mit Einstellung und ohne Widerspruch", () => {
    expect(personEnrichmentBlocked({ enrichPersons: false }, { tags: [] })).toMatch(/ausgeschaltet/);
    expect(personEnrichmentBlocked({ enrichPersons: true }, { tags: ["keine-anreicherung"] })).toMatch(/widersprochen/);
    expect(personEnrichmentBlocked({ enrichPersons: true }, { tags: ["vip"] })).toBeNull();
  });
  it("Profil-Treffer nur bei Name UND Firma", () => {
    const p = { firstName: "Anna", lastName: "Beispiel", company: "Muster Maschinenbau GmbH" };
    expect(matchProfileResult({ url: "https://de.linkedin.com/in/anna-beispiel", title: "Anna Beispiel – Muster Maschinenbau GmbH | LinkedIn", content: "" }, p)).toBe("linkedin");
    expect(matchProfileResult({ url: "https://de.linkedin.com/in/anna-beispiel-2", title: "Anna Beispiel – Bäckerei Krume", content: "" }, p)).toBeNull();
    expect(matchProfileResult({ url: "https://www.instagram.com/anna", title: "Anna Beispiel Muster Maschinenbau", content: "" }, p)).toBeNull();
  });
  it("Funktion aus Team-/Impressum-Text", () => {
    const t = "Unser Team\nAnna Beispiel\nGeschäftsführerin\nBernd Probe – Leiter Vertrieb\nClara Muster, Marketing";
    expect(jobTitleFromText(t, "Anna", "Beispiel")).toBe("Geschäftsführerin");
    expect(jobTitleFromText(t, "Bernd", "Probe")).toBe("Leiter Vertrieb");
    expect(jobTitleFromText(t, "Otto", "Fremd")).toBeUndefined();
  });
});

import { parseStructured } from "./structured";

describe("Strukturierte Daten (JSON-LD, Meta)", () => {
  it("liest Organization inkl. Adresse, USt-ID und sameAs aus @graph", () => {
    const html = `<head><meta name="description" content="Sondermaschinen für die Lebensmittelindustrie aus Freising.">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},
{"@type":["Organization","Corporation"],"name":"Muster","legalName":"Muster Maschinenbau GmbH","telephone":"+49 8161 12345",
"email":"mailto:Info@Muster.example","vatID":"DE 123456788","address":{"@type":"PostalAddress","streetAddress":"Industriestraße 12","postalCode":"85354","addressLocality":"Freising"},
"sameAs":["https://www.linkedin.com/company/muster/","https://www.instagram.com/muster/","javascript:alert(1)"]}]}</script></head>`;
    const d = parseStructured(html);
    expect(d.legalName).toBe("Muster Maschinenbau GmbH");
    expect(d.address).toBe("Industriestraße 12\n85354 Freising");
    expect(d.email).toBe("info@muster.example");
    expect(d.vatId).toBe("DE123456788");
    expect(d.sameAs).toEqual(["https://www.linkedin.com/company/muster/", "https://www.instagram.com/muster/"]);
    expect(d.description).toBe("Sondermaschinen für die Lebensmittelindustrie aus Freising.");
  });
  it("übersteht kaputtes JSON-LD und fällt auf og:description zurück", () => {
    const d = parseStructured(`<script type="application/ld+json">{kaputt</script><meta property="og:description" content="Kurzbeschreibung der Firma">`);
    expect(d.sameAs).toEqual([]);
    expect(d.description).toBe("Kurzbeschreibung der Firma");
  });
});
