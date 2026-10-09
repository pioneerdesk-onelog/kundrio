"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { assertRecord, forbiddenToState, guard } from "@/lib/permissions/guard";
import { acceptSuggestion, rejectSuggestion } from "@/lib/enrich/suggestions";
import { personEnrichmentBlocked } from "@/lib/enrich/persons-rules";
import { ensureArt14Template, markArt14Informed } from "@/lib/enrich/art14";
import type { FormState } from "@/components/users/StateForm";

type Kind = "company" | "contact";
const OBJ = { company: "companies", contact: "contacts" } as const;

function paths(slug: string, kind: Kind, id: string) {
  revalidatePath(`/sa/${slug}/anreicherung`);
  revalidatePath(`/sa/${slug}/${kind === "company" ? "unternehmen" : "kontakte"}/${id}`);
}

const msg = (e: unknown) => forbiddenToState(e) ?? { error: e instanceof Error ? e.message : String(e) };

async function loadRecord(workspaceId: string, kind: Kind, id: string) {
  return kind === "company"
    ? db.company.findFirst({ where: { id, workspaceId }, select: { id: true, ownerId: true, name: true } })
    : db.contact.findFirst({ where: { id, workspaceId }, select: { id: true, ownerId: true, tags: true } });
}

/** Ein laufender/wartender Anreicherungs-Job für diesen Datensatz? */
async function pendingJob(kind: Kind, id: string) {
  return db.job.findFirst({
    where: { type: `enrich.${kind}`, status: { in: ["queued", "running"] }, payload: { path: ["objectId"], equals: id } },
    select: { id: true },
  });
}

export async function startEnrichment(slug: string, kind: Kind, id: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { ws, access, user } = await guard(slug);
    const rec = await loadRecord(ws.id, kind, id);
    if (!rec) return { error: "Datensatz nicht gefunden." };
    assertRecord(access, OBJ[kind], "edit", rec.ownerId);
    if (kind === "contact") {
      const blocked = personEnrichmentBlocked(ws, rec as { tags: string[] });
      if (blocked) return { error: blocked };
    }
    if (await pendingJob(kind, id)) return { ok: "Abruf läuft bereits." };
    await enqueue(`enrich.${kind}`, { workspaceId: ws.id, objectId: id, requestedBy: user.id });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "enrichment.requested", target: `${kind}:${id}` });
    paths(slug, kind, id);
    return { ok: "Abruf gestartet – Vorschläge erscheinen in Kürze." };
  } catch (e) {
    return msg(e);
  }
}

export async function decideSuggestion(slug: string, suggestionId: string, decision: "accept" | "reject", _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { ws, access, user } = await guard(slug);
    const s = await db.enrichmentSuggestion.findFirst({ where: { id: suggestionId, workspaceId: ws.id } });
    if (!s) return { error: "Vorschlag nicht gefunden." };
    const kind = s.objectType as Kind;
    const rec = await loadRecord(ws.id, kind, s.objectId);
    if (!rec) return { error: "Datensatz nicht gefunden." };
    assertRecord(access, OBJ[kind], "edit", rec.ownerId);
    const actor = { userId: user.id, name: user.name };
    if (decision === "accept") await acceptSuggestion(s.id, ws.id, actor);
    else await rejectSuggestion(s.id, ws.id, actor);
    paths(slug, kind, s.objectId);
    return { ok: decision === "accept" ? "Übernommen." : "Verworfen." };
  } catch (e) {
    return msg(e);
  }
}

export async function acceptAll(slug: string, kind: Kind, id: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { ws, access, user } = await guard(slug);
    const rec = await loadRecord(ws.id, kind, id);
    if (!rec) return { error: "Datensatz nicht gefunden." };
    assertRecord(access, OBJ[kind], "edit", rec.ownerId);
    const open = await db.enrichmentSuggestion.findMany({ where: { workspaceId: ws.id, objectType: kind, objectId: id, status: "proposed" }, orderBy: { createdAt: "asc" } });
    for (const s of open) await acceptSuggestion(s.id, ws.id, { userId: user.id, name: user.name });
    paths(slug, kind, id);
    return { ok: `${open.length} Vorschläge übernommen.` };
  } catch (e) {
    return msg(e);
  }
}

export async function saveEnrichSettings(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, { special: "manage_settings" });
    const enrichPersons = fd.get("enrichPersons") === "on";
    await db.workspace.update({ where: { id: ws.id }, data: { enrichPersons } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "settings.enrichPersons", detail: { enrichPersons } });
    revalidatePath(`/sa/${slug}/anreicherung`);
    return { ok: enrichPersons ? "Personen-Anreicherung eingeschaltet (nur beruflich)." : "Personen-Anreicherung ausgeschaltet." };
  } catch (e) {
    return msg(e);
  }
}

export async function createArt14Template(slug: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { ws } = await guard(slug, { anyOf: [{ special: "manage_settings" }, { object: "email", action: "edit" }] });
    const t = await ensureArt14Template(ws.id);
    revalidatePath(`/sa/${slug}/anreicherung`);
    return { ok: `Vorlage bereit (Vorlagen-ID ${t.numericId}). Versand nur manuell bzw. über Freigabe.` };
  } catch (e) {
    return msg(e);
  }
}

export async function markInformed(slug: string, contactId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, access, user } = await guard(slug);
    const rec = await loadRecord(ws.id, "contact", contactId);
    if (!rec) return { error: "Kontakt nicht gefunden." };
    assertRecord(access, "contacts", "edit", rec.ownerId);
    const how = String(fd.get("how") ?? "E-Mail").slice(0, 80) || "E-Mail";
    await markArt14Informed(ws.id, contactId, user.id, how);
    paths(slug, "contact", contactId);
    return { ok: "Als informiert vermerkt." };
  } catch (e) {
    return msg(e);
  }
}

/** Mehrere Unternehmen anreichern (nur solche, die der Benutzer bearbeiten darf). */
export async function bulkEnrichCompanies(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, access, user } = await guard(slug);
    const ids = fd.getAll("companyId").map(String).slice(0, 50);
    if (!ids.length) return { error: "Bitte mindestens ein Unternehmen auswählen." };
    const companies = await db.company.findMany({ where: { id: { in: ids }, workspaceId: ws.id }, select: { id: true, ownerId: true } });
    let queued = 0;
    let skipped = 0;
    for (const c of companies) {
      try {
        assertRecord(access, "companies", "edit", c.ownerId);
      } catch {
        skipped++;
        continue;
      }
      if (await pendingJob("company", c.id)) continue;
      await enqueue("enrich.company", { workspaceId: ws.id, objectId: c.id, requestedBy: user.id });
      queued++;
    }
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "enrichment.bulk", detail: { queued, skipped } });
    revalidatePath(`/sa/${slug}/anreicherung`);
    return { ok: `${queued} Abrufe gestartet${skipped ? `, ${skipped} ohne Berechtigung übersprungen` : ""}.` };
  } catch (e) {
    return msg(e);
  }
}
