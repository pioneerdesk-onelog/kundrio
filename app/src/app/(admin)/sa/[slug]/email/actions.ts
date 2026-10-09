"use server";


import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { campaignAudience, sendMail } from "@/lib/mail";
import { enqueue } from "@/lib/jobs";
import { can } from "@/lib/permissions";
import { guardOrRedirect } from "@/lib/permissions/guard";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const q = (s: string) => encodeURIComponent(s);

const singleSchema = z.object({
  contactId: z.string().min(1, "Kontakt wählen"),
  subject: z.string().trim().min(1, "Betreff fehlt").max(200),
  text: z.string().trim().min(1, "Text fehlt").max(20000),
});

export async function sendSingleMail(slug: string, formData: FormData) {
  const { ws, access } = await guardOrRedirect(slug, { object: "email", action: "edit" }, `/sa/${slug}/email`);
  const parsed = singleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/sa/${slug}/email?fehler=${q(parsed.error.issues[0].message)}`);
  const contact = await db.contact.findFirst({ where: { id: parsed.data.contactId, workspaceId: ws.id } });
  if (!contact || !can(access, "contacts", "read", contact.ownerId)) redirect(`/sa/${slug}/email?fehler=${q("Kontakt nicht gefunden")}`);
  if (!contact.email) redirect(`/sa/${slug}/email?fehler=${q("Kontakt ohne E-Mail-Adresse")}`);

  let error: string | null = null;
  try {
    await sendMail({ workspaceId: ws.id, to: contact.email, subject: parsed.data.subject, text: parsed.data.text, contactId: contact.id });
  } catch (e) {
    error = errMsg(e);
  }
  redirect(error ? `/sa/${slug}/email?fehler=${q(error)}` : `/sa/${slug}/email?ok=${q("E-Mail gesendet")}`);
}

const campaignSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(120),
  subject: z.string().trim().min(1, "Betreff fehlt").max(200),
  bodyMarkdown: z.string().trim().min(1, "Text fehlt").max(50000),
  tags: z.string().max(500).optional(),
});

function parseTags(raw?: string) {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Anlegen oder Bearbeiten. Jede Bearbeitung setzt die Kampagne zurück auf DRAFT (Freigabe erlischt). */
export async function saveCampaign(slug: string, campaignId: string | null, formData: FormData) {
  const { ws } = await guardOrRedirect(slug, { object: "email", action: "edit" }, `/sa/${slug}/email`);
  const back = campaignId ? `/sa/${slug}/email/kampagne/${campaignId}` : `/sa/${slug}/email/kampagne/neu`;
  const parsed = campaignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?fehler=${q(parsed.error.issues[0].message)}`);
  // Listen nur aus dem eigenen Workspace übernehmen
  const wantedLists = formData.getAll("listIds").map(String).filter(Boolean).slice(0, 50);
  const listIds = wantedLists.length
    ? (await db.contactList.findMany({ where: { workspaceId: ws.id, id: { in: wantedLists } }, select: { id: true } })).map((l) => l.id)
    : [];
  const data = {
    name: parsed.data.name,
    subject: parsed.data.subject,
    bodyMarkdown: parsed.data.bodyMarkdown,
    audience: { tags: parseTags(parsed.data.tags), listIds },
  };

  if (!campaignId) {
    const c = await db.campaign.create({ data: { ...data, workspaceId: ws.id } });
    redirect(`/sa/${slug}/email/kampagne/${c.id}`);
  }

  const updated = await db.campaign.updateMany({
    where: { id: campaignId, workspaceId: ws.id, status: { in: ["DRAFT", "APPROVED"] } },
    data: { ...data, status: "DRAFT", approvedAt: null, approvedBy: null },
  });
  if (updated.count === 0) redirect(`${back}?fehler=${q("Kampagne kann nicht mehr bearbeitet werden")}`);
  redirect(`${back}?ok=${q("Gespeichert – Freigabe erforderlich")}`);
}

export async function approveCampaign(slug: string, campaignId: string, formData: FormData) {
  const back = `/sa/${slug}/email/kampagne/${campaignId}`;
  // Freigabe einer Kampagne = Außenwirkung → Sonderrecht „Freigaben erteilen“
  const { ws, user } = await guardOrRedirect(slug, { special: "approve" }, back);
  const c = await db.campaign.findFirst({ where: { id: campaignId, workspaceId: ws.id } });
  if (!c) redirect(`/sa/${slug}/email?fehler=${q("Kampagne nicht gefunden")}`);
  if (c.status !== "DRAFT") redirect(`${back}?fehler=${q("Nur Entwürfe können freigegeben werden")}`);
  if (formData.get("confirm") !== "on") redirect(`${back}?fehler=${q("Bitte die Freigabe ausdrücklich bestätigen")}`);

  const expected = Number(formData.get("expected"));
  const audience = await campaignAudience(ws.id, c.audience);
  if (audience.length === 0) redirect(`${back}?fehler=${q("Keine Empfänger mit Einwilligung")}`);
  if (expected !== audience.length) {
    redirect(`${back}?fehler=${q(`Empfängerzahl hat sich geändert (jetzt ${audience.length}). Bitte erneut prüfen.`)}`);
  }

  await db.campaign.updateMany({
    where: { id: campaignId, workspaceId: ws.id, status: "DRAFT" },
    data: { status: "APPROVED", approvedAt: new Date(), approvedBy: user.name },
  });
  redirect(`${back}?ok=${q(`Freigegeben für ${audience.length} Empfänger`)}`);
}

export async function sendCampaignNow(slug: string, campaignId: string) {
  const back = `/sa/${slug}/email/kampagne/${campaignId}`;
  const { ws } = await guardOrRedirect(slug, { special: "send_campaigns" }, back);
  const c = await db.campaign.findFirst({ where: { id: campaignId, workspaceId: ws.id }, select: { id: true } });
  if (!c) redirect(`/sa/${slug}/email?fehler=${q("Kampagne nicht gefunden")}`);

  // Versand läuft im Hintergrund-Worker (npm run worker), nicht im Request
  const claimed = await db.campaign.count({ where: { id: c.id, status: "APPROVED", approvedAt: { not: null } } });
  if (!claimed) redirect(`${back}?fehler=${q("Kampagne ist nicht freigegeben")}`);
  await enqueue("campaign.send", { campaignId: c.id });
  redirect(`${back}?ok=${q("Versand gestartet. Der Status aktualisiert sich, sobald der Worker sendet.")}`);
}

export async function deleteCampaign(slug: string, campaignId: string) {
  const { ws } = await guardOrRedirect(slug, { object: "email", action: "delete" }, `/sa/${slug}/email/kampagne/${campaignId}`);
  await db.campaign.deleteMany({ where: { id: campaignId, workspaceId: ws.id, status: { in: ["DRAFT", "APPROVED"] } } });
  redirect(`/sa/${slug}/email`);
}
