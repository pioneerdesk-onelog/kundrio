import "server-only";
import { db } from "./db";

/** Listen eines Workspaces mit Mitgliederzahl (für Auswahlfelder). */
export async function listOptions(workspaceId: string) {
  const lists = await db.contactList.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, numericId: true, _count: { select: { members: true } } },
  });
  return lists.map((l) => ({ id: l.id, name: l.name, numericId: l.numericId, count: l._count.members }));
}

/** Prüft, dass alle Listen-IDs zum Workspace gehören; gibt nur gültige zurück. */
export async function ownListIds(workspaceId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.contactList.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Kontakte (bereits geprüft auf Workspace) zu einer Liste hinzufügen; idempotent. */
export async function addMembers(listId: string, contactIds: string[]) {
  if (!contactIds.length) return 0;
  const res = await db.contactListMember.createMany({
    data: contactIds.map((contactId) => ({ listId, contactId })),
    skipDuplicates: true,
  });
  return res.count;
}
