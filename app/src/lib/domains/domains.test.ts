import { describe, expect, it } from "vitest";
import { detectProvider } from "./catalog";
import { buildApplyUrl } from "./domainconnect-url";
import { evaluate, nextCheckDelayMs, obsKey } from "./evaluate";
import { isApex, normalizeHostname, registrableDomain, relativeName } from "./hostname";
import { mergeSpf, planChanges, planIsApplicable } from "./plan";
import { cloudflareApi } from "./providers/cloudflare";
import { godaddyApi } from "./providers/godaddy";
import { hetznerApi } from "./providers/hetzner";
import { ionosApi } from "./providers/ionos";
import { desiredRecords, valueMatches, verifyName, verifyValue, type TargetConfig } from "./records";
import { appHostsFrom, domainRewritePath } from "./routing";

const CFG: TargetConfig = { cnameTarget: "sites.pioneerdesk.cloud", ipv4: ["203.0.113.10"], ipv6: [], spfInclude: "spf.relay.example", dkim: { selector: "pd1", target: "pd1.dkim.relay.example" } };

describe("Hostnamen", () => {
  it("normalisiert URLs und lehnt Ungültiges ab", () => {
    expect(normalizeHostname("https://Angebot.Kunde.de/pfad?x=1")).toBe("angebot.kunde.de");
    expect(normalizeHostname("kunde.de.")).toBe("kunde.de");
    expect(normalizeHostname("localhost")).toBeNull();
    expect(normalizeHostname("1.2.3.4")).toBeNull();
    expect(normalizeHostname("-bad.kunde.de")).toBeNull();
    expect(normalizeHostname("a..b.de")).toBeNull();
  });
  it("erkennt Zonen-Spitze inkl. mehrteiliger Endungen", () => {
    expect(registrableDomain("angebot.kunde.de")).toBe("kunde.de");
    expect(registrableDomain("shop.firma.co.uk")).toBe("firma.co.uk");
    expect(isApex("kunde.de")).toBe(true);
    expect(isApex("www.kunde.de")).toBe(false);
    expect(relativeName("_pd-verify.angebot.kunde.de", "kunde.de")).toBe("_pd-verify.angebot");
    expect(relativeName("kunde.de", "kunde.de")).toBe("@");
  });
});

describe("Anbieter-Erkennung aus Nameservern", () => {
  it.each([
    [["ns1045.ui-dns.de", "ns1102.ui-dns.com", "ns1037.ui-dns.org"], "ionos"],
    [["ns-webde.ui-dns.de", "ns-webde.ui-dns.com"], "webde"],
    [["ns-gmx.ui-dns.de", "ns-gmx.ui-dns.biz"], "gmx"],
    [["ns43.domaincontrol.com", "ns44.domaincontrol.com"], "godaddy"],
    [["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"], "cloudflare"],
    [["hydrogen.ns.hetzner.com", "oxygen.ns.hetzner.com", "helium.ns.hetzner.de"], "hetzner"],
    [["ns.inwx.de", "ns2.inwx.de", "ns3.inwx.eu"], "inwx"],
    [["root-dns.netcup.net", "second-dns.netcup.net"], "netcup"],
    [["docks17.rzone.de", "shades03.rzone.de"], "strato"],
    [["ns1.example-dns.org"], "unknown"],
  ])("%j → %s", (ns, key) => {
    expect(detectProvider(ns as string[]).key).toBe(key);
  });
  it("Automatik nur dort, wo es eine API gibt", () => {
    expect(detectProvider(["ns-webde.ui-dns.de"]).api).toBe(false);
    expect(detectProvider(["ns1045.ui-dns.de"]).api).toBe(true);
  });
});

describe("Soll-Einträge", () => {
  it("Subdomain: CNAME + Besitznachweis", () => {
    const r = desiredRecords("angebot.kunde.de", "landing", "tok", CFG);
    expect(r).toEqual([
      expect.objectContaining({ type: "TXT", name: "_pd-verify.angebot.kunde.de", value: "pd-verify=tok", purpose: "verify" }),
      expect.objectContaining({ type: "CNAME", name: "angebot.kunde.de", value: "sites.pioneerdesk.cloud", purpose: "landing" }),
    ]);
  });
  it("Apex: A/AAAA statt CNAME", () => {
    const r = desiredRecords("kunde.de", "landing", "tok", CFG);
    expect(r.some((x) => x.type === "CNAME")).toBe(false);
    expect(r.find((x) => x.type === "A")?.value).toBe("203.0.113.10");
  });
  it("Mail: SPF, DKIM, DMARC", () => {
    const r = desiredRecords("kunde.de", "mail", "tok", CFG);
    expect(r.map((x) => x.purpose)).toEqual(["verify", "spf", "dkim", "dmarc"]);
    expect(r.find((x) => x.purpose === "dkim")?.name).toBe("pd1._domainkey.kunde.de");
  });
  it("SPF/DMARC werden tolerant verglichen", () => {
    const spf = desiredRecords("kunde.de", "mail", "t", CFG).find((x) => x.purpose === "spf")!;
    expect(valueMatches(spf, "v=spf1 include:_spf.google.com include:spf.relay.example -all")).toBe(true);
    expect(valueMatches(spf, "v=spf1 include:_spf.google.com -all")).toBe(false);
  });
});

