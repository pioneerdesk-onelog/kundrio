import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { detectProvider } from "./catalog";
import { checkDelegation } from "./delegation";
import { inventoryFromApi, inventoryFromDns, mergeItems, parseManualLines } from "./inventory";
import { contentFor, formatTxt, normalizeContent, stackitApi, stackitClient } from "./providers/stackit";
import type { DnsLookup, LookupType } from "./resolver";
import { buildAssertion, jwtExp, resetStackitTokenCache, stackitAccessToken, type ServiceAccountKey } from "./stackit-auth";
import { toBindZone } from "./zonefile";

const zone = "kunde.de";

describe("Erkennung", () => {
  it("erkennt STACKIT an den Nameservern (neu und alt)", () => {
    expect(detectProvider(["ns1.stackit.cloud", "ns2.stackit.zone"]).key).toBe("stackit");
    expect(detectProvider(["ns1.stackit.dns."]).key).toBe("stackit");
    expect(detectProvider(["argus.eu01.stackit.cloud"]).key).toBe("unknown");
  });
});

describe("Inhalte nach STACKIT-Format", () => {
  it("TXT ≤ 255 unverändert, länger in Stücken mit Anführungszeichen (wie stackit-cli)", () => {
    expect(formatTxt("v=spf1 -all")).toBe("v=spf1 -all");
    const long = "a".repeat(300);
    expect(formatTxt(long)).toBe(`"${"a".repeat(255)}" "${"a".repeat(45)}"`);
    expect(() => formatTxt("x".repeat(4050))).toThrow();
    expect(normalizeContent("TXT", formatTxt(long))).toBe(long);
  });
  it("CNAME/MX-Ziele vollqualifiziert mit Punkt, beim Lesen ohne", () => {
    expect(contentFor({ type: "CNAME", value: "Sites.Pioneerdesk.cloud" })).toBe("sites.pioneerdesk.cloud.");
    expect(contentFor({ type: "MX", value: "10 mx.kunde.de" })).toBe("10 mx.kunde.de.");
    expect(normalizeContent("CNAME", "sites.pioneerdesk.cloud.")).toBe("sites.pioneerdesk.cloud");
  });
});

