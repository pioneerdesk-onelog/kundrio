import { describe, expect, it } from "vitest";
import { parseCamt } from "./camt";
import { parseXml } from "./xml";
import { matchTransaction, nameSimilarity, numberInText, type MatchInvoice } from "./match";
import { mapRevolutTransactions } from "./revolut-business";
import { invoiceTransition, openCents } from "../settlement";

// camt.053.001.02 (DK-Format, wie von Sparkassen/Volksbanken geliefert) – gekürzt
const CAMT053_02 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<BkToCstmrStmt><GrpHdr><MsgId>052-2026-10-06</MsgId><CreDtTm>2026-10-06T22:00:00</CreDtTm></GrpHdr>
<Stmt><Id>1</Id><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Ntry><Amt Ccy="EUR">119.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-06</Dt></BookgDt><ValDt><Dt>2026-10-06</Dt></ValDt>
 <AcctSvcrRef>2026100600123</AcctSvcrRef><BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn><Prtry><Cd>NTRF+166</Cd><Issr>DK</Issr></Prtry></BkTxCd>
 <NtryDtls><TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
 <RltdPties><Dbtr><Nm>Muster &amp; Söhne GmbH</Nm></Dbtr><DbtrAcct><Id><IBAN>DE02120300000000202051</IBAN></Id></DbtrAcct></RltdPties>
 <RmtInf><Ustrd>Rechnung RE 2026-0042 vielen Dank</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-10-06</Dt></BookgDt></Ntry>
<Ntry><Amt Ccy="EUR">23.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-06</Dt></BookgDt>
 <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>IDDT</Cd><SubFmlyCd>UPDD</SubFmlyCd></Fmly></Domn></BkTxCd>
 <NtryDtls><TxDtls><Refs><EndToEndId>E2E-RE-2026-0007</EndToEndId><MndtId>KDR-2026-0001</MndtId></Refs>
 <RltdPties><Dbtr><Nm>Erika Mustermann</Nm></Dbtr></RltdPties><RtrInf><Rsn><Cd>AC04</Cd></Rsn></RtrInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

// camt.053.001.08: Status als Code, Parteien unter Pty, Sammelbuchung mit zwei Einzelumsätzen, ohne Bank-Referenz
const CAMT053_08 = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
<BkToCstmrStmt><Stmt><Acct><Id><IBAN>DE89 3704 0044 0532 0130 00</IBAN></Id></Acct>
<Ntry><Amt Ccy="EUR">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><DtTm>2026-10-07T08:00:00+02:00</DtTm></BookgDt>
 <NtryDtls>
  <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">100.00</Amt></TxAmt></AmtDtls><Refs><EndToEndId>E2E-RE-2026-0010</EndToEndId></Refs><RltdPties><Dbtr><Pty><Nm>Beta AG</Nm></Pty></Dbtr></RltdPties></TxDtls>
  <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">200.00</Amt></TxAmt></AmtDtls><Refs><EndToEndId>E2E-RE-2026-0011</EndToEndId></Refs><RltdPties><Dbtr><Pty><Nm>Gamma KG</Nm></Pty></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>RF18539007547034</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>
 </NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-07</Dt></BookgDt><AddtlNtryInf>Gutschrift</AddtlNtryInf></Ntry>
<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-07</Dt></BookgDt><AddtlNtryInf>Gutschrift</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

const CAMT054 = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
<Ntry><Amt Ccy="EUR">59.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-05</Dt></BookgDt><NtryDtls><TxDtls><Refs><AcctSvcrRef>X-1</AcctSvcrRef></Refs><RmtInf><Ustrd>RE-2026-0050</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