describe("Prüfauswertung", () => {
  const desired = desiredRecords("angebot.kunde.de", "landing", "tok", CFG);
  const good = { [obsKey("TXT", verifyName("angebot.kunde.de"))]: [verifyValue("tok")], [obsKey("CNAME", "angebot.kunde.de")]: ["sites.pioneerdesk.cloud"] };
  it("alles korrekt über alle Resolver", () => {
    const rep = evaluate(desired, { a: good, b: good, c: good });
    expect(rep.allRequiredOk).toBe(true);
    expect(rep.ownership).toBe(true);
    expect(rep.propagation).toEqual({ ok: 3, total: 3 });
  });
  it("fehlend vs. falsch", () => {
    const rep = evaluate(desired, { a: { [obsKey("CNAME", "angebot.kunde.de")]: ["alt.example.com"] } });
    expect(rep.records.find((r) => r.purpose === "verify")?.status).toBe("missing");
    expect(rep.records.find((r) => r.purpose === "landing")?.status).toBe("wrong");
    expect(rep.records.find((r) => r.purpose === "landing")?.found).toEqual(["alt.example.com"]);
    expect(rep.ownership).toBe(false);
  });
  it("Mehrheit entscheidet bei laufender Verbreitung", () => {
    const rep = evaluate(desired, { a: good, b: good, c: {}, d: {} });
    expect(rep.allRequiredOk).toBe(false); // 2 von 4 ist keine Mehrheit
    expect(rep.propagation.ok).toBe(2);
    const rep2 = evaluate(desired, { a: good, b: good, c: good, d: {} });
    expect(rep2.allRequiredOk).toBe(true);
  });
  it("CNAME-Flattening zählt als korrekt", () => {
    const rep = evaluate(desired, { a: { [obsKey("TXT", verifyName("angebot.kunde.de"))]: [verifyValue("tok")] } }, { flattened: { a: true } });
    expect(rep.allRequiredOk).toBe(true);
  });
  it("Backoff wächst und bleibt bei 60 min", () => {
    expect(nextCheckDelayMs(0)).toBe(60_000);
    expect(nextCheckDelayMs(3)).toBe(10 * 60_000);
    expect(nextCheckDelayMs(50)).toBe(60 * 60_000);
  });
});

describe("Änderungsplan", () => {
  const desired = desiredRecords("angebot.kunde.de", "landing", "tok", CFG);
  it("legt fehlende Einträge an, lässt fremde TXT in Ruhe", () => {
    const steps = planChanges(desired, [{ type: "TXT", name: "_pd-verify.angebot.kunde.de", value: "fremd" }]);
    expect(steps.map((s) => s.action)).toEqual(["create", "create"]);
  });
  it("Konflikt, wenn unter dem Namen schon ein A-Eintrag steht", () => {
    const steps = planChanges(desired, [{ type: "A", name: "angebot.kunde.de", value: "198.51.100.1" }]);
    expect(steps[1].action).toBe("conflict");
    expect(planIsApplicable(steps)).toBe(false);
  });
  it("falsches CNAME-Ziel wird geändert", () => {
    const steps = planChanges(desired, [{ id: "1", type: "CNAME", name: "angebot.kunde.de", value: "old.example.com" }]);
    expect(steps[1]).toMatchObject({ action: "update", newValue: "sites.pioneerdesk.cloud" });
  });
  it("Apex mit bestehender Website wird nicht überschrieben", () => {
    const steps = planChanges(desiredRecords("kunde.de", "landing", "t", CFG), [{ type: "A", name: "kunde.de", value: "198.51.100.7" }]);
    expect(steps.find((s) => s.desired.type === "A")?.action).toBe("conflict");
  });
  it("SPF wird ergänzt statt ersetzt, DMARC bleibt", () => {
    const steps = planChanges(desiredRecords("kunde.de", "mail", "t", CFG), [
      { id: "s", type: "TXT", name: "kunde.de", value: "v=spf1 include:_spf.google.com ~all" },
      { id: "d", type: "TXT", name: "_dmarc.kunde.de", value: "v=DMARC1; p=reject" },
    ]);
    expect(steps.find((s) => s.desired.purpose === "spf")).toMatchObject({ action: "update", newValue: "v=spf1 include:_spf.google.com include:spf.relay.example ~all" });
    expect(steps.find((s) => s.desired.purpose === "dmarc")?.action).toBe("keep");
    expect(mergeSpf("v=spf1 a mx", "x.example")).toBe("v=spf1 a mx include:x.example");
  });
});

// Minimaler Fake-Fetch, der Anfragen protokolliert und vorbereitete Antworten liefert
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { method: string; url: string; body?: unknown; headers: Record<string, string> }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.startsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : {}), { status: key ? 200 : 404 });
  }) as typeof fetch;
  return { f, calls };
}

