"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { fieldsSchema } from "@/lib/b-forms";
import { guard } from "@/lib/permissions/guard";

const q = (s: string) => encodeURIComponent(s);

const formSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(120),
  consentText: z.string().trim().max(1000).optional(),
  fields: z.string().max(20000),
});

export async function saveForm(slug: string, formId: string | null, formData: FormData) {
  const { ws } = await guard(slug, { object: "forms", action: "edit" });
  const back = `/sa/${slug}/formulare${formId ? `/${formId}` : ""}`;
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?fehler=${q(parsed.error.issues[0].message)}`);

  let rawFields: unknown;
  try {
    rawFields = JSON.parse(parsed.data.fields);
  } catch {
    redirect(`${back}?fehler=${q("Felder ungültig")}`);
  }
  const fields = fieldsSchema.safeParse(rawFields);
  if (!fields.success) redirect(`${back}?fehler=${q(fields.error.issues[0].message)}`);
  if (parsed.data.consentText && !fields.data.some((f) => f.type === "email")) {
    redirect(`${back}?fehler=${q("Für eine Einwilligung braucht das Formular ein E-Mail-Feld")}`);
  }

  const data = { name: parsed.data.name, fields: fields.data, consentText: parsed.data.consentText || null };
  if (!formId) {
    const f = await db.form.create({ data: { ...data, workspaceId: ws.id } });
    redirect(`/sa/${slug}/formulare/${f.id}?ok=${q("Formular angelegt")}`);
  }
  const r = await db.form.updateMany({ where: { id: formId, workspaceId: ws.id }, data });
  if (r.count === 0) redirect(`/sa/${slug}/formulare?fehler=${q("Formular nicht gefunden")}`);
  redirect(`${back}?ok=${q("Gespeichert")}`);
}

export async function deleteForm(slug: string, formId: string) {
  const { ws } = await guard(slug, { object: "forms", action: "delete" });
  await db.form.deleteMany({ where: { id: formId, workspaceId: ws.id } });
  redirect(`/sa/${slug}/formulare`);
}
