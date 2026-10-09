// Hilfsfunktionen für Puck-Seitendaten (rein, ohne Server-Abhängigkeiten → testbar, auch im Client nutzbar).

export type Block = { type: string; props: Record<string, unknown> };
export type PageData = { root?: { props?: Record<string, unknown> }; content?: Block[]; zones?: Record<string, Block[]> };

function isBlock(v: unknown): v is Block {
  return !!v && typeof v === "object" && typeof (v as Block).type === "string" && !!(v as Block).props && typeof (v as Block).props === "object";
}

/** Alle Blöcke in Dokumentreihenfolge, inklusive verschachtelter Slots und (alter) Zonen. */
export function walkBlocks(data: PageData | null | undefined): Block[] {
  const out: Block[] = [];
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const b of list) {
      if (!isBlock(b)) continue;
      out.push(b);
      for (const v of Object.values(b.props)) if (Array.isArray(v) && v.some(isBlock)) visit(v);
    }
  };
  visit(data?.content);
  for (const z of Object.values(data?.zones ?? {})) visit(z);
  return out;
}

/** Erlaubte Linkziele: http(s), mailto, tel, relative Pfade und Anker. Alles andere → null. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith("/") && !h.startsWith("//")) return h;
  if (h.startsWith("#")) return h;
  if (/^(https?:|mailto:|tel:)/i.test(h)) {
    try {
      if (/^https?:/i.test(h)) new URL(h);
      return h;
    } catch {
      return null;
    }
  }
  return null;
}

export const str = (v: unknown) => (typeof v === "string" ? v : "");

// ---- Übersetzung: nur Text-Props, nie Links/IDs/Auswahlwerte ----
export const TEXT_KEYS = new Set([
  "eyebrow", "heading", "text", "buttonLabel", "secondaryLabel", "markdown", "title", "question", "answer", "alt", "caption", "label", "note",
]);

/** Sammelt übersetzbare Texte (Pfad + Wert) aus den Blöcken. */
export function collectTexts(data: PageData): { path: (string | number)[]; value: string }[] {
  const out: { path: (string | number)[]; value: string }[] = [];
  const visit = (node: unknown, path: (string | number)[]) => {
    if (Array.isArray(node)) return node.forEach((n, i) => visit(n, [...path, i]));
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "id" || k === "type") continue;
      if (typeof v === "string") {
        if (TEXT_KEYS.has(k) && v.trim()) out.push({ path: [...path, k], value: v });
      } else visit(v, [...path, k]);
    }
  };
  visit(data.content ?? [], ["content"]);
  return out;
}

/** Setzt übersetzte Texte an die gesammelten Pfade (Kopie, Original bleibt unverändert). */
export function applyTexts(data: PageData, items: { path: (string | number)[] }[], values: string[]): PageData {
  const copy = JSON.parse(JSON.stringify(data)) as PageData;
  items.forEach((it, i) => {
    let node: Record<string | number, unknown> = copy as unknown as Record<string, unknown>;
    for (const p of it.path.slice(0, -1)) node = node[p] as Record<string | number, unknown>;
    node[it.path[it.path.length - 1]] = values[i];
  });
  return copy;
}

/** Neue, eindeutige Block-IDs vergeben (z. B. für kopierte oder KI-erzeugte Seiten). */
export function withFreshIds(data: PageData): PageData {
  const copy = JSON.parse(JSON.stringify(data)) as PageData;
  for (const b of walkBlocks(copy)) b.props.id = `${b.type}-${crypto.randomUUID()}`;
  return copy;
}