describe("Anbieter-APIs (Payloads nach Doku)", () => {
  const rec = desiredRecords("angebot.kunde.de", "landing", "tok", CFG)[1];
  it("IONOS: X-API-Key, Zonen-ID, Array-Payload", async () => {
    const { f, calls } = fakeFetch({ "GET https://x/zones": [{ id: "z1", name: "kunde.de" }], "POST https://x/zones/z1/records": [{}] });
    await ionosApi({ apiKey: "pre.sec" }, { baseUrl: "https://x", fetcher: f }).createRecord("kunde.de", rec);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.headers["X-API-Key"]).toBe("pre.sec");
    expect(post.body).toEqual([{ name: "angebot.kunde.de", type: "CNAME", content: "sites.pioneerdesk.cloud", ttl: 3600, prio: 0, disabled: false }]);
  });
  it("Cloudflare: Bearer, proxied:false", async () => {
    const { f, calls } = fakeFetch({ "GET https://cf/zones?name=kunde.de": { success: true, result: [{ id: "cz" }] }, "POST https://cf/zones/cz/dns_records": { success: true, result: {} } });
    await cloudflareApi({ apiToken: "tkn" }, { baseUrl: "https://cf", fetcher: f }).createRecord("kunde.de", rec);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.headers.authorization).toBe("Bearer tkn");
    expect(post.body).toMatchObject({ type: "CNAME", name: "angebot.kunde.de", content: "sites.pioneerdesk.cloud", proxied: false });
  });
  it("Hetzner (Cloud-API): RRSet mit relativem Namen, CNAME mit Punkt", async () => {
    const { f, calls } = fakeFetch({ "GET https://h/zones?name=kunde.de": { zones: [{ id: 7, name: "kunde.de" }] }, "GET https://h/zones/7/rrsets": { rrsets: [] }, "POST https://h/zones/7/rrsets": { rrset: {} } });
    await hetznerApi({ apiToken: "t" }, { baseUrl: "https://h", fetcher: f }).createRecord("kunde.de", rec);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ name: "angebot", type: "CNAME", records: [{ value: "sites.pioneerdesk.cloud." }] });
  });
  it("GoDaddy: sso-key, PATCH ohne Ersetzen, TTL ≥ 600", async () => {
    const { f, calls } = fakeFetch({ "PATCH https://g/v1/domains/kunde.de/records": {} });
    await godaddyApi({ apiKey: "k", apiSecret: "s" }, { baseUrl: "https://g", fetcher: f }).createRecord("kunde.de", { ...rec, ttl: 300 });
    expect(calls[0].headers.authorization).toBe("sso-key k:s");
    expect(calls[0].body).toEqual([{ type: "CNAME", name: "angebot", data: "sites.pioneerdesk.cloud", ttl: 600 }]);
  });
  it("Verständlicher Fehler bei falschem Schlüssel", async () => {
    const f = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(ionosApi({ apiKey: "x.y" }, { baseUrl: "https://x", fetcher: f }).test("kunde.de")).rejects.toThrow(/Zugangsdaten ungültig/);
  });
});

describe("Domain Connect", () => {
  it("baut die synchrone Anwendungs-URL", () => {
    const url = buildApplyUrl(
      { providerId: "ionos.com", providerName: "IONOS", urlSyncUX: "https://dcc.ionos.com/" },
      { providerId: "pioneerdesk.cloud", serviceId: "landing" },
      { zone: "kunde.de", host: "angebot", target: "sites.pioneerdesk.cloud", verify: "pd-verify=t" },
    );
    expect(url).toBe("https://dcc.ionos.com/v2/domainTemplates/providers/pioneerdesk.cloud/services/landing/apply?domain=kunde.de&target=sites.pioneerdesk.cloud&verify=pd-verify%3Dt&host=angebot");
  });
});

describe("Host-Routing (Middleware)", () => {
  const app = appHostsFrom({ APP_URL: "https://crm.pioneerdesk.cloud", APP_HOSTS: "admin.pioneerdesk.cloud" });
  it("Plattform-Hosts bleiben unverändert", () => {
    expect(domainRewritePath("crm.pioneerdesk.cloud", "/sa/x", app)).toBeNull();
    expect(domainRewritePath("127.0.0.1", "/", app)).toBeNull();
    expect(domainRewritePath("admin.pioneerdesk.cloud", "/", app)).toBeNull();
  });
  it("Kundendomain wird auf /d/<host> umgeschrieben", () => {
    expect(domainRewritePath("angebot.kunde.de", "/", app)).toBe("/d/angebot.kunde.de");
    expect(domainRewritePath("angebot.kunde.de", "/sommer", app)).toBe("/d/angebot.kunde.de/sommer");
    expect(domainRewritePath("angebot.kunde.de", "/robots.txt", app)).toBe("/d/angebot.kunde.de/robots.txt");
  });
  it("Plattform-Funktionen auf Kundendomains bleiben erreichbar", () => {
    expect(domainRewritePath("angebot.kunde.de", "/api/a/collect", app)).toBeNull();
    expect(domainRewritePath("angebot.kunde.de", "/_next/static/x.js", app)).toBeNull();
    expect(domainRewritePath("angebot.kunde.de", "/d/andere.de", app)).toBeNull();
  });
});
