// SEPA-Lastschrift (reine Funktionen): Gläubiger-ID, Mandatsreferenz, Zeichensatz, TARGET2-Bankarbeitstage,
// Einzugsdatum und pain.008.001.08 (ISO 20022 Version 2019, DK Anlage 3 Version 3.8 – „DK-TVS pain.008.001.08_GBIC_4“).
// pain.008.001.02 (Version 3.6) wird von deutschen Banken nur noch bis November 2026 angenommen.

import { addDays, dateOnly, isoDay } from "./periods";
import { isValidIban, normalizeIban } from "../compliance-validators";

export const PAIN008_NS = "urn:iso:std:iso:20022:tech:xsd:pain.008.001.08";

// ---------- Zeichensatz ----------

/** SEPA-Basiszeichensatz (EPC): a–z A–Z 0–9 / - ? : ( ) . , ' + Leerzeichen. Umlaute werden umschrieben. */
export function sepaText(input: string, max: number): string {
  const map: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss", "&": "+", "@": "(at)", _: "-" };
  const t = input
    .replace(/[äöüÄÖÜß&@_]/g, (c) => map[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, max).trim();
}

/** Mandatsreferenz / EndToEndId: max. 35 Zeichen, nur A–Z a–z 0–9 + ? / - : ( ) . , ' (ohne Leerzeichen), nicht mit „/“ beginnen, kein „//“. */
export function isValidMandateRef(ref: string): boolean {
  return /^[A-Za-z0-9+?/\-:().,']{1,35}$/.test(ref) && !ref.startsWith("/") && !ref.includes("//");
}

/** Mandatsreferenz erzeugen: <Präfix>-<Jahr>-<lfd. Nr.> */
export function mandateRefFor(prefix: string, year: number, seq: number): string {
  const p = sepaText(prefix, 12).replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "M";
  return `${p}-${year}-${String(seq).padStart(5, "0")}`;
}

// ---------- Gläubiger-ID ----------

function lettersToDigits(s: string) {
  return s.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
}

function mod97(numeric: string) {
  let r = 0;
  for (const ch of numeric) r = (r * 10 + Number(ch)) % 97;
  return r;
}

/**
 * Gläubiger-ID prüfen: CCPP + Geschäftsbereich (3, nicht in Prüfziffer) + nationale Kennung.
 * Prüfziffer: nationale Kennung + Ländercode + „00“ → Buchstaben zu Zahlen → 98 − (mod 97).
 * Deutschland: 18 Zeichen, z. B. DE98ZZZ09999999999.
 */
export function isValidCreditorId(raw: string): boolean {
  const id = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(id)) return false;
  if (id.startsWith("DE") && id.length !== 18) return false;
  const country = id.slice(0, 2);
  const check = Number(id.slice(2, 4));
  const national = id.slice(7);
  const expected = 98 - mod97(lettersToDigits(national + country + "00"));
  return check === expected;
}

// ---------- TARGET2-Bankarbeitstage ----------

/** Ostersonntag (Gauß/Meeus). */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** TARGET2-Schließtage: Wochenende, Neujahr, Karfreitag, Ostermontag, 1. Mai, 25. + 26. Dezember. */
export function isTargetBusinessDay(d: Date): boolean {
  const x = dateOnly(d);
  const wd = x.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  const y = x.getUTCFullYear(), md = isoDay(x).slice(5);
  if (["01-01", "05-01", "12-25", "12-26"].includes(md)) return false;
  const easter = easterSunday(y);
  if (isoDay(x) === isoDay(addDays(easter, -2)) || isoDay(x) === isoDay(addDays(easter, 1))) return false;
  return true;
}

export function addBusinessDays(d: Date, n: number): Date {
  let x = dateOnly(d);
  let left = n;
  while (left > 0) {
    x = addDays(x, 1);
    if (isTargetBusinessDay(x)) left--;
  }
  return x;
}

export function nextBusinessDayOnOrAfter(d: Date): Date {
  let x = dateOnly(d);
  while (!isTargetBusinessDay(x)) x = addDays(x, 1);
  return x;
}

/**
 * Frühestmögliches Einzugsdatum: Einreichung heute → Fälligkeit frühestens 1 TARGET2-Tag später (CORE und B2B, seit 11/2016).
 * Zusätzlich die Vorabankündigung (Standard 14 Kalendertage) ab Rechnungs-/Ankündigungsdatum beachten.
 */
export function earliestCollectionDate(submitDay: Date, preNotifiedOn: Date | null, preNotificationDays = 14): Date {
  const byLead = addBusinessDays(submitDay, 1);
  const byNotice = preNotifiedOn ? addDays(preNotifiedOn, preNotificationDays) : byLead;
  return nextBusinessDayOnOrAfter(byNotice > byLead ? byNotice : byLead);
}

// ---------- pain.008.001.08 ----------

export type Pain008Tx = {
  endToEndId: string;
  amountCents: number;
  mandateRef: string;
  mandateSignedAt: Date;
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  remittance: string;
  sequence: "FRST" | "RCUR" | "OOFF" | "FNAL";
  scheme: "CORE" | "B2B";
};

export type Pain008Input = {
  messageId: string;
  createdAt: Date;
  initiatorName: string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  creditorId: string;
  collectionDate: Date;
  transactions: Pain008Tx[];
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const amount = (cents: number) => (cents / 100).toFixed(2);

function agent(bic?: string | null) {
  const b = bic?.replace(/\s+/g, "").toUpperCase();
  return b && /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b) ? `<FinInstnId><BICFI>${b}</BICFI></FinInstnId>` : `<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;
}

/** Gruppierung je Sequenztyp und Verfahren (eine PmtInf je Gruppe), Summen als Kontrollsumme. */
export function groupTransactions(txs: Pain008Tx[]) {
  const groups = new Map<string, Pain008Tx[]>();
  for (const t of txs) {
    const k = `${t.scheme}|${t.sequence}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()].map(([k, list]) => {
    const [scheme, sequence] = k.split("|");
    return { scheme, sequence, list, sumCents: list.reduce((s, t) => s + t.amountCents, 0) };
  });
}

