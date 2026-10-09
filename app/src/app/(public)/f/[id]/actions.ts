"use server";

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { rateLimitAsync } from "@/lib/ratelimit";
import { clientIp } from "@/lib/client-ip";
import { doiUrl } from "@/lib/b-doi";
import { parseFields, submissionSchema } from "@/lib/b-forms";
import { sendMail } from "@/lib/mail";
import { errMessage, log } from "@/lib/log";
import { env } from "@/lib/env";
import { verifyFormTimestamp } from "@/lib/trust";
import { recentSubmissions, scoreContact } from "@/lib/agent-leads";
import { fireTrigger } from "@/lib/automation";
import { recordConversion } from "@/lib/analytics/track";

export type SubmitState = { status: "idle" | "ok" | "error"; message?: string };

const CONTACT_KEYS = ["firstName", "lastName", "phone", "company"] as const;

// Öffentliche Einsendung. Antwortet immer gleich, egal ob der Kontakt schon existiert.
export async function submitForm(formId: string, _prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const OK: SubmitState = { status: "ok", message: "Danke! Ihre Angaben sind eingegangen." };
  const h = await headers();
  const ip = clientIp(h);
  if (!await rateLimitAsync(`form:${ip}`, 10, 10 * 60_000)) {
    return { status: "error", message: "Zu viele Einsendungen. Bitte versuchen Sie es später erneut." };
  }
  const form = await db.form.findUnique({ where: { id: formId } });
  if (!form) return { status: "error", message: "Formular nicht gefunden." };

  // Honeypot: Bots füllen das versteckte Feld aus → stillschweigend verwerfen.
  if (String(formData.get("website_url") ?? "") !== "") return OK;

  const fields = parseFields(form.fields);
  const raw: Record<string, string> = {};
  for (const f of fields) {
    const v = formData.get(f.key);
    raw[f.key] = typeof v === "string" ? v.trim() : "";
  }
  const parsed = submissionSchema(fields).safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0].message };
  const data = parsed.data as Record<string, string | undefined>;

  const emailField = fields.find((f) => f.key === "email" && f.type === "email") ?? fields.find((f) => f.type === "email");
  const email = emailField ? data[emailField.key]?.toLowerCase() || null : null;
  const wantsConsent = !!form.consentText && formData.get("consent") === "on" && !!email;

  const contactData: Record<string, string> = {};
  for (const k of CONTACT_KEYS) {
    const v = data[k];
    if (v) contactData[k] = v.slice(0, 200);
  }

  let contactId: string;
  if (email) {
    const existing = await db.contact.findUnique({ where: { workspaceId_email: { workspaceId: form.workspaceId, email } } });
    if (existing) {
      // Öffentliche Eingaben überschreiben keine vorhandenen Daten, sie ergänzen nur Lücken.
      const fill = Object.fromEntries(Object.entries(contactData).filter(([k]) => !existing[k as (typeof CONTACT_KEYS)[number]]));
      if (Object.keys(fill).length) await db.contact.update({ where: { id: existing.id }, data: fill });
      contactId = existing.id;
    } else {
      const c = await db.contact.create({
        data: { workspaceId: form.workspaceId, email, source: `Formular: ${form.name}`.slice(0, 200), ...contactData },
      });
      contactId = c.id;
    }
  } else {
    const c = await db.contact.create({
      data: { workspaceId: form.workspaceId, source: `Formular: ${form.name}`.slice(0, 200), ...contactData },
    });
    contactId = c.id;
  }

  await db.formSubmission.create({ data: { formId: form.id, contactId, data: { ...data, consentRequested: wantsConsent } } });
  await db.activity.create({
    data: {
      workspaceId: form.workspaceId,
      contactId,
      type: "FORM",
      body: `Formular „${form.name}“ ausgefüllt${wantsConsent ? " (Einwilligung angefragt)" : ""}`,
      meta: { formId: form.id },
    },
  });

  // Lead-Echtheit, Automationen und Conversion – dürfen die Einsendung nie scheitern lassen
  const tsRaw = formData.get("_ts");
  await scoreContact(contactId, {
    email,
    elapsedMs: verifyFormTimestamp(env.appSecret(), form.id, typeof tsRaw === "string" ? tsRaw : null),
    userAgent: h.get("user-agent"),
    recentCount: Math.max(0, (await recentSubmissions(contactId)) - 1),
  });
  await fireTrigger(form.workspaceId, "FORM_SUBMITTED", { contactId, formId: form.id });
  await recordConversion({ workspaceId: form.workspaceId, path: `/f/${form.id}`, headers: h, contactId, name: "form_submit" });

  if (wantsConsent && email) {
    const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
    const alreadyConfirmed = contact.consentEmailAt && !contact.unsubscribedAt;
    // Höchstens eine DOI-Mail pro Adresse und Stunde (Schutz vor Missbrauch des Formulars)
    if (!alreadyConfirmed && await rateLimitAsync(`doi:${form.workspaceId}:${email}`, 1, 60 * 60_000)) {
      try {
        await sendMail({
          workspaceId: form.workspaceId,
          to: email,
          contactId,
          subject: "Bitte bestätigen Sie Ihre Anmeldung",
          text:
            `Hallo,\n\nSie haben sich mit dieser E-Mail-Adresse angemeldet:\n\n„${form.consentText}“\n\n` +
            `Bitte bestätigen Sie die Anmeldung über diesen Link (7 Tage gültig):\n${doiUrl(contactId, form.id)}\n\n` +
            `Wenn Sie das nicht waren, ignorieren Sie diese E-Mail einfach. Ohne Bestätigung erhalten Sie keine weiteren E-Mails.`,
        });
      } catch (e) {
        // Nicht an Besucher weitergeben, aber im Protokoll festhalten.
        // Strukturiert und ohne Empfängeradresse (log maskiert E-Mail-Adressen in Fehlertexten)
        log.error("doi mail failed", { workspaceId: form.workspaceId, error: errMessage(e) });
        await db.activity.create({
          data: { workspaceId: form.workspaceId, contactId, type: "SYSTEM", body: "DOI-Bestätigungsmail konnte nicht gesendet werden" },
        });
      }
    }
    return { status: "ok", message: "Danke! Bitte bestätigen Sie Ihre Anmeldung über den Link in der E-Mail, die wir Ihnen gerade geschickt haben." };
  }
  return OK;
}
