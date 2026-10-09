import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { domainForRequest, domainUrls, resolveDomainPage } from "@/lib/domains/site";
import { LandingDocument, landingMetadata } from "@/lib/domains/view";

export const dynamic = "force-dynamic";

type Params = { host: string; path?: string[] };

const load = cache(async ({ host, path }: Params) => {
  const domain = await domainForRequest(host);
  if (!domain) return null;
  const r = await resolveDomainPage(domain.workspace, path ?? []);
  if (!r) return null;
  return { ws: domain.workspace, page: r.page, urls: domainUrls(domain.hostname, domain.workspace, r.start) };
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const r = await load(await params);
  return r ? landingMetadata(r.ws, r.page, r.urls) : {};
}

export default async function DomainLanding({ params }: { params: Promise<Params> }) {
  const r = await load(await params);
  if (!r) notFound();
  return <LandingDocument ws={r.ws} page={r.page} urls={r.urls} />;
}
