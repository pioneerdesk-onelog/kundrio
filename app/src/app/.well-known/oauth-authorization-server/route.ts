import { authorizationServerMetadata } from "@/lib/oauth/metadata";
import { oauthJson, preflight } from "@/lib/oauth/http";

// RFC 8414
export const dynamic = "force-dynamic";
export const GET = () => oauthJson(authorizationServerMetadata(), 200, { "cache-control": "public, max-age=300" });
export const OPTIONS = preflight;
