import "server-only";
import { connect } from "node:tls";
import { defaultResolvers, type DnsLookup } from "./resolver";
import { evaluate, obsKey, type Observations } from "./evaluate";
import type { CertCheck, CheckReport, DesiredRecord } from "./types";

// DNS-Beobachtungen über mehrere Resolver sammeln + HTTPS-Zertifikat prüfen.

async function cnameChain(host: string, r: DnsLookup, max = 6): Promise<string[]> {
  const chain: string[] = [];
  let cur = host;
  for (let i = 0; i < max; i++) {
    const c = await r.resolve(cur, "CNAME").catch(() => [] as string[]);
    if (!c.length) break;
    chain.push(c[0]);
    cur = c[0];
  }
  return chain;
}

export async function gatherObservations(desired: DesiredRecord[], resolvers: DnsLookup[]): Promise<{ obs: Observations; chain: string[]; flattened: Record<string, boolean> }> {
  const obs: Observations = {};
  const flattened: Record<string, boolean> = {};
  await Promise.all(
    resolvers.map(async (r) => {
      obs[r.name] = {};
      for (const d of desired) {
        obs[r.name][obsKey(d.type, d.name)] = await r.resolve(d.name, d.type).catch((): string[] => []);
        // „CNAME-Flattening“ (z. B. Cloudflare-Proxy): kein CNAME sichtbar, aber gleiche A-Adressen wie das Ziel
        if (d.type === "CNAME" && !obs[r.name][obsKey(d.type, d.name)].length) {
          const [hostA, targetA] = await Promise.all([r.resolve(d.name, "A").catch((): string[] => []), r.resolve(d.value, "A").catch((): string[] => [])]);
          flattened[r.name] = hostA.length > 0 && targetA.length > 0 && hostA.every((ip) => targetA.includes(ip));
        }
      }
    }),
  );
  const landing = desired.find((d) => d.purpose === "landing");
  const chain = landing && resolvers[0] ? await cnameChain(landing.name, resolvers[0]) : [];
  return { obs, chain, flattened };
}

export async function checkDns(desired: DesiredRecord[], resolvers: DnsLookup[] = defaultResolvers()): Promise<CheckReport> {
  const { obs, chain, flattened } = await gatherObservations(desired, resolvers);
  return evaluate(desired, obs, { cnameChain: chain, flattened });
}

/** TLS-Verbindung zum Host auf 443: Zertifikat gültig (Kette + Name) und Restlaufzeit. */
export function checkHttps(host: string, timeoutMs = 8000): Promise<CertCheck> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const err = socket.authorizationError ? String(socket.authorizationError) : undefined;
      socket.end();
      if (!cert || !cert.valid_to) return resolve({ ok: false, error: "Kein Zertifikat erhalten" });
      const validTo = new Date(cert.valid_to);
      const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
      const issuer = typeof cert.issuer === "object" ? (cert.issuer.O ?? cert.issuer.CN) : undefined;
      resolve({ ok: authorized && daysLeft > 0, issuer: issuer ? String(issuer) : undefined, validTo: validTo.toISOString(), daysLeft, error: authorized ? undefined : err });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, error: "Zeitüberschreitung bei HTTPS" });
    });
    socket.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}
