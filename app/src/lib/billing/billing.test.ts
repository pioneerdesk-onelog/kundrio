import { describe, expect, it } from "vitest";
import { addMonthsAnchored, billingPeriod, cancellationEffectiveDate, duePeriods, isoDay, monthlyRecurringCents, parseDay } from "./periods";
import {
  addBusinessDays,
  buildPain008,
  debitSequence,
  storedSequence,
  earliestCollectionDate,
  easterSunday,
  isTargetBusinessDay,
  isValidCreditorId,
  isValidMandateRef,
  mandateRefFor,
  PAIN008_NS,
  sepaText,
  type Pain008Input,
} from "./sepa";
import { DEFAULT_DUNNING, nextDunningLevel, parseDunningSettings, renderDunningPlaceholders } from "./dunning";
import { subscriptionMetrics } from "./metrics";

const d = parseDay;
const iso = (x: Date) => isoDay(x);

describe("Perioden", () => {
  it("hält den Monatsletzten über kurze Monate (Anker 31.)", () => {
    expect(iso(addMonthsAnchored(d("2026-01-31"), 1, 31))).toBe("2026-02-28");
    expect(iso(addMonthsAnchored(d("2026-02-28"), 1, 31))).toBe("2026-03-31");
    expect(iso(addMonthsAnchored(d("2028-01-31"), 1, 31))).toBe("2028-02-29"); // Schaltjahr
  });

  it("Leistungszeitraum endet am Tag vor der nächsten Periode", () => {
    expect(billingPeriod(d("2026-01-31"), "monthly", 31)).toEqual({ from: d("2026-01-31"), to: d("2026-02-27"), next: d("2026-02-28") });
    const q = billingPeriod(d("2026-11-15"), "quarterly", 15);
    expect([iso(q.from), iso(q.to), iso(q.next)]).toEqual(["2026-11-15", "2027-02-14", "2027-02-15"]);
    const y = billingPeriod(d("2028-02-29"), "yearly", 29);
    expect(iso(y.next)).toBe("2029-02-28");
    expect(billingPeriod(d("2026-05-05"), "one_time", 5).to).toEqual(d("2026-05-05"));
  });

  it("holt ausgefallene Perioden nach (je Periode genau eine)", () => {
    const p = duePeriods(d("2026-07-31"), "monthly", 31, d("2026-10-07"));
    expect(p.map((x) => iso(x.from))).toEqual(["2026-07-31", "2026-08-31", "2026-09-30"]);
    expect(duePeriods(d("2026-10-08"), "monthly", 8, d("2026-10-07"))).toHaveLength(0);
    expect(duePeriods(d("2026-10-01"), "one_time", 1, d("2027-10-01"))).toHaveLength(1);
  });

  it("MRR rechnet Quartal/Jahr auf den Monat um, einmalig zählt nicht", () => {
    expect(monthlyRecurringCents([{ qty: 1, unitCents: 12000 }], "yearly")).toBe(1000);
    expect(monthlyRecurringCents([{ qty: 2, unitCents: 1500 }], "quarterly")).toBe(1000);
    expect(monthlyRecurringCents([{ qty: 1, unitCents: 5000 }], "one_time")).toBe(0);
  });
});

describe("Kündigungsfristen", () => {
  const base = { startDate: d("2026-01-01"), interval: "monthly" as const, minTermMonths: 12, noticePeriodDays: 30, nextBillingDate: d("2026-11-01") };

  it("B2C vor Ablauf der Mindestlaufzeit: zum Ende der Mindestlaufzeit", () => {
    expect(iso(cancellationEffectiveDate({ ...base, consumer: true, requestedAt: d("2026-10-07") }))).toBe("2026-12-31");
  });

  it("B2C nach der Mindestlaufzeit: jederzeit mit höchstens einem Monat (§ 309 Nr. 9 BGB)", () => {
    expect(iso(cancellationEffectiveDate({ ...base, consumer: true, requestedAt: d("2027-03-10"), noticePeriodDays: 90 }))).toBe("2027-04-09");
  });

  it("B2C: kurz vor Ende der Mindestlaufzeit verlängert sich nur bis Fristablauf", () => {
    expect(iso(cancellationEffectiveDate({ ...base, consumer: true, requestedAt: d("2026-12-20") }))).toBe("2027-01-19");
  });

  it("B2B: Periodenende mit Frist, sonst eine Periode später", () => {
    const b2b = { ...base, consumer: false, minTermMonths: 0, noticePeriodDays: 14 };
    expect(iso(cancellationEffectiveDate({ ...b2b, requestedAt: d("2026-10-07") }))).toBe("2026-10-31");
    expect(iso(cancellationEffectiveDate({ ...b2b, requestedAt: d("2026-10-20") }))).toBe("2026-11-30");
  });

  it("B2B: nie vor der Mindestlaufzeit", () => {
    expect(iso(cancellationEffectiveDate({ ...base, consumer: false, requestedAt: d("2026-03-01"), nextBillingDate: d("2026-04-01") }))).toBe("2026-12-31");
  });
});

