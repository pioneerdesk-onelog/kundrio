"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard, forbiddenToState } from "@/lib/permissions/guard";
import { can } from "@/lib/permissions";
import { setConsent, setOptOut } from "@/lib/messaging/consent";
import type { FormState } from "@/components/users/StateForm";

// Einwilligung (Werbung) per SMS/WhatsApp am Kontakt erfassen bzw. widerrufen – mit Nachweis-Text.
export async function updateChannelConsent(slug: string, contactId: string, kind: "sms" | "whatsapp", action: "grant" | "revoke" | "optin", _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, access, user } = await guard(slug, { object: "contacts", action: "edit" });
    const c = await db.contact.findFirst({ where: { id: contactId, workspaceId: ws.id }, select: { ownerId: true } });
    if (!c || !can(access, "contacts", "edit", c.ownerId)) return { error: "Keine Berechtigung für diesen Kontakt." };
    if (kind !== "sms" && kind !== "whatsapp") return { error: "Unbekannter Kanal." };
    if (action === "grant") {
      const source = String(fd.get("source") ?? "").trim();
      if (source.length < 5) return { error: "Bitte angeben, wie die Einwilligung erteilt wurde (Nachweis, z. B. „Formular Messe 10/2026“)." };
      await setConsent(ws.id, contactId, kind, true, source.slice(0, 300), `user:${user.id}`);
    } else if (action === "revoke") {
      await setConsent(ws.id, contactId, kind, false, "Widerruf erfasst", `user:${user.id}`);
    } else {
      await setOptOut(ws.id, contactId, kind, false, "manuell aufgehoben");
    }
    revalidatePath(`/sa/${slug}/kontakte/${contactId}`);
    return { ok: "Gespeichert." };
  } catch (e) {
    return { error: forbiddenToState(e)?.error ?? (e instanceof Error ? e.message : String(e)) };
  }
}
