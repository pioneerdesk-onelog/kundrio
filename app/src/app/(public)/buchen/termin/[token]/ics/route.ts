import { icsForToken } from "@/lib/calendar/booking/service";

export const dynamic = "force-dynamic";

// Kalendereintrag (.ics) zur Buchung – nur mit gültigem Verwaltungslink.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ics = await icsForToken(token);
  if (!ics) return new Response("Nicht gefunden", { status: 404 });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="termin.ics"',
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