describe("Gläubiger-ID und Mandatsreferenz", () => {
  it("prüft die Prüfziffer der Gläubiger-ID", () => {
    expect(isValidCreditorId("DE98ZZZ09999999999")).toBe(true); // Beispiel der Bundesbank
    expect(isValidCreditorId("de98 zzz0 9999 9999 99")).toBe(true);
    expect(isValidCreditorId("DE97ZZZ09999999999")).toBe(false);
    expect(isValidCreditorId("DE98ZZZ0999999999")).toBe(false); // zu kurz
    expect(isValidCreditorId("DE98ABC09999999999")).toBe(true); // Geschäftsbereich zählt nicht zur Prüfziffer
  });

  it("erzeugt gültige Mandatsreferenzen (≤ 35 Zeichen, erlaubte Zeichen)", () => {
    const ref = mandateRefFor("onelog-pro", 2026, 7);
    expect(ref).toBe("ONELOGPRO-2026-00007");
    expect(isValidMandateRef(ref)).toBe(true);
    expect(isValidMandateRef("a".repeat(36))).toBe(false);
    expect(isValidMandateRef("/ABC")).toBe(false);
    expect(isValidMandateRef("A//B")).toBe(false);
    expect(isValidMandateRef("MIT LEER")).toBe(false);
  });

  it("schreibt Umlaute im SEPA-Zeichensatz um", () => {
    expect(sepaText("Müller & Söhne GmbH – Straße", 140)).toBe("Mueller + Soehne GmbH Strasse");
    expect(sepaText("x".repeat(200), 140)).toHaveLength(140);
  });
});

describe("TARGET2-Bankarbeitstage", () => {
  it("kennt Ostern und die festen Feiertage", () => {
    expect(iso(easterSunday(2026))).toBe("2026-04-05");
    expect(iso(easterSunday(2027))).toBe("2027-03-28");
    expect(isTargetBusinessDay(d("2026-04-03"))).toBe(false); // Karfreitag
    expect(isTargetBusinessDay(d("2026-04-06"))).toBe(false); // Ostermontag
    expect(isTargetBusinessDay(d("2026-05-01"))).toBe(false);
    expect(isTargetBusinessDay(d("2026-12-24"))).toBe(true); // kein TARGET2-Feiertag
    expect(isTargetBusinessDay(d("2026-12-25"))).toBe(false);
    expect(isTargetBusinessDay(d("2026-10-10"))).toBe(false); // Samstag
    expect(isTargetBusinessDay(d("2026-10-03"))).toBe(false); // Samstag (Tag der Dt. Einheit ist kein TARGET2-Feiertag)
  });

  it("überspringt Wochenenden und Feiertage", () => {
    expect(iso(addBusinessDays(d("2026-10-09"), 1))).toBe("2026-10-12"); // Fr → Mo
    expect(iso(addBusinessDays(d("2026-12-24"), 1))).toBe("2026-12-28");
    expect(iso(addBusinessDays(d("2026-04-02"), 1))).toBe("2026-04-07");
  });

  it("Einzugsdatum beachtet Vorlauf und 14 Tage Vorabankündigung", () => {
    expect(iso(earliestCollectionDate(d("2026-10-07"), d("2026-10-07")))).toBe("2026-10-21");
    expect(iso(earliestCollectionDate(d("2026-10-07"), d("2026-09-01")))).toBe("2026-10-08");
    expect(iso(earliestCollectionDate(d("2026-12-11"), d("2026-12-11")))).toBe("2026-12-28"); // 25.12. fällt aus, 26./27. Wochenende
  });
});

