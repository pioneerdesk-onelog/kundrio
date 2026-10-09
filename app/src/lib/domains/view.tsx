import "server-only";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { after } from "next/server";
import { Render } from "@puckeditor/core";
import type { LandingPage, Workspace } from "@prisma/client";
import { recordServerHit } from "@/lib/analytics/track";
import { Beacon } from "@/components/analytics/Beacon";
import { createConfig } from "@/components/blocks/config";
import { buildPageMeta } from "@/lib/p-meta";
import { jsonLd, publishedPages } from "@/lib/p-public";
import { str, walkBlocks, type PageData } from "@/lib/p-tree";

// Gemeinsame Darstellung einer veröffentlichten Landingpage – für /p/<ws>/… und für eigene Kundendomains.
// Unterschied ist nur die URL-Bildung (canonical, hreflang, JSON-LD).

export type SiteUrls = {
  /** absolute URL einer Seite */
  page: (lang: string, slug: string) => string;
  /** Basis für Organisations-ID (z. B. https://kunde.de/ oder <APP_URL>/p/<ws>) */
  orgBase: string;
  /** Pfad für die Analytics-Erfassung */
  analyticsPath: (lang: string, slug: string) => string;
};

export async function landingMetadata(ws: Workspace, page: LandingPage, urls: SiteUrls): Promise<Metadata> {
  const siblings = (await publishedPages(ws.id)).filter((s) => s.groupId === page.groupId);
  const title = page.seoTitle || `${page.title} | ${ws.name}`;
  const description = page.seoDescription ?? undefined;
  return {
    title,
    description,
    alternates: {
      canonical: urls.page(page.lang, page.slug),
      languages: Object.fromEntries(siblings.map((s) => [s.lang, urls.page(s.lang, s.slug)])),
    },
    openGraph: { title, description, url: urls.page(page.lang, page.slug), siteName: ws.name, locale: page.lang, type: "website" },
    robots: { index: true, follow: true },
  };
}

export async function LandingDocument({ ws, page, urls }: { ws: Workspace; page: LandingPage; urls: SiteUrls }) {
  const source = page.publishedData as PageData;
  // Bots serverseitig erfassen (sie führen kein JavaScript aus); blockiert die Antwort nicht.
  const h = await headers();
  after(() => recordServerHit({ workspaceId: ws.id, path: urls.analyticsPath(page.lang, page.slug), pageId: page.id, headers: h }));

  const meta = await buildPageMeta(ws, page);
  const blocks = walkBlocks(source);
  // Impressum ist Pflicht: Fuß automatisch ergänzen, wenn die Seite keinen hat
  const data: PageData = blocks.some((b) => b.type === "Footer")
    ? source
    : { ...source, content: [...(source.content ?? []), { type: "Footer", props: { id: "auto-footer", note: "" } }] };

  const url = urls.page(page.lang, page.slug);
  const org = {
    "@type": "Organization",
    "@id": `${urls.orgBase}#org`,
    name: ws.legalName || ws.name,
    ...(ws.domain ? { url: `https://${ws.domain}` } : {}),
    ...(ws.legalAddress ? { address: ws.legalAddress } : {}),
    ...(ws.vatId ? { vatID: ws.vatId } : {}),
  };
  const faqs = blocks
    .filter((b) => b.type === "FAQ" && Array.isArray(b.props.items))
    .flatMap((b) => b.props.items as Record<string, unknown>[])
    .filter((i) => str(i.question).trim() && str(i.answer).trim());
  const graph: object[] = [
    org,
    {
      "@type": "WebPage",
      "@id": url,
      url,
      name: page.seoTitle || page.title,
      ...(page.seoDescription ? { description: page.seoDescription } : {}),
      inLanguage: page.lang,
      isPartOf: { "@id": `${urls.orgBase}#org` },
      ...(page.publishedAt ? { datePublished: page.publishedAt.toISOString() } : {}),
      dateModified: page.updatedAt.toISOString(),
    },
  ];
  if (faqs.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: str(f.question), acceptedAnswer: { "@type": "Answer", text: str(f.answer) } })),
    });
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ "@context": "https://schema.org", "@graph": graph }) }} />
      <main lang={page.lang}>
        <Render config={createConfig()} data={data} metadata={meta} />
      </main>
      <Beacon workspaceSlug={ws.slug} pageId={page.id} />
    </>
  );
}
