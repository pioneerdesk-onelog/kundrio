import { verifyUnsubscribeToken } from "@/lib/mail";
import { unsubscribeContact } from "@/lib/b-consent";

// RFC 8058: One-Click-Abmeldung per POST aus dem Mailprogramm (List-Unsubscribe-Post).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  if (!verifyUnsubscribeToken(id, token)) return new Response("Ungültiger Link", { status: 400 });
  await unsubscribeContact(id, "One-Click");
  return new Response("Abgemeldet", { status: 200 });
}

// Ein GET (z. B. Link-Vorschau) meldet nicht ab, sondern leitet zur Bestätigungsseite.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  return Response.redirect(new URL(`/u/${id}/${token}`, req.url), 303);
}
