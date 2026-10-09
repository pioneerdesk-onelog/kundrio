import "server-only";
import { resolveTxt } from "node:dns/promises";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { CATALOG } from "./compliance-catalog";
import { externalConnections, regionViolations } from "./compliance-connections";

export type AutoResult = { ok: boolean | null; summary: string; details?: string[]; checkedAt: string };

const DKIM_SELECTORS = ["default", "google", "selector1", "selector2", "k1", "mail", "brevo", "brevo1", "brevo2", "resend", "dkim", "s1", "s2"];

async function txt(name: string): Promise<string[]> {
  try {
    const rows = await Promise.race([
      resolveTxt(name),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("DNS-Timeout")), 5000)),
    ]);
    return rows.map((r) => r.join(""));
  } catch {
    return [];
  }
}

export async function checkMailAuth(domain: string) {
  const [root, dmarcRows] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)]);
  const spf = root.find((r) => /^v=spf1\b/i.test(r));
  const dmarc = dmarcRows.find((r) => /^v=DMARC1\b/i.test(r));
  const policy = dmarc ? /;\s*p=(\w+)/i.exec(dmarc)?.[1]?.toLowerCase() ?? "?" : null;
  const dkimHits: string[] = [];
  await Promise.all(
    DKIM_SELECTORS.map(async (s) => {
      const rows = await txt(`${s}._domainkey.${domain}`);
      if (rows.some((r) => /v=DKIM1|k=rsa|p=/i.test(r))) dkimHits.push(s);
    }),
  );
  return { spf: spf ?? null, dmarc: dmarc ?? null, dmarcPolicy: policy, dkimSelectors: dkimHits.sort() };
}

const now = () => new Date().toISOString();

