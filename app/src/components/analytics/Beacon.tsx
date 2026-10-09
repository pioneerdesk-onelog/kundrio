"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Sendet beim Laden (und bei Navigation innerhalb der App) einen cookiefreien Seitenaufruf an /api/a/collect.
// (useSearchParams bewusst nicht genutzt: erzwänge eine Suspense-Grenze.) Kein Cookie, kein localStorage. Eigene Besuche angemeldeter Benutzer erkennt der Server.
export function Beacon(props: { workspaceSlug: string; pageId?: string }) {
  const { workspaceSlug, pageId } = props;
  const pathname = usePathname();
  const first = useRef(true);
  const last = useRef<string | null>(null);

  useEffect(() => {
    const href = window.location.href;
    if (last.current === href) return;
    last.current = href;
    try {
      const body = JSON.stringify({
        ws: workspaceSlug,
        k: "pageview",
        u: href,
        r: first.current ? document.referrer || undefined : undefined,
        p: pageId,
      });
      first.current = false;
      const blob = new Blob([body], { type: "text/plain" });
      if (!navigator.sendBeacon?.("/api/a/collect", blob)) {
        fetch("/api/a/collect", { method: "POST", body, headers: { "content-type": "text/plain" }, keepalive: true }).catch(() => {});
      }
    } catch {
      // Analytics darf die Seite nie stören
    }
  }, [workspaceSlug, pageId, pathname]);

  return null;
}