export function buildPain008(input: Pain008Input): string {
  if (!input.transactions.length) throw new Error("Keine Lastschriften im Stapel.");
  for (const t of input.transactions) {
    if (t.amountCents <= 0 || t.amountCents > 99999999999) throw new Error(`Ungültiger Betrag (${t.endToEndId}).`);
    if (!isValidMandateRef(t.mandateRef)) throw new Error(`Ungültige Mandatsreferenz ${t.mandateRef}.`);
    if (!isValidMandateRef(t.endToEndId)) throw new Error(`Ungültige End-to-End-ID ${t.endToEndId}.`);
    if (!isValidIban(t.debtorIban)) throw new Error(`Ungültige IBAN des Zahlers (${t.endToEndId}).`);
  }
  if (!isValidCreditorId(input.creditorId)) throw new Error("Gläubiger-ID ist ungültig.");
  if (!isValidIban(input.creditorIban)) throw new Error("Eigene IBAN ist ungültig.");
  const groups = groupTransactions(input.transactions);
  const total = input.transactions.reduce((s, t) => s + t.amountCents, 0);
  const created = input.createdAt.toISOString().replace(/\.\d{3}Z$/, "");
  const msgId = sepaText(input.messageId, 35).replace(/\s/g, "");

  const pmtInfs = groups
    .map((g, i) => {
      const txs = g.list
        .map(
          (t) => `
      <DrctDbtTxInf>
        <PmtId><EndToEndId>${esc(t.endToEndId)}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${amount(t.amountCents)}</InstdAmt>
        <DrctDbtTx><MndtRltdInf><MndtId>${esc(t.mandateRef)}</MndtId><DtOfSgntr>${isoDay(t.mandateSignedAt)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
        <DbtrAgt>${agent(t.debtorBic)}</DbtrAgt>
        <Dbtr><Nm>${esc(sepaText(t.debtorName, 70))}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${normalizeIban(t.debtorIban)}</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>${esc(sepaText(t.remittance, 140))}</Ustrd></RmtInf>
      </DrctDbtTxInf>`,
        )
        .join("");
      return `
    <PmtInf>
      <PmtInfId>${esc(`${msgId}-${i + 1}`.slice(0, 35))}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${g.list.length}</NbOfTxs>
      <CtrlSum>${amount(g.sumCents)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>${g.scheme}</Cd></LclInstrm><SeqTp>${g.sequence}</SeqTp></PmtTpInf>
      <ReqdColltnDt>${isoDay(input.collectionDate)}</ReqdColltnDt>
      <Cdtr><Nm>${esc(sepaText(input.creditorName, 70))}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${normalizeIban(input.creditorIban)}</IBAN></Id></CdtrAcct>
      <CdtrAgt>${agent(input.creditorBic)}</CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId><Id><PrvtId><Othr><Id>${esc(input.creditorId.replace(/\s+/g, "").toUpperCase())}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>${txs}
    </PmtInf>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${PAIN008_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(msgId)}</MsgId>
      <CreDtTm>${created}</CreDtTm>
      <NbOfTxs>${input.transactions.length}</NbOfTxs>
      <CtrlSum>${amount(total)}</CtrlSum>
      <InitgPty><Nm>${esc(sepaText(input.initiatorName, 70))}</Nm></InitgPty>
    </GrpHdr>${pmtInfs}
  </CstmrDrctDbtInitn>
</Document>
`;
}

/** Häufige Rückgabegründe (R-Transaktionen) nach ISO-Reasoncode. */
export const RETURN_REASONS: Record<string, string> = {
  AC04: "Konto erloschen",
  AC06: "Konto gesperrt",
  AM04: "Deckung unzureichend",
  MD01: "Kein gültiges Mandat",
  MD06: "Rückgabe auf Verlangen des Zahlers (Widerspruch)",
  MS02: "Grund nicht angegeben (Zahler)",
  MS03: "Grund nicht angegeben (Bank)",
  SL01: "Spezifischer Dienst der Zahlstelle",
};

export type DebitSequence = "FRST" | "RCUR" | "OOFF";

/**
 * Sequenztyp einer Lastschrift: einmalige Abos (one_time) sind Einmallastschriften (OOFF),
 * sonst FRST bis zur ersten erfolgreichen Einreichung des Mandats, danach RCUR.
 */
export function debitSequence(mandateSequence: string, subscriptionInterval?: string | null): DebitSequence {
  if (subscriptionInterval === "one_time") return "OOFF";
  return mandateSequence === "RCUR" ? "RCUR" : "FRST";
}

/** Gespeicherten Sequenztyp einer Position für pain.008 lesen (unbekannt → FRST). */
export function storedSequence(s: string): DebitSequence {
  return s === "RCUR" || s === "OOFF" ? s : "FRST";
}
