import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { SLUG, db, wsId } from "./helpers";
import { portalToken } from "../src/lib/billing/crypto";
import { payToken } from "../src/lib/payments/crypto";

// Barrierefreiheit: gemeinsamer axe-Scan (WCAG 2.1 A/AA) und öffentliche Testseiten mit gültigen Links.
// Genutzt von der Suite u-a11y.spec.ts und dem Erkundungsskript e2e/explore/.

export type Violation = { id: string; impact: string | null; help: string; nodes: { target: string; html: string; summary: string }[] };

/** axe-Scan nach WCAG 2.0/2.1 A + AA. Gibt alle Verstöße zurück (Filter auf critical/serious beim Aufrufer). */
export async function axeScan(page: Page): Promise<Violation[]> {
  const res = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // Next.js-Entwicklerwerkzeuge und der Routen-Ansager gehören nicht zur App
    .exclude("nextjs-portal")
    .exclude("#__next-route-announcer__")
    .analyze();
  return res.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    nodes: v.nodes.slice(0, 8).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 200), summary: (n.failureSummary ?? "").slice(0, 300) })),
  }));
}

export const isBlocking = (v: Violation) => v.impact === "critical" || v.impact === "serious";

/** Kurzform für Fehlermeldungen: „color-contrast (serious): 3× – button.foo …“ */
export function describe(vs: Violation[]): string {
  return vs.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× – ${v.nodes.slice(0, 3).map((n) => n.target).join(" | ")}`).join("\n");
}

const TAG = "E2E-A11y";

/**
 * Legt die Daten für die öffentlichen Seiten an (idempotent) und liefert die Adressen:
 * Formular, Buchung, Landingpage, Kundenportal, Angebotsannahme, Bezahlseite.
 */
export async function publicPages(): Promise<Record<string, string>> {
  const ws = await wsId();
  const secret = process.env.APP_SECRET;
  const form = await db().form.findFirstOrThrow({ where: { workspaceId: ws }, orderBy: { createdAt: "asc" } });
  const page = await db().landingPage.findFirstOrThrow({ where: { workspaceId: ws, status: "PUBLISHED" }, orderBy: { createdAt: "asc" } });
  const bookingSlug = "e2e-a11y-erstgespraech";
  const allDay = [["08:00", "18:00"]];
  await db().meetingType.upsert({
    where: { workspaceId_name: { workspaceId: ws, name: `${TAG} Erstgespräch` } },
    update: { bookingEnabled: true, bookingSlug, minNoticeHours: 2 },
    create: {
      workspaceId: ws, name: `${TAG} Erstgespräch`, titleTemplate: "Erstgespräch mit {{ contact.FIRSTNAME }}", description: "30 Minuten zum Kennenlernen.",
      durationMin: 30, videoProvider: "jitsi", bookingEnabled: true, bookingSlug, minNoticeHours: 2,
      availability: { mo: allDay, di: allDay, mi: allDay, do: allDay, fr: allDay, sa: allDay, so: allDay, zeitzone: "Europe/Berlin", feiertage: false },
      questions: [{ key: "thema", label: "Worum geht es?", type: "text", required: false }],
    },
  });
  const contact =
    (await db().contact.findFirst({ where: { workspaceId: ws, company: `${TAG} GmbH` } })) ??
    (await db().contact.create({ data: { workspaceId: ws, firstName: "Erika", lastName: "Barrierefrei", email: "a11y-kundin@example.com", company: `${TAG} GmbH` } }));
  const invoice =
    (await db().invoice.findFirst({ where: { workspaceId: ws, number: `${TAG}-RE` } })) ??
    (await db().invoice.create({
      data: {
        workspaceId: ws, contactId: contact.id, kind: "INVOICE", number: `${TAG}-RE`, status: "SENT", issueDate: new Date(), dueDate: new Date(Date.now() + 14 * 864e5),
        items: [{ title: "Beratung Barrierefreiheit", qty: 3, unitCents: 95000, vatRate: 19, unit: "HOUR" }], netCents: 285000, vatCents: 54150, grossCents: 339150,
        buyerName: `${TAG} GmbH`, buyerAddress: "Hauptstr. 1\n80331 München", buyerEmail: contact.email,
      },
    }));
  const quote =
    (await db().invoice.findFirst({ where: { workspaceId: ws, number: `${TAG}-AN` } })) ??
    (await db().invoice.create({
      data: {
        workspaceId: ws, contactId: contact.id, kind: "QUOTE", number: `${TAG}-AN`, status: "SENT", issueDate: new Date(), dueDate: new Date(Date.now() + 30 * 864e5),
        items: [{ title: "Workshop Barrierefreiheit", qty: 2, unitCents: 120000, vatRate: 19, unit: "DAY" }], netCents: 240000, vatCents: 45600, grossCents: 285600,
        buyerName: `${TAG} GmbH`, buyerAddress: "Hauptstr. 1\n80331 München", buyerEmail: contact.email,
      },
    }));
  const urls: Record<string, string> = {
    login: "/login",
    "404": "/gibt-es-nicht-a11y",
    formular: `/f/${form.id}`,
    buchung: `/buchen/${SLUG}/${bookingSlug}`,
    landingpage: `/p/${SLUG}/${page.lang}/${page.slug}`,
  };
  if (secret) {
    const exp = Date.now() + 5 * 864e5;
    const sig = createHmac("sha256", secret).update(`doc-accept:${quote.id}:${exp}`).digest("base64url");
    urls.kundenportal = `/kundenportal/${portalToken(contact.id)}`;
    urls.annahme = `/dokument/${quote.id}.${exp}.${sig}`;
    urls.zahlung = `/zahlung/${payToken(invoice.id)}`;
  }
  return urls;
}

/** Entfernt die Daten aus publicPages() wieder. */
export async function cleanupPublicPages() {
  const ws = await wsId();
  await db().invoice.deleteMany({ where: { workspaceId: ws, number: { startsWith: TAG } } });
  await db().meetingType.deleteMany({ where: { workspaceId: ws, name: { startsWith: TAG } } });
  await db().contact.deleteMany({ where: { workspaceId: ws, company: `${TAG} GmbH` } });
}
