import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { publicPath } from "@/lib/p-meta";
import { absUrl, pageUrl, publicWorkspace } from "@/lib/p-public";
import { LandingDocument, landingMetadata, type SiteUrls } from "@/lib/domains/view";

export const dynamic = "force-dynamic";

type Params = { ws: string; lang: string; slug: string };

const load = cache(async ({ ws: wsSlug, lang, slug }: Params) => {
  const ws = await publicWorkspace(wsSlug);
  if (!ws) return null;
  const page = await db.landingPage.findFirst({ where: { workspaceId: ws.id, lang, slug, status: "PUBLISHED" } });
  if (!page || !page.publishedData) return null;
  return { ws, page };
});

// URL-Bildung für die Plattform-Adresse /p/<ws>/<lang>/<slug> (eigene Domains: src/app/(landing)/d/**)
const urlsFor = (wsSlug: string): SiteUrls => ({
  page: (lang, slug) => pageUrl(wsSlug, lang, slug),
  orgBase: absUrl(`/p/${wsSlug}`),
  analyticsPath: (lang, slug) => publicPath(wsSlug, lang, slug),
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const r = await load(await params);
  return r ? landingMetadata(r.ws, r.page, urlsFor(r.ws.slug)) : {};
}

export default async function LandingPublic({ params }: { params: Promise<Params> }) {
  const r = await load(await params);
  if (!r) notFound();
  return <LandingDocument ws={r.ws} page={r.page} urls={urlsFor(r.ws.slug)} />;
}
