import { protectedResourceMetadata } from "@/lib/oauth/metadata";
import { oauthJson, preflight } from "@/lib/oauth/http";

// RFC 9728 (Wurzel-Variante)
export const dynamic = "force-dynamic";
export const GET = () => oauthJson(protectedResourceMetadata(), 200, { "cache-control": "public, max-age=300" });
export const OPTIONS = preflight;