describe("CAMT-Import", () => {
  it("liest camt.053.001.02: nur gebuchte Umsätze, Vorzeichen, Gegenpartei, Rückgabe", () => {
    const s = parseCamt(CAMT053_02);
    expect(s).toMatchObject({ kind: "camt.053", version: "camt.053.001.02", ibanLast4: "3000" });
    expect(s.entries).toHaveLength(2);
    expect(s.entries[0]).toMatchObject({ externalId: "ref:2026100600123", bookingDate: "2026-10-06", amountCents: 11900, counterparty: "Muster & Söhne GmbH", counterpartyIbanLast4: "2051", endToEndId: null, isReturn: false });
    expect(s.entries[0].remittance).toContain("RE 2026-0042");
    expect(s.entries[1]).toMatchObject({ amountCents: -2350, endToEndId: "E2E-RE-2026-0007", mandateRef: "KDR-2026-0001", isReturn: true, returnReason: "AC04" });
  });

  it("liest camt.053.001.08: Sammelbuchung zerlegt, Pty/Nm, strukturierte Referenz", () => {
    const s = parseCamt(CAMT053_08);
    expect(s.version).toBe("camt.053.001.08");
    expect(s.ibanLast4).toBe("3000");
    expect(s.entries.map((e) => e.amountCents)).toEqual([10000, 20000, 1000, 1000]);
    expect(s.entries[0]).toMatchObject({ counterparty: "Beta AG", endToEndId: "E2E-RE-2026-0010", bookingDate: "2026-10-07" });
    expect(s.entries[1].remittance).toBe("RF18539007547034");
  });

  it("Dubletten-Schlüssel stabil bei erneutem Import, gleiche Umsätze am selben Tag unterscheidbar", () => {
    const a = parseCamt(CAMT053_08).entries.map((e) => e.externalId);
    const b = parseCamt(CAMT053_08).entries.map((e) => e.externalId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a[2]).toMatch(/^h:[0-9a-f]{32}:1$/);
    expect(a[3]).toMatch(/:2$/);
  });

  it("liest camt.054", () => {
    const s = parseCamt(CAMT054);
    expect(s.kind).toBe("camt.054");
    expect(s.entries[0]).toMatchObject({ externalId: "ref:X-1", amountCents: 5950, remittance: "RE-2026-0050" });
  });

  it("lehnt DTD/Entitäten und Nicht-CAMT ab", () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>')).toThrow(/DTD/);
    expect(() => parseCamt("<Document><Foo/></Document>")).toThrow(/camt/);
    expect(() => parseCamt("<Document><BkToCstmrStmt>")).toThrow();
  });
});

describe("Zuordnung", () => {
  const invoices: MatchInvoice[] = [
    { id: "i42", number: "RE-2026-0042", grossCents: 11900, openCents: 11900, names: ["Muster & Söhne GmbH"] },
    { id: "i43", number: "RE-2026-0043", grossCents: 11900, openCents: 11900, names: ["Andere Firma AG"] },
    { id: "i50", number: "RE-2026-0050", grossCents: 10000, openCents: 4050, names: ["Kunde Fünfzig"] },
  ];
  const debits = [{ id: "d7", invoiceId: "i7", endToEndId: "E2E-RE-2026-0007", amountCents: 2000, status: "collected", mandateRef: "KDR-2026-0001" }];
  const payments = [{ id: "p1", invoiceId: "i43", externalId: "tr_WDqYK6vllg" }];
  const ctx = { invoices, debits, payments };

  it("Rechnungsnummer tolerant", () => {
    expect(numberInText("RE-2026-0042", "Rechnung RE 2026-0042 danke")).toBe("exact");
    expect(numberInText("RE-2026-0042", "re20260042")).toBe("exact");
    expect(numberInText("RE-2026-0042", "Zahlung 2026 0042")).toBe("digits");
    expect(numberInText("RE-2026-0042", "Kundennr 120260042")).toBeNull();
    expect(numberInText("RE-2026-0042", "RE-2026-0043")).toBeNull();
  });

  it("Namensähnlichkeit ist nur schwaches Indiz", () => {
    expect(nameSimilarity("MUSTER UND SOEHNE GMBH", "Muster & Söhne GmbH")).toBeGreaterThanOrEqual(0.5);
    expect(nameSimilarity("Erika Mustermann", "Max Mustermann")).toBe(0.5);
    expect(nameSimilarity(null, "x")).toBe(0);
  });

  it("Nummer + Betrag → Vorschlag mit Gründen, nie automatisch", () => {
    const r = matchTransaction({ amountCents: 11900, remittance: "Rechnung RE 2026-0042", counterparty: "Muster & Söhne GmbH", endToEndId: null }, ctx);
    expect(r).toMatchObject({ kind: "suggest", invoiceId: "i42", score: 100 });
    if (r.kind === "suggest") expect(r.reasons.join(" ")).toMatch(/Rechnungsnummer.*Betrag.*Name/);
  });

  it("Teilzahlung mit Nummer wird vorgeschlagen; Betrag allein nicht", () => {
    expect(matchTransaction({ amountCents: 4050, remittance: "RE-2026-0050", counterparty: null, endToEndId: null }, ctx)).toMatchObject({ kind: "suggest", invoiceId: "i50" });
    expect(matchTransaction({ amountCents: 11900, remittance: "Danke", counterparty: "Unbekannt", endToEndId: null }, ctx)).toEqual({ kind: "none" });
  });

  it("Gleichstand wird markiert", () => {
    const r = matchTransaction({ amountCents: 11900, remittance: "Danke", counterparty: "Andere Firma Muster Söhne", endToEndId: null }, { ...ctx, payments: [] });
    if (r.kind === "suggest") expect(r.reasons.at(-1)).toMatch(/gleicher Bewertung/);
  });

  it("eigene EndToEndId → automatisch (Einzug und Rücklastschrift)", () => {
    expect(matchTransaction({ amountCents: -2350, remittance: null, counterparty: "Erika", endToEndId: "E2E-RE-2026-0007" }, ctx)).toMatchObject({ kind: "auto", invoiceId: "i7", debitItemId: "d7", isReturn: true });
    expect(matchTransaction({ amountCents: 2000, remittance: null, counterparty: null, endToEndId: "E2E-RE-2026-0007" }, ctx)).toMatchObject({ kind: "auto", isReturn: false });
    // abweichender Betrag beim Eingang → kein Automatismus
    expect(matchTransaction({ amountCents: 1999, remittance: null, counterparty: null, endToEndId: "E2E-RE-2026-0007" }, ctx).kind).not.toBe("auto");
  });

  it("eigene Zahlungs-ID im Verwendungszweck → automatisch, nur mit Wortgrenze", () => {
    expect(matchTransaction({ amountCents: 11900, remittance: "Mollie tr_WDqYK6vllg", counterparty: null, endToEndId: null }, ctx)).toMatchObject({ kind: "auto", invoiceId: "i43" });
    expect(matchTransaction({ amountCents: 11900, remittance: "xtr_WDqYK6vllgx", counterparty: null, endToEndId: null }, ctx).kind).not.toBe("auto");
  });

  it("Ausgänge ohne eigene Kennung werden nie zugeordnet", () => {
    expect(matchTransaction({ amountCents: -11900, remittance: "RE-2026-0042", counterparty: null, endToEndId: null }, ctx)).toEqual({ kind: "none" });
  });
});

