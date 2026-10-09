import { NextResponse, type NextRequest } from "next/server";
import { appHostsFrom, domainRewritePath, hostOf } from "@/lib/domains/routing";

// Eigene Kundendomains (Landingpages): Anfragen an fremde Hosts intern auf /d/<host>/… umschreiben.
// Die Zielroute prüft per DB, ob der Host eingetragen und aktiv ist. Plattform-Hosts bleiben unverändert.
// Node-Runtime, damit APP_URL/APP_HOSTS zur Laufzeit gelesen werden (nicht beim Build eingefroren).

const APP_HOSTS = appHostsFrom({ APP_URL: process.env.APP_URL, APP_HOSTS: process.env.APP_HOSTS });

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  // Kennzeichnung darf nur von hier kommen, nie vom Client
  headers.delete("x-pd-domain");
  const host = hostOf(req.headers.get("host"));
  const target = domainRewritePath(host, req.nextUrl.pathname, APP_HOSTS);
  if (!target) return NextResponse.next({ request: { headers } });
  headers.set("x-pd-domain", host);
  const url = req.nextUrl.clone();
  url.pathname = target;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
