"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardOrRedirect } from "@/lib/permissions/guard";
import { sendMail } from "@/lib/mail";
import { renderTemplate } from "@/lib/mail-template";
import { senderDomainAllowed } from "@/lib/mail-schema";

const q = (s: string) => encodeURIComponent(s);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

const schema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(120),
  subject: z.string().trim().min(1, "Betreff fehlt").max(300),
  html: z.string().min(1, "HTML fehlt").max(500_000),
  text: z.string().max(200_000).optional(),
  senderName: z.string().trim().max(120).optional(),
  senderEmail: z.union([z.literal(""), z.email().max(254)]).optional(),
  replyTo: z.union([z.literal(""), z.email().max(254)]).optional(),
});

export async function saveTemplate(slug: string, id: string | null, formData: FormData) {
  const back = id ? `/sa/${slug}/email/vorlagen/${id}` : `/sa/${slug}/email/vorlagen`;
  const { ws } = await guardOrRedirect(slug, { object: "email", action: "edit" }, back);
  const p = schema.safeParse(Object.fromEntries(formData));
  if (!p.success) redirect(`${back}?fehler=${q(p.error.issues[0].message)}`);
  const d = p.data;
  if (d.senderEmail && !senderDomainAllowed(d.senderEmail, ws.domain, ws.allowedOrigins)) {
    redirect(`${back}?fehler=${q(`Absender muss zur Domain ${ws.domain ?? ""} oder einer erlaubten Domain gehören`)}`);
  }
  const data = {
    name: d.name,
    subject: d.subject,
    html: d.html,
    text: d.text?.trim() ? d.text : null,
    senderName: d.senderName || null,
    senderEmail: d.senderEmail || null,
    replyTo: d.replyTo || null,
  };
  if (id) {
    const res = await db.emailTemplate.updateMany({ where: { id, workspaceId: ws.id }, data });
    if (res.count === 0) redirect(`/sa/${slug}/email/vorlagen?fehler=${q("Vorlage nicht gefunden")}`);
    redirect(`${back}?ok=${q("Gespeichert")}`);
  }
  const t = await db.emailTemplate.create({ data: { ...data, workspaceId: ws.id } });
  redirect(`/sa/${slug}/email/vorlagen/${t.id}?ok=${q(`Vorlage #${t.numericId} angelegt`)}`);
}

export async function toggleTemplate(slug: string, id: string) {
  const { ws } = await guardOrRedirect(slug, { object: "email", action: "edit" }, `/sa/${slug}/email/vorlagen/${id}`);
  const t = await db.emailTemplate.findFirst({ where: { id, workspaceId: ws.id } });
  if (t) await db.emailTemplate.update({ where: { id: t.id }, data: { isActive: !t.isActive } });
  redirect(`/sa/${slug}/email/vorlagen/${id}?ok=${q(t?.isActive ? "Deaktiviert" : "Aktiviert")}`);
}

export async function deleteTemplate(slug: string, id: string) {
  const { ws } = await guardOrRedirect(slug, { object: "email", action: "delete" }, `/sa/${slug}/email/vorlagen/${id}`);
  await db.emailTemplate.deleteMany({ where: { id, workspaceId: ws.id } });
  redirect(`/sa/${slug}/email/vorlagen?ok=${q("Vorlage gelöscht")}`);
}

/** Testversand an die eigene Adresse des angemeldeten Benutzers, mit Beispielwerten. */
export async function sendTestTemplate(slug: string, id: string, formData: FormData) {
  const back = `/sa/${slug}/email/vorlagen/${id}`;
  const { ws, user } = await guardOrRedirect(slug, { object: "email", action: "edit" }, back);
  const t = await db.emailTemplate.findFirst({ where: { id, workspaceId: ws.id } });
  if (!t) redirect(`/sa/${slug}/email/vorlagen?fehler=${q("Vorlage nicht gefunden")}`);
  let params: Record<string, unknown> = {};
  const raw = String(formData.get("params") ?? "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      params = parsed;
    } catch {
      redirect(`${back}?fehler=${q("Beispielwerte sind kein gültiges JSON-Objekt")}`);
    }
  }
  const ctx = { params, contact: { FIRSTNAME: user.name.split(" ")[0] ?? "", LASTNAME: user.name.split(" ").slice(1).join(" "), EMAIL: user.email } };
  let error: string | null = null;
  try {
    await sendMail({
      workspaceId: ws.id,
      to: user.email,
      subject: `[Test] ${renderTemplate(t.subject, ctx, { html: false })}`,
      text: t.text ? renderTemplate(t.text, ctx, { html: false }) : "",
      html: renderTemplate(t.html, ctx, { html: true }),
      kind: "system",
    });
  } catch (e) {
    error = errMsg(e);
  }
  redirect(`${back}?${error ? `fehler=${q(error)}` : `ok=${q(`Testmail an ${user.email} gesendet`)}`}`);
}
