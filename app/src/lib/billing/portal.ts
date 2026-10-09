import "server-only";
import { db } from "../db";
import { env } from "../env";
import { sendMail } from "../mail";
import { parseItems } from "../invoice";
import { portalToken, verifyPortalToken } from "./crypto";
import { BillingError, cancelSubscription } from "./service";

// Kundenportal-Links: signiert je Kontakt, widerrufbar über eine Versionsnummer (AppSetting).

const key = (contactId: string) => `billing:portal:${contactId}`;

export async function portalVersion(contactId: string) {
  const s = await db.appSetting.findUnique({ where: { key: key(contactId) } });
  return ((s?.value ?? {}) as { version?: number }).version ?? 1;
}

export async function portalUrl(contactId: string) {
  return `${env.appUrl()}/kundenportal/${portalToken(contactId, await portalVersion(contactId))}`;
}

/** Kontakt zum Token – nur wenn Signatur und aktuelle Version passen. */
export async function contactForPortalToken(token: string) {
  const v = verifyPortalToken(token);
  if (!v) return null;
  if (v.version !== (await portalVersion(v.contactId))) return null;
  return db.contact.findUnique({ where: { id: v.contactId }, include: { workspace: true } });
}

// ---------- Kündigungsbutton (§ 312k BGB) ----------

export type PortalCancelInput = { name: string; email: string; kind: "ordentlich" | "ausserordentlich"; reason: string; wishDate: string };

const fmt = (d: Date, time = false) =>
  new Intl.DateTimeFormat("de-DE", time ? { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" } : { dateStyle: "long", timeZone: "UTC" }).format(d);

/**
 * Kündigung durch den Kunden über das Portal. Bestätigung des Eingangs sofort per E-Mail (Textform) mit Inhalt, Datum
 * und Uhrzeit sowie dem Vertragsende. Außerordentliche Kündigungen werden zusätzlich als Aufgabe zur Prüfung angelegt.
 */
export async function portalCancel(token: string, subscriptionId: string, input: PortalCancelInput) {
  const contact = await contactForPortalToken(token);
  if (!contact) throw new BillingError("Der Link ist ungültig.");
  const sub = await db.subscription.findFirst({ where: { id: subscriptionId, contactId: contact.id, workspaceId: contact.workspaceId } });
  if (!sub) throw new BillingError("Vertrag nicht gefunden.");
  const receivedAt = new Date();
  const r = await cancelSubscription(contact.workspaceId, sub.id, `customer:${contact.id}`, { requestedAt: receivedAt, via: "customer" });
  const effective = r.effective ?? receivedAt;
  if (input.kind === "ausserordentlich") {
    await db.task.create({
      data: { workspaceId: contact.workspaceId, contactId: contact.id, ownerId: contact.ownerId, title: `Außerordentliche Kündigung prüfen: ${input.reason.slice(0, 150)}`, dueAt: new Date(Date.now() + 2 * 864e5) },
    });
  }
  const ws = contact.workspace;
  const items = parseItems(sub.items).map((i) => i.title).join(", ");
  const text = [
    `Guten Tag ${input.name},`,
    "",
    `wir bestätigen den Eingang Ihrer Kündigung am ${fmt(receivedAt, true)} Uhr.`,
    "",
    `Vertrag: ${items}`,
    `Art der Kündigung: ${input.kind === "ordentlich" ? "ordentliche Kündigung" : `außerordentliche Kündigung (Grund: ${input.reason})`}`,
    input.wishDate ? `Gewünschter Zeitpunkt: ${input.wishDate}` : "Gewünschter Zeitpunkt: zum nächstmöglichen Termin",
    `Der Vertrag endet zum ${fmt(effective)}.${input.kind === "ausserordentlich" ? " Ihre außerordentliche Kündigung prüfen wir und melden uns, falls sie früher wirksam wird." : ""}`,
    "",
    "Freundliche Grüße",
    ws.legalName ?? ws.name,
  ].join("\n");
  let mailed = true;
  try {
    await sendMail({ workspaceId: ws.id, to: input.email, subject: `Eingangsbestätigung Ihrer Kündigung – ${ws.legalName ?? ws.name}`, text, contactId: contact.id, kind: "one_to_one" });
  } catch {
    mailed = false;
    await db.task.create({ data: { workspaceId: ws.id, contactId: contact.id, ownerId: contact.ownerId, title: `Kündigungsbestätigung an ${input.email} manuell senden (Versand fehlgeschlagen)`, dueAt: new Date() } });
  }
  return { receivedAt, effective, mailed, already: r.already };
}
