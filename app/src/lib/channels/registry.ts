import type { Connector } from "./connector";
import type { Platform } from "./types";
import { linkedin } from "./linkedin";
import { facebook, instagram } from "./meta";
import { x } from "./x";
import { tiktok } from "./tiktok";
import { youtube } from "./youtube";

// Plattformen mit Schnittstelle. XING, Website, Newsletter: nur manuell/Import.
export const CONNECTORS: Partial<Record<Platform, Connector>> = { linkedin, facebook, instagram, x, tiktok, youtube };

export function connectorFor(platform: string): Connector | null {
  return (CONNECTORS as Record<string, Connector | undefined>)[platform] ?? null;
}
