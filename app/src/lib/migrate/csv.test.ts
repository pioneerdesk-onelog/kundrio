import { describe, expect, it } from "vitest";
import { parseCsv } from "../a-csv";
import { csvCell, detectFormat, rowsToRecords, suggestMapping, toBrevoCsv, toHubspotCsv, type ExportContact } from "./csv";

describe("Formaterkennung und Mapping", () => {
  it("erkennt Brevo-Export", () => {
    const h = ["CONTACT ID", "EMAIL", "FIRSTNAME", "LASTNAME", "SMS", "TENANT_ID", "EMAIL_BLACKLISTED"];
    expect(detectFormat(h)).toBe("brevo");
    expect(suggestMapping(h)).toEqual(["skip", "email", "firstName", "lastName", "phone", "attr:TENANT_ID", "blacklisted"]);
  });

  it("erkennt HubSpot-Export (EN und DE)", () => {
    const en = ["Record ID", "First Name", "Last Name", "Email", "Phone Number", "Company Name", "Lifecycle Stage", "Unsubscribed from all email"];
    expect(detectFormat(en)).toBe("hubspot");
    expect(suggestMapping(en)).toEqual(["skip", "firstName", "lastName", "email", "phone", "company", "attr:LIFECYCLE_STAGE", "blacklisted"]);
    const de = ["Datensatz-ID", "Vorname", "Nachname", "E-Mail", "Telefonnummer", "Firmenname"];
    expect(detectFormat(de)).toBe("hubspot");
    expect(suggestMapping(de)).toEqual(["skip", "firstName", "lastName", "email", "phone", "company"]);
  });

  it("wandelt Zeilen in Datensätze", () => {
    const rows = parseCsv("EMAIL;FIRSTNAME;LISTS;EMAIL_BLACKLISTED;DOUBLE_OPT-IN\nA@X.DE;Anna;Kunden;Newsletter;true;1");
    // Hinweis: Mehrfachwerte in Listen nutzen ; innerhalb von Anführungszeichen – hier absichtlich ohne → Spalten verschieben sich
    const rows2 = parseCsv('EMAIL;FIRSTNAME;LISTS;EMAIL_BLACKLISTED;DOUBLE_OPT-IN\nA@X.DE;Anna;"Kunden;Newsletter";true;1');
    const map = suggestMapping(rows2[0]);
    const [r] = rowsToRecords(rows2.slice(1), map);
    expect(r.email).toBe("a@x.de");
    expect(r.firstName).toBe("Anna");
    expect(r.lists).toEqual(["Kunden", "Newsletter"]);
    expect(r.blacklisted).toBe(true);
    expect(r.consent).toBe(true);
    expect(rows[1].length).toBe(6);
  });
});

describe("Export", () => {
  const c: ExportContact = {
    email: "a@x.de",
    firstName: "=HYPERLINK(\"evil\")",
    lastName: "Muster",
    phone: "+49 151 123",
    company: "ACME, Inc",
    tags: ["kunde"],
    lists: ["Kunden", "Newsletter"],
    unsubscribed: false,
    consent: true,
    attributes: { TENANT_ID: "t-1", NUM: -5 },
  };

  it("schützt vor Formeln, lässt Telefonnummern und Zahlen intakt", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+49 151 123")).toBe("+49 151 123");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it("schreibt Brevo-CSV, das wieder eingelesen dieselben Daten ergibt", () => {
    const csv = toBrevoCsv([c], ["TENANT_ID", "NUM"]);
    const rows = parseCsv(csv);
    expect(rows[0].slice(0, 6)).toEqual(["EMAIL", "FIRSTNAME", "LASTNAME", "SMS", "COMPANY", "TENANT_ID"]);
    const [r] = rowsToRecords(rows.slice(1), suggestMapping(rows[0]));
    expect(r).toMatchObject({ email: "a@x.de", firstName: '=HYPERLINK("evil")', phone: "+49 151 123", company: "ACME, Inc", consent: true, blacklisted: false });
    expect(r.lists).toEqual(["Kunden", "Newsletter"]);
    expect(r.attributes).toEqual({ TENANT_ID: "t-1", NUM: "-5" });
  });

  it("schreibt HubSpot-CSV mit Standardspalten", () => {
    const rows = parseCsv(toHubspotCsv([c], [{ key: "TENANT_ID", label: "Tenant" }]));
    expect(rows[0]).toEqual(["Email", "First Name", "Last Name", "Phone Number", "Company Name", "Tenant", "Marketing contact status", "Unsubscribed from all email", "Lists", "Tags"]);
    expect(rows[1][6]).toBe("Marketing contact");
  });
});