describe("Revolut Business Umsätze", () => {
  it("nur abgeschlossene, nur eigenes Konto, Cent-genau", () => {
    const rows = mapRevolutTransactions(
      [
        { id: "t1", type: "topup", state: "completed", created_at: "2026-10-06T10:00:00Z", completed_at: "2026-10-06T10:00:05Z", reference: "RE-2026-0042", legs: [{ leg_id: "l1", account_id: "acc", amount: 119.0, currency: "EUR", description: "Payment from Muster GmbH" }] },
        { id: "t2", type: "transfer", state: "pending", created_at: "2026-10-06T11:00:00Z", legs: [{ leg_id: "l2", account_id: "acc", amount: 5, currency: "EUR" }] },
        { id: "t3", type: "exchange", state: "completed", created_at: "2026-10-06T12:00:00Z", legs: [{ leg_id: "l3", account_id: "other", amount: -10.1, currency: "GBP" }] },
      ],
      "acc",
    );
    expect(rows).toEqual([expect.objectContaining({ externalId: "t1:l1", amountCents: 11900, counterparty: "Muster GmbH", remittance: "RE-2026-0042", bookingDate: "2026-10-06" })]);
  });
});

describe("Rechnungsstatus", () => {
  it("nur bei vollständiger Zahlung PAID; Erstattung öffnet wieder", () => {
    expect(invoiceTransition("SENT", 11900, 0, 11900)).toBe("paid");
    expect(invoiceTransition("SENT", 11900, 0, 5000)).toBe("partial");
    expect(invoiceTransition("PAID", 11900, 11900, 11900)).toBe("none");
    expect(invoiceTransition("PAID", 11900, 11900, 9000)).toBe("reopened");
    expect(invoiceTransition("CANCELLED", 11900, 0, 11900)).toBe("none");
    expect(invoiceTransition("DRAFT", 11900, 0, 11900)).toBe("none");
  });

  it("offener Betrag aus Online-Zahlungen (abzgl. Erstattungen) und Bank", () => {
    expect(openCents(11900, [{ status: "paid", amountCents: 5000, refundedCents: 1000 }, { status: "open", amountCents: 11900, refundedCents: 0 }], [{ amountCents: 2000 }, { amountCents: -500 }])).toBe(5900);
    expect(openCents(1000, [{ status: "paid", amountCents: 2000, refundedCents: 0 }])).toBe(0);
  });
});