/** Fake-Fetch für die STACKIT-DNS-API: merkt sich Anfragen, liefert vorgegebene Antworten. */
function fakeApi() {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const rrsets = [
    { id: "r1", name: "kunde.de.", type: "TXT", ttl: 3600, state: "CREATE_SUCCEEDED", records: [{ content: "v=spf1 include:spf.protection.outlook.com -all" }] },
    { id: "r2", name: "old.kunde.de.", type: "A", ttl: 3600, state: "DELETE_SUCCEEDED", records: [{ content: "192.0.2.9" }] },
  ];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/zones?")) return json({ zones: [{ id: "z1", dnsName: "kunde.de", state: "CREATE_SUCCEEDED" }], totalPages: 1 });
    if (url.includes("/rrsets?")) return json({ rrSets: rrsets, totalPages: 1, totalItems: 2, itemsPerPage: 1000 });
    if (url.endsWith("/rrsets") && method === "POST") return json({ rrset: { id: "new" } }, 202);
    if (/\/rrsets\/r1$/.test(url) && method === "PATCH") return json({ rrset: { id: "r1" } }, 202);
    return json({ message: "nicht gefunden" }, 404);
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe("Konnektor (gegen Fake-API)", () => {
  const mk = () => {
    const f = fakeApi();
    const client = stackitClient({ projectId: "p-1", token: async () => "tok", baseUrl: "http://mock", fetcher: f.fetcher });
    return { ...f, client, api: stackitApi(client) };
  };

  it("liest Einträge der Zone, ignoriert gelöschte RRSets, sendet Bearer-Token", async () => {
    const { api, calls } = mk();
    const recs = await api.listRecords(zone);
    expect(recs).toEqual([{ id: "r1", type: "TXT", name: "kunde.de", value: "v=spf1 include:spf.protection.outlook.com -all", ttl: 3600 }]);
    expect(calls[0].url).toBe("http://mock/v1/projects/p-1/zones?dnsName[eq]=kunde.de&pageSize=100");
  });

  it("legt neues RRSet mit FQDN und Punkt an", async () => {
    const { api, calls } = mk();
    await api.createRecord(zone, { type: "CNAME", name: "angebot.kunde.de", value: "sites.pioneerdesk.cloud", ttl: 3600, purpose: "landing" });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("http://mock/v1/projects/p-1/zones/z1/rrsets");
    expect(post.body).toMatchObject({ name: "angebot.kunde.de.", type: "CNAME", ttl: 3600, records: [{ content: "sites.pioneerdesk.cloud." }] });
  });

  it("ergänzt ein bestehendes RRSet, statt es zu ersetzen", async () => {
    const { api, calls } = mk();
    await api.createRecord(zone, { type: "TXT", name: "kunde.de", value: "pd-verify=abc", ttl: 3600, purpose: "verify" });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toMatchObject({ records: [{ content: "v=spf1 include:spf.protection.outlook.com -all" }, { content: "pd-verify=abc" }] });
  });

  it("ändert nur den betroffenen Wert", async () => {
    const { api, calls } = mk();
    const [existing] = await api.listRecords(zone);
    await api.updateRecord(zone, existing, "v=spf1 include:spf.protection.outlook.com include:relay.example -all", { type: "TXT", name: "kunde.de", value: "", ttl: 3600, purpose: "spf" });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toMatchObject({ records: [{ content: "v=spf1 include:spf.protection.outlook.com include:relay.example -all" }] });
  });
});

describe("Anmeldung per Service Account", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const key: ServiceAccountKey = { credentials: { aud: "https://stackit-service-account-prod.apps.01.cf.eu01.stackit.cloud", iss: "sa@sa.stackit.cloud", kid: "kid-1", sub: "00000000-0000-0000-0000-000000000001", privateKey: pem } };
  afterEach(() => resetStackitTokenCache());

  it("JWT: RS512, kid im Header, Claims nach SDK, gültige Signatur", () => {
    const jwt = buildAssertion(key, pem, 1_700_000_000);
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS512", typ: "JWT", kid: "kid-1" });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims).toMatchObject({ iss: key.credentials.iss, sub: key.credentials.sub, aud: key.credentials.aud, iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    const ok = createVerify("RSA-SHA512").update(`${h}.${p}`).verify(createPublicKey(publicKey.export({ type: "spki", format: "pem" })), Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
  });

  it("tauscht das JWT gegen ein Token (jwt-bearer) und speichert es zwischen", async () => {
    let n = 0;
    let sent = "";
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
    const fetcher = (async (_url: string, init?: RequestInit) => {
      n++;
      sent = String(init?.body);
      return new Response(JSON.stringify({ access_token: access }), { status: 200 });
    }) as unknown as typeof fetch;
    const env = { STACKIT_DNS_PROJECT_ID: "p", STACKIT_SERVICE_ACCOUNT_KEY: JSON.stringify(key) } as unknown as NodeJS.ProcessEnv;
    expect(await stackitAccessToken({ fetcher, env })).toBe(access);
    expect(await stackitAccessToken({ fetcher, env })).toBe(access);
    expect(n).toBe(1);
    expect(sent).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(sent).toContain("assertion=");
    expect(jwtExp(access)).toBe(exp);
  });

  it("ohne Konfiguration klarer Fehler", async () => {
    await expect(stackitAccessToken({ env: {} as unknown as NodeJS.ProcessEnv })).rejects.toThrow(/nicht eingerichtet/);
  });
});

/** Fake-Resolver: feste Antworten je „TYP name“. */
function fakeResolver(name: string, answers: Record<string, string[]>): DnsLookup {
  return { name, resolve: async (host: string, type: LookupType) => answers[`${type} ${host}`] ?? [] };
}