/** Führt alle automatischen Prüfungen für einen Sub-Account aus und speichert autoResult. Status bleibt unverändert. */
export async function runAutoChecks(workspaceId: string) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const results: Record<string, AutoResult> = {};
  const mailDomain = ws.mailFromEmail?.split("@")[1] ?? ws.domain;

  if (mailDomain) {
    const m = await checkMailAuth(mailDomain);
    results["MAIL_AUTH:spf"] = { ok: !!m.spf, summary: m.spf ? `SPF gefunden für ${mailDomain}` : `Kein SPF für ${mailDomain}`, details: m.spf ? [m.spf] : [], checkedAt: now() };
    results["MAIL_AUTH:dmarc"] = {
      ok: m.dmarc ? m.dmarcPolicy !== "none" : false,
      summary: m.dmarc ? `DMARC vorhanden, Richtlinie p=${m.dmarcPolicy}${m.dmarcPolicy === "none" ? " (nur Beobachtung – Ziel quarantine/reject)" : ""}` : "Kein DMARC-Eintrag",
      details: m.dmarc ? [m.dmarc] : [],
      checkedAt: now(),
    };
    results["MAIL_AUTH:dkim"] = {
      ok: m.dkimSelectors.length ? true : null,
      summary: m.dkimSelectors.length ? `DKIM-Selektor(en): ${m.dkimSelectors.join(", ")}` : "Kein DKIM unter gängigen Selektoren gefunden (eigener Selektor möglich – manuell prüfen)",
      checkedAt: now(),
    };
  } else {
    for (const k of ["spf", "dmarc", "dkim"]) results[`MAIL_AUTH:${k}`] = { ok: null, summary: "Keine Domain/Absenderadresse hinterlegt", checkedAt: now() };
  }

  // Eigene Mail-Domains aus dem Domains-Assistenten zusätzlich prüfen (Ergebnis je Domain in den Details)
  const mailDomains = await db.domain.findMany({ where: { workspaceId, purpose: "mail", status: { in: ["verifying", "active"] } }, select: { hostname: true } });
  for (const dm of mailDomains) {
    if (dm.hostname === mailDomain) continue;
    const m = await checkMailAuth(dm.hostname);
    const lines: [string, boolean, string][] = [
      ["spf", !!m.spf, m.spf ? "SPF vorhanden" : "kein SPF"],
      ["dmarc", !!m.dmarc && m.dmarcPolicy !== "none", m.dmarc ? `DMARC p=${m.dmarcPolicy}` : "kein DMARC"],
      ["dkim", m.dkimSelectors.length > 0, m.dkimSelectors.length ? `DKIM: ${m.dkimSelectors.join(", ")}` : "kein DKIM unter gängigen Selektoren"],
    ];
    for (const [k, ok, line] of lines) {
      const r = results[`MAIL_AUTH:${k}`];
      r.details = [...(r.details ?? []), `${dm.hostname}: ${line}`];
      if (!ok && k !== "dkim") r.ok = false;
    }
  }

  const pages = await db.landingPage.findMany({ where: { workspaceId, status: "PUBLISHED" }, select: { slug: true, lang: true, a11yReport: true, aiGenerated: true } });
  const withErrors = pages.filter((p) => {
    const r = p.a11yReport as { errors?: unknown[] } | null;
    return !r || (Array.isArray(r.errors) && r.errors.length > 0);
  });
  results["BFSG:pages-wcag"] = {
    ok: pages.length === 0 ? null : withErrors.length === 0,
    summary: pages.length === 0 ? "Noch keine veröffentlichten Seiten" : `${pages.length - withErrors.length} von ${pages.length} veröffentlichten Seiten ohne Fehler`,
    details: withErrors.map((p) => `${p.lang}/${p.slug}: ${p.a11yReport ? "Fehler im Bericht" : "nicht geprüft"}`),
    checkedAt: now(),
  };
  const aiPages = pages.filter((p) => p.aiGenerated);
  results["AI_ACT:generated-content"] = {
    ok: null,
    summary: `${aiPages.length} veröffentlichte Seite(n) mit KI-Inhalten – Hinweis im Seitenfuß bitte stichprobenartig prüfen`,
    checkedAt: now(),
  };

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const aiCalls = await db.aiUsageLog.count({ where: { workspaceId, createdAt: { gte: since } } });
  results["AI_ACT:usage-log"] = { ok: true, summary: `Protokoll aktiv: ${aiCalls} KI-Aufrufe in 30 Tagen`, checkedAt: now() };

  const missingInvoice = [!ws.legalName && "Firmenname", !ws.legalAddress && "Anschrift", !ws.vatId && "USt-IdNr.", !ws.iban && "IBAN"].filter(Boolean) as string[];
  results["E_RECHNUNG:send"] = {
    ok: missingInvoice.length === 0,
    summary: missingInvoice.length ? `XRechnung-Export vorhanden, es fehlen Firmendaten: ${missingInvoice.join(", ")}` : "XRechnung-Export vorhanden, Firmendaten vollständig",
    checkedAt: now(),
  };

  results["DSGVO:export"] = { ok: true, summary: "ZIP-Export unter Einstellungen → Datenexport verfügbar", checkedAt: now() };
  const retention = await db.job.findFirst({ where: { type: "analytics.retention" }, orderBy: { createdAt: "desc" } });
  results["DSGVO:retention"] = {
    ok: retention ? retention.status !== "failed" : false,
    summary: retention ? `Letzter Lauf: ${retention.status} (${retention.updatedAt.toISOString().slice(0, 10)})` : "Kein Job analytics.retention gefunden",
    checkedAt: now(),
  };

  const conns = externalConnections();
  const violations = regionViolations(conns, ws);
  results["SOUVERAENITAET:region"] = {
    ok: violations.length === 0,
    summary: violations.length ? `${violations.length} aktive Verbindung(en) außerhalb ${ws.region}` : `Alle aktiven Verbindungen passen zu Region ${ws.region}`,
    details: violations.map((v) => `${v.name} (${v.location})`),
    checkedAt: now(),
  };

  // Ergebnisse an vorhandene Pflichtpunkte hängen (Katalog muss übernommen sein)
  const autoKeys = new Set(CATALOG.filter((c) => c.auto).map((c) => `${c.framework}:${c.key}`));
  for (const [k, r] of Object.entries(results)) {
    if (!autoKeys.has(k)) continue;
    const [framework, key] = k.split(":");
    await db.complianceItem.updateMany({
      where: { workspaceId, framework, key },
      data: { autoResult: r as unknown as Prisma.InputJsonValue },
    });
  }
  return results;
}
