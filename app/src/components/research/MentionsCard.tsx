import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { Card } from "@/components/ui";
import { MentionList, type MentionItem } from "./MentionList";
import { ResearchButton } from "./ResearchButton";

/**
 * Karte „Presse & Erwähnungen“ für Unternehmens- bzw. Kontakt-Detailseiten.
 * Prüft selbst Lese-/Bearbeitungsrecht inkl. Reichweite; `canEdit` kann zusätzlich einschränken.
 */
export async function MentionsCard({
  slug,
  objectType,
  objectId,
  canEdit,
}: {
  slug: string;
  objectType: "company" | "contact";
  objectId: string;
  /** optional: Bearbeiten zusätzlich verbieten (z. B. schreibgeschützte Ansicht) */
  canEdit?: boolean;
}) {
  const { ws, access } = await pageAccess(slug);
  const object = objectType === "company" ? "companies" : "contacts";
  const rec =
    objectType === "company"
      ? await db.company.findFirst({ where: { id: objectId, workspaceId: ws.id }, select: { ownerId: true } })
      : await db.contact.findFirst({ where: { id: objectId, workspaceId: ws.id }, select: { ownerId: true } });
  if (!rec || !can(access, object, "read", rec.ownerId)) return null;
  const editable = (canEdit ?? true) && can(access, object, "edit", rec.ownerId);
  const personBlocked = objectType === "contact" && !ws.enrichPersons;

  const mentions = await db.mention.findMany({
    where: { workspaceId: ws.id, ...(objectType === "company" ? { companyId: objectId } : { contactId: objectId }) },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 50,
  });
  const items: MentionItem[] = mentions.map((m) => ({
    id: m.id,
    url: m.url,
    title: m.title,
    sourceHost: m.sourceHost,
    sourceKind: m.sourceKind,
    publishedAt: m.publishedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    snippet: m.snippet,
    summary: m.summary,
    sentiment: m.sentiment,
    relevance: m.relevance,
    topics: m.topics,
    status: m.status,
  }));

  return (
    <Card title="Presse & Erwähnungen">
      <p className="mb-3 text-sm text-ink-400 dark:text-ink-200">
        Quellen: GDELT (offene Nachrichten-Datenbank), eigene Suchmaschine{objectType === "company" ? ", Presse-Seite/Feed der Firmen-Website" : ""}. Kurzfassungen
        erstellt die KI – mit Quelle prüfen. {objectType === "contact" ? "Nur beruflicher Bezug." : ""}
      </p>
      {editable && !personBlocked && (
        <div className="mb-4">
          <ResearchButton slug={slug} objectType={objectType} objectId={objectId} />
        </div>
      )}
      {personBlocked && (
        <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">Recherche zu Personen ist in diesem Sub-Account nicht freigeschaltet (Einstellungen → Anreicherung, nur beruflich).</p>
      )}
      <MentionList slug={slug} items={items} canEdit={editable} />
    </Card>
  );
}