describe("Bestand erfassen", () => {
  it("per DNS: Spitze, CNAME exklusiv, DKIM-CNAME, SRV, DMARC", async () => {
    const r = fakeResolver("fake", {
      "A kunde.de": ["203.0.113.5"],
      "MX kunde.de": ["0 kunde-de.mail.protection.outlook.com"],
      "TXT kunde.de": ["v=spf1 include:spf.protection.outlook.com -all", "MS=ms123"],
      "CNAME www.kunde.de": ["kunde.de"],
      "A www.kunde.de": ["203.0.113.5"],
      "CNAME autodiscover.kunde.de": ["autodiscover.outlook.com"],
      "CNAME selector1._domainkey.kunde.de": ["selector1-kunde-de._domainkey.kunde.onmicrosoft.com"],
      "TXT _dmarc.kunde.de": ["v=DMARC1; p=quarantine"],
      "SRV _sipfederationtls._tcp.kunde.de": ["100 1 5061 sipfed.online.lync.com"],
    });
    const { items, warnings } = await inventoryFromDns(zone, r);
    const keys = items.map((i) => `${i.type} ${i.name}`);
    expect(keys).toEqual(expect.arrayContaining(["A kunde.de", "MX kunde.de", "TXT kunde.de", "CNAME www.kunde.de", "CNAME autodiscover.kunde.de", "CNAME selector1._domainkey.kunde.de", "TXT _dmarc.kunde.de", "SRV _sipfederationtls._tcp.kunde.de"]));
    expect(keys).not.toContain("A www.kunde.de"); // neben CNAME nichts weiter
    expect(warnings[0]).toMatch(/Subdomains/);
    expect(items.every((i) => i.include)).toBe(true);
  });

  it("warnt ohne MX", async () => {
    const { warnings } = await inventoryFromDns(zone, fakeResolver("leer", {}));
    expect(warnings.some((w) => /MX/.test(w))).toBe(true);
  });

  it("per API: NS/SOA der Spitze weglassen, gruppieren, Unbekanntes melden", () => {
    const { items, warnings } = inventoryFromApi(zone, [
      { type: "NS", name: "kunde.de", value: "ns1.domaincontrol.com" },
      { type: "SOA", name: "kunde.de", value: "x" },
      { type: "A", name: "kunde.de", value: "203.0.113.5" },
      { type: "A", name: "kunde.de", value: "203.0.113.6" },
      { type: "NS", name: "dev.kunde.de", value: "ns.dev.example" },
      { type: "HINFO", name: "kunde.de", value: "x" },
    ]);
    expect(items.find((i) => i.type === "A")?.values).toEqual(["203.0.113.5", "203.0.113.6"]);
    expect(items.some((i) => i.type === "NS" && i.name === "dev.kunde.de")).toBe(true);
    expect(items.some((i) => i.type === "SOA")).toBe(false);
    expect(warnings[0]).toMatch(/HINFO/);
  });

  it("manuelle Zeilen: Formate, Fehler, Zusammenführen", () => {
    const r = parseManualLines(zone, "intern A 203.0.113.10\n@ 600 IN TXT \"google-site-verification=x\"\nfoo XYZ bar\nkaputt");
    expect(r.items.map((i) => `${i.type} ${i.name} ${i.values[0]} ${i.ttl}`)).toEqual(["A intern.kunde.de 203.0.113.10 3600", "TXT kunde.de google-site-verification=x 600"]);
    expect(r.errors).toHaveLength(2);
    const merged = mergeItems([{ type: "TXT", name: zone, values: ["a"], ttl: 3600, source: "dns", include: true }], r.items);
    expect(merged.find((i) => i.type === "TXT")?.values).toEqual(["a", "google-site-verification=x"]);
  });
});

describe("Zonendatei (BIND)", () => {
  it("enthält $ORIGIN, SOA, NS und korrekt formatierte Einträge", () => {
    const txt = toBindZone(zone, [
      { type: "A", name: "kunde.de", values: ["203.0.113.5"], ttl: 3600 },
      { type: "CNAME", name: "www.kunde.de", values: ["kunde.de"], ttl: 300 },
      { type: "MX", name: "kunde.de", values: ["0 kunde-de.mail.protection.outlook.com"], ttl: 3600 },
      { type: "TXT", name: "kunde.de", values: ['v=spf1 "quoted" -all', "x".repeat(300)], ttl: 3600 },
      { type: "NS", name: "kunde.de", values: ["ns1.domaincontrol.com"], ttl: 3600 },
    ], { nameservers: ["ns1.stackit.cloud", "ns2.stackit.zone"], serial: 2026100701 });
    expect(txt).toContain("$ORIGIN kunde.de.");
    expect(txt).toMatch(/@\tIN\tSOA\tns1\.stackit\.cloud\. hostmaster\.kunde\.de\. \(2026100701 /);
    expect(txt).toContain("@\tIN\tNS\tns2.stackit.zone.");
    expect(txt).not.toContain("ns1.domaincontrol.com");
    expect(txt).toContain("www\t300\tIN\tCNAME\tkunde.de.");
    expect(txt).toContain("@\t3600\tIN\tMX\t0 kunde-de.mail.protection.outlook.com.");
    expect(txt).toContain('"v=spf1 \\"quoted\\" -all"');
    expect(txt).toContain(`"${"x".repeat(255)}" "${"x".repeat(45)}"`);
  });
});

describe("Delegation", () => {
  it("aktiv erst, wenn die Mehrheit der Resolver nur STACKIT-Nameserver liefert", async () => {
    const stackit = { "NS kunde.de": ["ns1.stackit.cloud", "ns2.stackit.zone"] };
    const alt = { "NS kunde.de": ["ns1.domaincontrol.com", "ns2.domaincontrol.com"] };
    expect((await checkDelegation(zone, [fakeResolver("a", stackit), fakeResolver("b", stackit), fakeResolver("c", alt)])).ok).toBe(true);
    const half = await checkDelegation(zone, [fakeResolver("a", stackit), fakeResolver("b", alt)]);
    expect(half.ok).toBe(false);
    expect(half.found).toContain("ns1.domaincontrol.com");
  });
});
