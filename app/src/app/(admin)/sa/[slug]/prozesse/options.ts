import "server-only";
import { loadCatalogData } from "@/lib/process/fields-server";
import type { EditorOptions } from "@/components/process/types";

/** Auswahlwerte für die Knoten-Formulare – alles aus dem Feld-Katalog dieses Sub-Accounts. */
export async function loadEditorOptions(workspaceId: string): Promise<EditorOptions> {
  const catalog = await loadCatalogData(workspaceId);
  return {
    lifecycleStages: catalog.lifecycleStages,
    lists: catalog.lists,
    stages: catalog.stages.map(({ value, label, objectType }) => ({ value, label, objectType })),
    templates: catalog.templates,
    webhooks: catalog.webhooks,
    users: catalog.users,
    forms: catalog.forms,
    catalog,
  };
}
