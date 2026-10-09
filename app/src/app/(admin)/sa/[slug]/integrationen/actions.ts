"use server";

import { revalidatePath } from "next/cache";
import { enqueue } from "@/lib/jobs";
import { guard, forbiddenToState } from "@/lib/permissions/guard";
import { importContacts, pushCustomers, pushInvoice, setEnabled, testConnection } from "@/lib/lexware/sync";
import type { FormState } from "@/components/users/StateForm";

const actor = (userId: string) => `user:${userId}`;
const err = (e: unknown): FormState => forbiddenToState(e) ?? { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
const confirmed = (fd: FormData) => fd.get("confirm") === "on";

/** Lexware für den Sub-Account an-/ausschalten (Einstellungsrecht). */
export async function toggleLexware(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, { special: "manage_settings" });
    const enable = fd.get("enable") === "1";
    await setEnabled(ws.id, enable, actor(user.id));
    revalidatePath(`/sa/${slug}/integrationen`);
    return { ok: enable ? "Lexware ist für diesen Sub-Account aktiv." : "Lexware ist deaktiviert." };
  } catch (e) {
    return err(e);
  }
}

/** Verbindung testen – nur lesend (/v1/profile). */
export async function testLexware(slug: string, _prev: FormState): Promise<FormState> {
  try {
    await guard(slug, { anyOf: [{ object: "invoices", action: "read" }, { special: "manage_settings" }] });
    const p = await testConnection();
    return { ok: `Verbunden mit „${p.companyName}“${p.smallBusiness ? " (Kleinunternehmer)" : ""}.` };
  } catch (e) {
    return err(e);
  }
}

/** Kunden an Lexware übertragen (Außenwirkung in die Buchhaltung → Bestätigung). */
export async function pushCustomersAction(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, { object: "invoices", action: "edit" });
    if (!confirmed(fd)) return { error: "Bitte bestätigen, dass Kunden an Lexware übertragen werden." };
    const r = await pushCustomers(ws.id, actor(user.id));
    revalidatePath(`/sa/${slug}/integrationen`);
    return r.errors.length
      ? { error: `${r.ok} von ${r.total} übertragen. Fehler: ${r.errors.slice(0, 3).join("; ")}` }
      : { ok: `${r.ok} Kunden übertragen bzw. aktualisiert.` };
  } catch (e) {
    return err(e);
  }
}

/** Kunden aus Lexware importieren (Rückweg, kein Lock-in). */
export async function importFromLexware(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, { special: "import" });
    if (!confirmed(fd)) return { error: "Bitte bestätigen." };
    const r = await importContacts(ws.id, actor(user.id));
    revalidatePath(`/sa/${slug}/integrationen`);
    return { ok: `${r.created} neu angelegt, ${r.linked} zugeordnet, ${r.skipped} übersprungen.` };
  } catch (e) {
    return err(e);
  }
}

/** Zahlungsstatus jetzt abgleichen (im Hintergrund). */
export async function syncNow(slug: string, _prev: FormState): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, { object: "invoices", action: "edit" });
    await enqueue("lexware.sync", { workspaceId: ws.id, actor: actor(user.id) });
    return { ok: "Abgleich gestartet. Ergebnis erscheint im Protokoll." };
  } catch (e) {
    return err(e);
  }
}

/** Einzelnen Beleg an Lexware übertragen (Knopf auf der Rechnungsseite). */
export async function pushInvoiceAction(slug: string, invoiceId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, { object: "invoices", action: "edit" });
    if (!confirmed(fd)) return { error: "Bitte bestätigen, dass der Beleg in die Buchhaltung übertragen wird." };
    const finalize = fd.get("finalize") === "on";
    const r = await pushInvoice(ws.id, invoiceId, actor(user.id), { finalize });
    revalidatePath(`/sa/${slug}/rechnungen/${invoiceId}`);
    return { ok: `Übertragen${finalize ? " und festgeschrieben" : " als Entwurf"}. In Lexware öffnen: ${r.link}` };
  } catch (e) {
    return err(e);
  }
}
