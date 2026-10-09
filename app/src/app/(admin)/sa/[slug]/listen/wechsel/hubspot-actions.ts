"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { guard } from "@/lib/permissions/guard";
import { audit } from "@/lib/audit";
import { cancelHubspotImport as cancelImport, startHubspotImport as startImport } from "@/lib/migrate/hubspot-import";

export type HubspotState = { ok?: string; error?: string };

/** HubSpot-Import: Sonderrecht „Daten importieren“ + Kontakte bearbeiten. */
async function requireAdmin(slug: string) {
  const { ws, user, access } = await guard(slug, { special: "import" });
  if (!can(access, "contacts", "edit")) throw new Error("Für den Import fehlt das Recht, Kontakte zu bearbeiten.");
  return { ws, user };
}

export async function startHubspotImport(slug: string, _prev: HubspotState, fd: FormData): Promise<HubspotState> {
  try {
    const { ws, user } = await requireAdmin(slug);
    const token = String(fd.get("token") ?? "").trim();
    // Service Keys und Private-App-Tokens (pat-…) – nur grobe Plausibilität, die echte Prüfung macht HubSpot
    if (token.length < 20 || token.length > 500 || /\s/.test(token)) return { error: "Bitte einen HubSpot Service Key bzw. Private-App-Token einfügen." };
    if (fd.get("confirm") !== "on") return { error: "Bitte bestätigen, dass die Daten übernommen werden dürfen." };
    await startImport(ws.id, token, user.name);
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "migrate.hubspot.started" });
    revalidatePath(`/sa/${slug}/listen/wechsel`);
    return { ok: "Import gestartet. Der Worker (npm run worker) arbeitet ihn im Hintergrund ab." };
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

export async function cancelHubspotImport(slug: string) {
  const { ws } = await requireAdmin(slug);
  await cancelImport(ws.id);
  redirect(`/sa/${slug}/listen/wechsel?ok=${encodeURIComponent("HubSpot-Import abgebrochen, Schlüssel entfernt")}`);
}
