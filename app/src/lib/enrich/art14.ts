import "server-only";
import { db } from "../db";

// Informationspflicht nach Art. 14 DSGVO (Daten nicht bei der betroffenen Person erhoben).
// Vorlage wird im Sub-Account angelegt; Versand nur manuell bzw. über Freigabe. „Informiert am“ als Aktivität.

export const ART14_TEMPLATE_NAME = "Information nach Art. 14 DSGVO (Anreicherung)";

export function art14Text(ws: { name: string; legalName: string | null; legalAddress: string | null; legalEmail: string | null; mailFromEmail: string | null }) {
  const verantwortlich = [ws.legalName ?? ws.name, ws.legalAddress].filter(Boolean).join(", ");
  const kontakt = ws.legalEmail ?? ws.mailFromEmail ?? "[Kontaktadresse ergänzen]";
  const text = `Guten Tag {{ contact.FIRSTNAME | default: "" }} {{ contact.LASTNAME | default: "" }},

wir informieren Sie gemäß Art. 14 DSGVO darüber, dass wir berufliche Angaben zu Ihrer Person aus öffentlich zugänglichen Quellen verarbeiten.

Verantwortlich: ${verantwortlich || "[Firmierung und Anschrift ergänzen]"}
Kontakt: ${kontakt}

Welche Daten: Name, berufliche Funktion, Unternehmen sowie Links zu öffentlichen beruflichen Profilen (z. B. LinkedIn, XING).
Quellen: die Website Ihres Unternehmens (inkl. Impressum) und öffentlich auffindbare Suchergebnisse.
Zweck: Pflege unserer Geschäftskontakte und Anbahnung bzw. Durchführung geschäftlicher Beziehungen.
Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der Pflege von Geschäftskontakten).
Speicherdauer: solange die Geschäftsbeziehung besteht bzw. bis zu Ihrem Widerspruch.

Ihre Rechte: Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Widerspruch (Art. 21) und Beschwerde bei einer Datenschutz-Aufsichtsbehörde (Art. 77).
Widerspruch: Eine kurze Antwort auf diese E-Mail genügt – wir reichern Ihre Daten dann nicht weiter an.

Freundliche Grüße
${ws.legalName ?? ws.name}`;
  return text;
}

/** Legt die Vorlage im Sub-Account an (idempotent) und liefert ihre numerische ID. */
export async function ensureArt14Template(workspaceId: string) {
  const existing = await db.emailTemplate.findFirst({ where: { workspaceId, name: ART14_TEMPLATE_NAME } });
  if (existing) return existing;
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const text = art14Text(ws);
  const html = `<div style="font-family:sans-serif;white-space:pre-line">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
  return db.emailTemplate.create({
    data: { workspaceId, name: ART14_TEMPLATE_NAME, subject: "Information zur Verarbeitung Ihrer Daten", html, text, source: "enrichment:art14" },
  });
}

/** Zeitpunkt der Art.-14-Information für einen Kontakt (aus Aktivitäten) oder null. */
export async function art14InformedAt(workspaceId: string, contactId: string): Promise<Date | null> {
  const a = await db.activity.findFirst({
    where: { workspaceId, contactId, type: "SYSTEM", meta: { path: ["art14"], equals: true } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return a?.createdAt ?? null;
}

export async function markArt14Informed(workspaceId: string, contactId: string, by: string, how: string) {
  await db.activity.create({
    data: { workspaceId, contactId, type: "SYSTEM", body: `Informiert nach Art. 14 DSGVO (${how})`, meta: { art14: true, by } },
  });
}
