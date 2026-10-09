// Verfügbare Zahlungsanbieter. Neue Anbieter: Connector in ./connectors anlegen und hier eintragen.
import { mollie } from "./connectors/mollie";
import { revolut } from "./connectors/revolut";
import { unzer } from "./connectors/unzer";
import { isProviderKey, type Connector, type ProviderKey } from "./types";

export const CONNECTORS: Record<ProviderKey, Connector> = { mollie, revolut, unzer };

export function getConnector(key: string): Connector | null {
  return isProviderKey(key) ? CONNECTORS[key] : null;
}

/** Live-Zahlungen nur, wenn ausdrücklich freigeschaltet (PAYMENTS_MODE=live). Schutz vor echten Zahlungen in Tests. */
export function liveAllowed(env: Record<string, string | undefined> = process.env) {
  return env.PAYMENTS_MODE === "live";
}
