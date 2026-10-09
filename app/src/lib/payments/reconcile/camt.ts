// CAMT-Kontoauszüge lesen: camt.053 (Tagesauszug) und camt.054 (Soll-/Haben-Avis), Versionen .001.02 bis .001.08.
// Grundlage: ISO 20022 / DK-Spezifikation „Datenformate“ Anlage 3. Nur gebuchte Umsätze (Status BOOK).
// Sammelbuchungen mit Einzelumsätzen (TxDtls) werden in Einzelposten zerlegt.
import { createHash } from "node:crypto";
import { child, children, parseXml, text, XmlError, type XmlNode } from "./xml";
import { decimalToCents } from "../http";

export type BankTxInput = {
  externalId: string;
  bookingDate: string; // YYYY-MM-DD
  amountCents: number; // positiv = Eingang
  currency: string;
  counterparty: string | null;
  counterpartyIbanLast4: string | null;
  remittance: string | null;
  endToEndId: string | null;
  mandateRef: string | null;
  /** Rücklastschrift/Rückgabe erkannt; Grund (z. B. AC04, MD06) falls angegeben */
  isReturn: boolean;
  returnReason: string | null;
};

export type CamtStatement = { kind: "camt.053" | "camt.054"; version: string; ibanLast4: string | null; currency: string; entries: BankTxInput[] };

const RETURN_SUBFAMILIES = new Set(["UPDD", "RRTN", "PRDD", "ARET"]);
// Deutsche Geschäftsvorfallcodes (GVC) für Rückgaben: 108/109 Lastschrift-Rückgabe, 159 Überweisungs-Retoure
const RETURN_GVC = /\+(108|109|159)\b/;

const ibanLast4 = (iban?: string) => (iban ? iban.replace(/\s+/g, "").slice(-4).toUpperCase() : null);
const clean = (s?: string | null) => (s ? s.replace(/\s+/g, " ").trim() : null) || null;

function party(n: XmlNode | undefined) {
  // camt .02: Dbtr/Nm · ab .08: Dbtr/Pty/Nm
  return text(n, "Nm") ?? text(n, "Pty", "Nm") ?? null;
}

function remittanceOf(n: XmlNode | undefined): string | null {
  const rmt = child(n, "RmtInf");
  const parts = [...children(rmt, "Ustrd").map((u) => u.text.trim())];
  for (const s of children(rmt, "Strd")) {
    const ref = text(s, "CdtrRefInf", "Ref");
    if (ref) parts.push(ref);
    const add = children(s, "AddtlRmtInf").map((a) => a.text.trim());
    parts.push(...add);
  }
  return clean(parts.filter(Boolean).join(" "));
}

