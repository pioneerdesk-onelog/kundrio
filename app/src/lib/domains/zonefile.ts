import type { InventoryItem } from "./inventory";

// BIND-Zonendatei (RFC 1035) für den Rückweg/Export – kein Lock-in: jeder DNS-Anbieter kann sie importieren.

const dot = (n: string) => (n.endsWith(".") ? n : `${n}.`);

function txtChunks(v: string): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.max(v.length, 1); i += 255) parts.push(`"${v.slice(i, i + 255).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return parts.join(" ");
}

function rdata(type: string, value: string): string {
  switch (type) {
    case "TXT":
      return txtChunks(value);
    case "CNAME":
    case "NS":
      return dot(value.toLowerCase());
    case "MX": {
      const m = value.match(/^(\d+)\s+(\S+)$/);
      return m ? `${m[1]} ${dot(m[2])}` : value;
    }
    case "SRV": {
      const m = value.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/);
      return m ? `${m[1]} ${m[2]} ${m[3]} ${dot(m[4])}` : value;
    }
    default:
      return value;
  }
}

/** Relativer Owner-Name (@ für die Domain-Spitze). */
function owner(name: string, zone: string): string {
  const n = name.toLowerCase().replace(/\.$/, "");
  if (n === zone) return "@";
  return n.endsWith(`.${zone}`) ? n.slice(0, -(zone.length + 1)) : dot(n);
}

export function toBindZone(
  zone: string,
  items: Pick<InventoryItem, "type" | "name" | "values" | "ttl">[],
  opts: { nameservers: string[]; hostmaster?: string; serial?: number; defaultTtl?: number },
): string {
  const z = zone.toLowerCase().replace(/\.$/, "");
  const ttl = opts.defaultTtl ?? 3600;
  const serial = opts.serial ?? Number(new Date().toISOString().slice(0, 10).replace(/-/g, "") + "01");
  const hm = dot((opts.hostmaster ?? `hostmaster.${z}`).replace("@", "."));
  const ns = opts.nameservers.length ? opts.nameservers : ["ns1.stackit.cloud", "ns2.stackit.zone"];
  const lines = [
    `; Zonendatei für ${z} – erzeugt vom Kundrio (${new Date().toISOString().slice(0, 10)})`,
    `$ORIGIN ${dot(z)}`,
    `$TTL ${ttl}`,
    `@\tIN\tSOA\t${dot(ns[0])} ${hm} (${serial} 3600 600 1209600 60)`,
    ...ns.map((n) => `@\tIN\tNS\t${dot(n)}`),
  ];
  const sorted = [...items].sort((a, b) => (owner(a.name, z) === "@" ? -1 : 0) - (owner(b.name, z) === "@" ? -1 : 0) || a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  for (const it of sorted) {
    if ((it.type === "NS" || it.type === "SOA") && owner(it.name, z) === "@") continue;
    for (const v of it.values) lines.push(`${owner(it.name, z)}\t${it.ttl || ttl}\tIN\t${it.type}\t${rdata(it.type, v)}`);
  }
  return `${lines.join("\n")}\n`;
}