describe("pain.008.001.08", () => {
  const input: Pain008Input = {
    messageId: "PD-20261007-ABC",
    createdAt: new Date("2026-10-07T08:00:00Z"),
    initiatorName: "Pioneerdesk GmbH",
    creditorName: "Pioneerdesk GmbH",
    creditorIban: "DE89 3704 0044 0532 0130 00",
    creditorBic: null,
    creditorId: "DE98ZZZ09999999999",
    collectionDate: d("2026-10-21"),
    transactions: [
      { endToEndId: "RE-2026-0001", amountCents: 11900, mandateRef: "PD-2026-00001", mandateSignedAt: d("2026-09-01"), debtorName: "Jörg Müller", debtorIban: "DE02120300000000202051", remittance: "Rechnung RE-2026-0001", sequence: "FRST", scheme: "CORE" },
      { endToEndId: "RE-2026-0002", amountCents: 5950, mandateRef: "PD-2026-00002", mandateSignedAt: d("2025-01-15"), debtorName: "Anna Beispiel", debtorIban: "DE02500105170137075030", debtorBic: "INGDDEFFXXX", remittance: "Rechnung RE-2026-0002", sequence: "RCUR", scheme: "CORE" },
      { endToEndId: "RE-2026-0003", amountCents: 2000, mandateRef: "PD-2026-00003", mandateSignedAt: d("2025-02-01"), debtorName: "Beispiel AG", debtorIban: "DE02100100100006820101", remittance: "Rechnung RE-2026-0003", sequence: "RCUR", scheme: "B2B" },
    ],
  };
  const xml = buildPain008(input);
  const count = (tag: string) => (xml.match(new RegExp(`<${tag}>`, "g")) ?? []).length;

  it("nutzt Namespace und Kopfdaten der Version 08", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`xmlns="${PAIN008_NS}"`);
    expect(xml).toContain("<MsgId>PD-20261007-ABC</MsgId>");
    expect(xml).toMatch(/<GrpHdr>[\s\S]*<NbOfTxs>3<\/NbOfTxs>[\s\S]*<CtrlSum>198.50<\/CtrlSum>/);
  });

  it("bildet je Verfahren und Sequenz einen Zahlungsblock mit Summen", () => {
    expect(count("PmtInf")).toBe(3);
    expect(xml).toContain("<SeqTp>FRST</SeqTp>");
    expect(xml).toContain("<Cd>B2B</Cd>");
    expect(xml).toContain("<ChrgBr>SLEV</ChrgBr>");
    expect(xml).toContain("<ReqdColltnDt>2026-10-21</ReqdColltnDt>");
    expect(xml).toMatch(/<Prtry>SEPA<\/Prtry>/);
    expect(xml).toContain("<Id>DE98ZZZ09999999999</Id>");
  });

  it("schreibt BIC als BICFI bzw. NOTPROVIDED und Umlaute umschrieben", () => {
    expect(xml).toContain("<BICFI>INGDDEFFXXX</BICFI>");
    expect(xml).toContain("<Id>NOTPROVIDED</Id>");
    expect(xml).toContain("<Nm>Joerg Mueller</Nm>");
    expect(xml).toContain('<InstdAmt Ccy="EUR">119.00</InstdAmt>');
    expect(xml).toContain("<DtOfSgntr>2026-09-01</DtOfSgntr>");
  });

  it("schreibt Einmallastschriften (einmalige Abos) als OOFF statt FRST", () => {
    expect(debitSequence("FRST", "one_time")).toBe("OOFF");
    expect(debitSequence("RCUR", "one_time")).toBe("OOFF");
    expect(debitSequence("FRST", "monthly")).toBe("FRST");
    expect(debitSequence("RCUR", "yearly")).toBe("RCUR");
    expect(debitSequence("FRST", null)).toBe("FRST");
    expect(storedSequence("OOFF")).toBe("OOFF");
    expect(storedSequence("unbekannt")).toBe("FRST");
    const once = buildPain008({ ...input, transactions: [{ ...input.transactions[0], sequence: debitSequence("FRST", "one_time") }] });
    expect(once).toContain("<SeqTp>OOFF</SeqTp>");
    expect(once).not.toContain("<SeqTp>FRST</SeqTp>");
  });

  it("lehnt ungültige Daten ab", () => {
    expect(() => buildPain008({ ...input, creditorId: "DE00ZZZ09999999999" })).toThrow();
    expect(() => buildPain008({ ...input, transactions: [{ ...input.transactions[0], amountCents: 0 }] })).toThrow();
    expect(() => buildPain008({ ...input, transactions: [{ ...input.transactions[0], debtorIban: "DE00123" }] })).toThrow();
    expect(() => buildPain008({ ...input, transactions: [] })).toThrow();
  });
});