function bookingDateOf(ntry: XmlNode): string | null {
  const d = text(ntry, "BookgDt", "Dt") ?? text(ntry, "BookgDt", "DtTm") ?? text(ntry, "ValDt", "Dt") ?? text(ntry, "ValDt", "DtTm");
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

function isBooked(ntry: XmlNode) {
  const s = text(ntry, "Sts") ?? text(ntry, "Sts", "Cd");
  return !s || s === "BOOK";
}

export function parseCamt(xml: string): CamtStatement {
  const doc = parseXml(xml);
  const document = doc.children.find((c) => c.name === "Document");
  if (!document) throw new XmlError("Kein CAMT-Dokument (Element Document fehlt).");
  const ns = document.attrs["xmlns"] ?? Object.entries(document.attrs).find(([k]) => k.startsWith("xmlns"))?.[1] ?? "";
  const ver = /camt\.(05[34])\.001\.(\d{2})/.exec(ns);
  const body = child(document, "BkToCstmrStmt") ?? child(document, "BkToCstmrDbtCdtNtfctn");
  if (!body) throw new XmlError("Weder camt.053 (BkToCstmrStmt) noch camt.054 (BkToCstmrDbtCdtNtfctn).");
  const kind = body.name === "BkToCstmrStmt" ? "camt.053" : "camt.054";
  const reports = [...children(body, "Stmt"), ...children(body, "Ntfctn")];
  let iban: string | null = null;
  let currency = "EUR";
  const entries: BankTxInput[] = [];
  const seen = new Map<string, number>();

  for (const rep of reports) {
    iban = iban ?? ibanLast4(text(rep, "Acct", "Id", "IBAN"));
    currency = text(rep, "Acct", "Ccy") ?? currency;
    for (const ntry of children(rep, "Ntry")) {
      if (!isBooked(ntry)) continue;
      const date = bookingDateOf(ntry);
      if (!date) continue;
      const amtNode = child(ntry, "Amt");
      const ccy = amtNode?.attrs["Ccy"] ?? currency;
      const credit = text(ntry, "CdtDbtInd") === "CRDT";
      const entryCents = decimalToCents(amtNode?.text.trim());
      const subFam = text(ntry, "BkTxCd", "Domn", "Fmly", "SubFmlyCd");
      const prtry = text(ntry, "BkTxCd", "Prtry", "Cd") ?? "";
      const entryReturn = (subFam ? RETURN_SUBFAMILIES.has(subFam) : false) || RETURN_GVC.test(prtry);
      const entryRef = text(ntry, "AcctSvcrRef") ?? text(ntry, "NtryRef");
      const addtl = text(ntry, "AddtlNtryInf");
      const txs = children(child(ntry, "NtryDtls"), "TxDtls").length
        ? children(ntry, "NtryDtls").flatMap((d) => children(d, "TxDtls"))
        : [undefined];

      txs.forEach((tx, idx) => {
        const txAmt = tx ? (child(tx, "AmtDtls", "TxAmt", "Amt") ?? child(tx, "Amt")) : undefined;
        const cents = txs.length > 1 && txAmt ? decimalToCents(txAmt.text.trim()) : entryCents;
        const signed = credit ? cents : -cents;
        const txCredit = tx ? (text(tx, "CdtDbtInd") ?? (credit ? "CRDT" : "DBIT")) === "CRDT" : credit;
        // Gegenpartei: bei Eingang der Zahler (Dbtr), bei Ausgang der Empfänger (Cdtr); Rückgaben haben oft nur Dbtr
        const rp = child(tx, "RltdPties");
        const cpName = txCredit ? (party(child(rp, "Dbtr")) ?? party(child(rp, "UltmtDbtr"))) : (party(child(rp, "Cdtr")) ?? party(child(rp, "Dbtr")));
        const cpIban = txCredit ? text(rp, "DbtrAcct", "Id", "IBAN") : (text(rp, "CdtrAcct", "Id", "IBAN") ?? text(rp, "DbtrAcct", "Id", "IBAN"));
        const e2e = text(tx, "Refs", "EndToEndId");
        const rtrCode = text(tx, "RtrInf", "Rsn", "Cd") ?? text(tx, "RtrInf", "Rsn", "Prtry");
        const remittance = remittanceOf(tx) ?? clean(text(tx, "AddtlTxInf")) ?? clean(addtl);
        const txRef = text(tx, "Refs", "AcctSvcrRef") ?? text(tx, "Refs", "TxId");
        let externalId: string;
        if (txRef) externalId = `ref:${txRef}`;
        else if (entryRef) externalId = `ref:${entryRef}${txs.length > 1 ? `#${idx}` : ""}`;
        else {
          // Ohne Bank-Referenz: stabiler Hash aus Inhalt; gleiche Umsätze am selben Tag werden durchnummeriert
          const base = createHash("sha256").update([iban, date, signed, ccy, e2e ?? "", remittance ?? "", cpIban ?? ""].join("|")).digest("hex").slice(0, 32);
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          externalId = `h:${base}:${n}`;
        }
        entries.push({
          externalId,
          bookingDate: date,
          amountCents: signed,
          currency: ccy,
          counterparty: clean(cpName)?.slice(0, 200) ?? null,
          counterpartyIbanLast4: ibanLast4(cpIban),
          remittance: remittance?.slice(0, 1000) ?? null,
          endToEndId: e2e && e2e !== "NOTPROVIDED" ? e2e.slice(0, 64) : null,
          mandateRef: text(tx, "Refs", "MndtId") ?? null,
          isReturn: entryReturn || Boolean(rtrCode),
          returnReason: rtrCode ?? null,
        });
      });
    }
  }
  return { kind, version: ver ? `${ver[1] === "053" ? "camt.053" : "camt.054"}.001.${ver[2]}` : kind, ibanLast4: iban, currency, entries };
}
