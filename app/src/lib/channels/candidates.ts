// Auswahl des passenden Kontos nach dem Verbinden (Seite/Organisation/IG-Konto). Rein (testbar).
import type { AccountCandidate } from "./types";

const clean = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/^@/, "").replace(/^https?:\/\/[^/]+\//, "").replace(/[^a-z0-9]+/g, "");

export function pickCandidate(candidates: AccountCandidate[], acc: { externalId: string | null; handle: string }): AccountCandidate | null {
  if (candidates.length === 0) return null;
  if (acc.externalId) {
    const byId = candidates.find((c) => c.id === acc.externalId);
    if (byId) return byId;
  }
  const h = clean(acc.handle);
  if (h) {
    const byHandle = candidates.find((c) => clean(c.handle) === h || clean(c.name) === h || clean(c.url) === h);
    if (byHandle) return byHandle;
  }
  return candidates.length === 1 ? candidates[0] : null;
}