describe("Mahnstufen", () => {
  const s = DEFAULT_DUNNING;
  it("Stufe 1 nach Frist ab Fälligkeit, dann 2 und 3 jeweils ab letzter Mahnung", () => {
    expect(nextDunningLevel({ dueDate: d("2026-10-01"), level: 0, dunnedAt: null, today: d("2026-10-07"), inCollection: false }, s)).toBeNull();
    expect(nextDunningLevel({ dueDate: d("2026-10-01"), level: 0, dunnedAt: null, today: d("2026-10-08"), inCollection: false }, s)).toBe(1);
    expect(nextDunningLevel({ dueDate: d("2026-10-01"), level: 1, dunnedAt: d("2026-10-08"), today: d("2026-10-21"), inCollection: false }, s)).toBeNull();
    expect(nextDunningLevel({ dueDate: d("2026-10-01"), level: 1, dunnedAt: d("2026-10-08"), today: d("2026-10-22"), inCollection: false }, s)).toBe(2);
    expect(nextDunningLevel({ dueDate: d("2026-10-01"), level: 2, dunnedAt: d("2026-10-22"), today: d("2026-11-05"), inCollection: false }, s)).toBe(3);
    expect(nextDunningLevel({ dueDate: d("2026-10-01"), level: 3, dunnedAt: d("2026-11-05"), today: d("2027-01-01"), inCollection: false }, s)).toBeNull();
  });

  it("mahnt nicht im Lastschrifteinzug und nicht, wenn abgeschaltet", () => {
    expect(nextDunningLevel({ dueDate: d("2026-09-01"), level: 0, dunnedAt: null, today: d("2026-10-07"), inCollection: true }, s)).toBeNull();
    expect(nextDunningLevel({ dueDate: d("2026-09-01"), level: 0, dunnedAt: null, today: d("2026-10-07"), inCollection: false }, { ...s, enabled: false })).toBeNull();
  });

  it("liest Einstellungen robust und ersetzt Mahn-Platzhalter", () => {
    const p = parseDunningSettings({ daysToLevel1: 3, feeCents: [0, 250, -5], texts: { "1": { subject: "x" } } });
    expect(p.daysToLevel1).toBe(3);
    expect(p.daysToLevel2).toBe(s.daysToLevel2);
    expect(p.feeCents[2]).toBeGreaterThanOrEqual(0);
    expect(p.texts["1"].body.length).toBeGreaterThan(10);
    expect(renderDunningPlaceholders("{{ mahnung.stufe }}{{ mahnung.gebuehr_text }}.", 2, 500).replace(/\s/g, " ")).toBe("Mahnung zuzüglich einer Mahngebühr von 5,00 €.");
    expect(renderDunningPlaceholders("Betrag{{ mahnung.gebuehr_text }}.", 1, 0)).toBe("Betrag.");
  });
});

describe("Kennzahlen", () => {
  it("MRR, Neu, Kündigungen und Churn im Monat", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const item = (c: number) => [{ title: "X", qty: 1, unitCents: c, vatRate: 19, unit: "MON" }];
    const m = subscriptionMetrics(
      [
        { status: "active", interval: "monthly", items: item(10000), startDate: d("2026-01-01"), cancelledAt: null, endDate: null },
        { status: "active", interval: "yearly", items: item(120000), startDate: d("2026-10-02"), cancelledAt: null, endDate: null },
        { status: "cancelled", interval: "monthly", items: item(5000), startDate: d("2026-02-01"), cancelledAt: new Date("2026-10-05"), endDate: d("2026-10-31") },
        { status: "ended", interval: "monthly", items: item(5000), startDate: d("2025-01-01"), cancelledAt: new Date("2026-05-01"), endDate: d("2026-06-30") },
      ],
      now,
    );
    expect(m.mrrCents).toBe(10000 + 10000 + 5000);
    expect(m.arrCents).toBe(m.mrrCents * 12);
    expect(m.newThisMonth).toBe(1);
    expect(m.cancelledThisMonth).toBe(1);
    expect(m.churn).toBeCloseTo(1 / 2);
  });
});
