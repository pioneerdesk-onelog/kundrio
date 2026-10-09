import type { CatalogData } from "@/lib/process/fields";

export type Opt = { value: string; label: string };

/** Serverseitig geladene Auswahlwerte für den Editor. */
export type EditorOptions = {
  lifecycleStages: Opt[];
  lists: Opt[];
  stages: (Opt & { objectType: string })[];
  templates: Opt[];
  webhooks: Opt[];
  users: Opt[];
  forms: Opt[];
  /** Feld-Katalog des Sub-Accounts (einzige Quelle für Felder, Werte und Referenzen) */
  catalog: CatalogData;
};

export type ActionResult<T = unknown> = { ok: true; data: T; message?: string } | { ok: false; error: string };

export type RunView = {
  id: string;
  status: string;
  objectType: string;
  objectId: string;
  test: boolean;
  error: string | null;
  steps: { nodeId: string; nodeType: string; status: string; detail: unknown; createdAt: string }[];
};
