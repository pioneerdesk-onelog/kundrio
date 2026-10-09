"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireAccess } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { formatIban, isValidBic, isValidIban, isValidVatId, normalizeOrigin } from "@/lib/compliance-validators";
import { MAX_SVG_BYTES, sanitizeSvg } from "@/lib/svg-sanitize";

export type SettingsState = { ok?: string; error?: string; fields?: Record<string, string> };

const opt = <T extends z.ZodType<string>>(s: T) => z.union([s, z.literal("")]).optional();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Farbe als #rrggbb");
const FONTS = ["Newsreader", "Inter", "System"] as const;
const LANGS = ["de", "en", "pl", "uk", "tr", "ar", "fr", "it", "es", "nl", "ro"] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(80),
  domain: opt(z.string().trim().toLowerCase().max(253).regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Ungültige Domain (ohne https://)")),
  description: opt(z.string().trim().max(500)),
  mailFromName: opt(z.string().trim().max(80).regex(/^[^"<>\r\n]*$/, "Absendername ohne \" < > und Zeilenumbrüche")),
  mailFromEmail: opt(z.email("Ungültige Absenderadresse").max(254)),
  brandPrimary: hex,
  brandAccent: hex,
  fontHeading: z.enum(FONTS),
  fontBody: z.enum(FONTS),
  region: z.enum(["DE", "EU"]),
  languages: z.array(z.enum(LANGS)).min(1, "Mindestens eine Sprache"),
  allowedOrigins: z.string().max(2000),
  legalName: opt(z.string().trim().max(200)),
  legalAddress: opt(z.string().trim().max(500)),
  legalPhone: opt(z.string().trim().max(40).regex(/^\+?[0-9 ()/.-]{5,40}$/, "Telefonnummer nur mit Ziffern, Leerzeichen, + ( ) / . -")),
  legalEmail: opt(z.email("Ungültige E-Mail-Adresse").max(254)),
  agentApiEnabled: z.boolean(),
  vatId: opt(z.string().trim().max(20).refine(isValidVatId, "USt-IdNr. hat ein ungültiges Format (z. B. DE123456789)")),
  iban: opt(z.string().trim().max(42).refine(isValidIban, "IBAN ist ungültig (Prüfziffer stimmt nicht)")),
  bic: opt(z.string().trim().max(11).refine(isValidBic, "BIC ist ungültig")),
  imprint: opt(z.string().max(5000)),
});

async function requireAdmin(slug: string) {
  const { ws } = await requireAccess(slug, { special: "manage_settings" });
  return ws;
}

export async function saveSettings(slug: string, _prev: SettingsState, formData: FormData): Promise<SettingsState> {
  let ws;
  try {
    ws = await requireAdmin(slug);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const raw = {
    name: str("name"), domain: str("domain"), description: str("description"),
    mailFromName: str("mailFromName"), mailFromEmail: str("mailFromEmail"),
    brandPrimary: str("brandPrimary"), brandAccent: str("brandAccent"),
    fontHeading: str("fontHeading"), fontBody: str("fontBody"), region: str("region"),
    languages: formData.getAll("languages").map(String),
    allowedOrigins: str("allowedOrigins"),
    legalName: str("legalName"), legalAddress: str("legalAddress"), vatId: str("vatId"),
    legalPhone: str("legalPhone"), legalEmail: str("legalEmail"),
    agentApiEnabled: formData.get("agentApiEnabled") === "on",
    iban: str("iban"), bic: str("bic"), imprint: str("imprint"),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[String(i.path[0])] ??= i.message;
    return { error: "Bitte die markierten Felder prüfen.", fields };
  }
  const d = parsed.data;

  const origins: string[] = [];
  for (const line of d.allowedOrigins.split(/[\s,]+/).filter(Boolean)) {
    const o = normalizeOrigin(line);
    if (!o) return { error: "Bitte die markierten Felder prüfen.", fields: { allowedOrigins: `Keine gültige https-Adresse ohne Pfad: ${line}` } };
    if (!origins.includes(o)) origins.push(o);
  }
  if (origins.length > 20) return { error: "Höchstens 20 erlaubte Domains.", fields: { allowedOrigins: "Höchstens 20" } };

  await db.workspace.update({
    where: { id: ws.id },
    data: {
      name: d.name,
      domain: d.domain || null,
      description: d.description || null,
      mailFromName: d.mailFromName || null,
      mailFromEmail: d.mailFromEmail?.toLowerCase() || null,
      brandPrimary: d.brandPrimary.toUpperCase(),
      brandAccent: d.brandAccent.toUpperCase(),
      fontHeading: d.fontHeading,
      fontBody: d.fontBody,
      region: d.region,
      languages: d.languages,
      allowedOrigins: origins,
      legalName: d.legalName || null,
      legalAddress: d.legalAddress || null,
      legalPhone: d.legalPhone || null,
      legalEmail: d.legalEmail?.toLowerCase() || null,
      agentApiEnabled: d.agentApiEnabled,
      vatId: d.vatId ? d.vatId.replace(/\s+/g, "").toUpperCase() : null,
      iban: d.iban ? formatIban(d.iban) : null,
      bic: d.bic ? d.bic.replace(/\s+/g, "").toUpperCase() : null,
      imprint: d.imprint || null,
    },
  });
  revalidatePath(`/sa/${slug}`, "layout");
  revalidatePath("/", "layout");
  return { ok: "Gespeichert." };
}

export async function saveLogo(slug: string, _prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    const ws = await requireAdmin(slug);
    let svg = "";
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_SVG_BYTES) return { error: "Datei ist zu groß (max. 100 KB)." };
      if (!/svg/i.test(file.type) && !file.name.toLowerCase().endsWith(".svg")) return { error: "Bitte eine SVG-Datei wählen." };
      svg = await file.text();
    } else {
      svg = String(formData.get("svg") ?? "").trim();
    }
    if (!svg) return { error: "Bitte eine SVG-Datei wählen oder SVG-Code einfügen." };
    const clean = sanitizeSvg(svg);
    await db.workspace.update({ where: { id: ws.id }, data: { logoSvg: clean } });
    revalidatePath(`/sa/${slug}/einstellungen`);
    return { ok: clean.length < svg.length * 0.9 ? "Logo gespeichert. Nicht erlaubte Teile wurden entfernt." : "Logo gespeichert." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeLogo(slug: string) {
  const ws = await requireAdmin(slug);
  await db.workspace.update({ where: { id: ws.id }, data: { logoSvg: null } });
  revalidatePath(`/sa/${slug}/einstellungen`);
}

/** Vier-Augen-Prinzip für Freigaben ein-/ausschalten (Recht: Einstellungen verwalten). */
export async function saveFourEyes(slug: string, _prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    const { ws, user } = await requireAccess(slug, { special: "manage_settings" });
    const on = formData.get("fourEyes") === "on";
    await db.workspace.update({ where: { id: ws.id }, data: { fourEyes: on } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "settings.four_eyes", detail: { on } });
    revalidatePath(`/sa/${slug}/einstellungen`);
    return { ok: on ? "Vier-Augen-Prinzip ist eingeschaltet." : "Vier-Augen-Prinzip ist ausgeschaltet." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
