import "server-only";
import { Resolver } from "node:dns/promises";
import type { RecordType } from "./types";

// Resolver-Abstraktion: mehrere unabhängige Resolver (System + öffentliche), im Test durch Fakes ersetzbar.

export type LookupType = RecordType | "NS" | "SRV" | "CAA";

export interface DnsLookup {
  name: string;
  resolve(host: string, type: LookupType): Promise<string[]>;
}

const TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("DNS-Zeitüberschreitung")), ms))]);
}

/** Node-Resolver gegen bestimmte Server (leer = Systemeinstellung). Leere Antwort/NXDOMAIN → []. */
export function nodeResolver(name: string, servers: string[] = []): DnsLookup {
  const r = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  if (servers.length) r.setServers(servers);
  return {
    name,
    async resolve(host, type) {
      try {
        switch (type) {
          case "A":
            return await withTimeout(r.resolve4(host), TIMEOUT_MS * 2);
          case "AAAA":
            return await withTimeout(r.resolve6(host), TIMEOUT_MS * 2);
          case "CNAME":
            return (await withTimeout(r.resolveCname(host), TIMEOUT_MS * 2)).map((v) => v.replace(/\.$/, "").toLowerCase());
          case "TXT":
            return (await withTimeout(r.resolveTxt(host), TIMEOUT_MS * 2)).map((parts) => parts.join(""));
          case "MX":
            return (await withTimeout(r.resolveMx(host), TIMEOUT_MS * 2)).map((m) => `${m.priority} ${m.exchange.toLowerCase()}`);
          case "NS":
            return (await withTimeout(r.resolveNs(host), TIMEOUT_MS * 2)).map((v) => v.replace(/\.$/, "").toLowerCase());
          case "SRV":
            // Format wie im Zonendatei-Inhalt: „Priorität Gewicht Port Ziel“
            return (await withTimeout(r.resolveSrv(host), TIMEOUT_MS * 2)).map((v) => `${v.priority} ${v.weight} ${v.port} ${v.name.replace(/\.$/, "").toLowerCase()}`);
          case "CAA":
            return (await withTimeout(r.resolveCaa(host), TIMEOUT_MS * 2)).map((v) => {
              const tag = v.issue !== undefined ? "issue" : v.issuewild !== undefined ? "issuewild" : v.iodef !== undefined ? "iodef" : "issue";
              const val = (v as unknown as Record<string, string>)[tag] ?? "";
              return `${v.critical ?? 0} ${tag} "${val}"`;
            });
        }
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN" || code === "ESERVFAIL") return [];
        throw e;
      }
    },
  };
}

// Nur für Integrationstests: feste Resolver statt echter DNS-Abfragen (nie in Produktion gesetzt)
let testResolvers: DnsLookup[] | null = null;
export function setTestResolvers(list: DnsLookup[] | null) {
  if (process.env.NODE_ENV === "production") throw new Error("Test-Resolver in Produktion nicht erlaubt");
  testResolvers = list;
}

/** System-Resolver (bzw. Test-Resolver). */
export function systemResolver(): DnsLookup {
  return testResolvers?.[0] ?? nodeResolver("System");
}

/** Standard-Satz: System + Cloudflare + Quad9 (EU, Schweiz) + Google. Über Env DNS_CHECK_RESOLVERS anpassbar (name=ip,…). */
export function defaultResolvers(): DnsLookup[] {
  if (testResolvers) return testResolvers;
  const custom = process.env.DNS_CHECK_RESOLVERS?.trim();
  if (custom) {
    return custom.split(",").map((p) => {
      const [n, ip] = p.split("=");
      return ip ? nodeResolver(n.trim(), [ip.trim()]) : nodeResolver(n.trim());
    });
  }
  return [nodeResolver("System"), nodeResolver("Cloudflare 1.1.1.1", ["1.1.1.1"]), nodeResolver("Quad9 9.9.9.9", ["9.9.9.9"]), nodeResolver("Google 8.8.8.8", ["8.8.8.8"])];
}

/** Liefert die Nameserver der Zone, indem von links Labels entfernt werden, bis NS-Einträge existieren. */
export async function findZone(host: string, r: DnsLookup): Promise<{ zone: string; ns: string[] } | null> {
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    try {
      const ns = await r.resolve(candidate, "NS");
      if (ns.length) return { zone: candidate, ns };
    } catch {
      // nächstes Label probieren
    }
  }
  return null;
}
