import type { DnsLookup } from "./resolver";

// Delegation einer Zone an STACKIT DNS prüfen (Nameserver beim Registrar umgestellt?).

export const STACKIT_NS_RE = /^ns\d*\.stackit\.(cloud|zone|dns)$/;

/** Delegation prüfen: zeigen die NS der Zone (mehrheitlich über die Resolver) auf STACKIT? */
export async function checkDelegation(zone: string, resolvers: DnsLookup[]): Promise<{ ok: boolean; found: string[]; okResolvers: number; total: number }> {
  let okResolvers = 0;
  const found = new Set<string>();
  for (const r of resolvers) {
    let ns: string[] = [];
    try {
      ns = (await r.resolve(zone, "NS")).map((n) => n.toLowerCase().replace(/\.$/, ""));
    } catch {
      ns = [];
    }
    ns.forEach((n) => found.add(n));
    if (ns.length && ns.every((n) => STACKIT_NS_RE.test(n))) okResolvers++;
  }
  return { ok: okResolvers > resolvers.length / 2, found: [...found], okResolvers, total: resolvers.length };
}

