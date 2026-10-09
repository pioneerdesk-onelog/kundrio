import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { signFormTimestamp } from "@/lib/trust";
import { loadBookingPage } from "@/lib/calendar/booking/service";
import { parseQuestions } from "@/lib/calendar/booking/rules";
import { bookingFormKey } from "@/lib/calendar/booking/token";
import { VIDEO_LABEL, type VideoProvider } from "@/lib/calendar/config";
import { BookingWidget } from "../../BookingWidget";
import { BrandHeader, brandVars } from "../../brand";
import { bookAction, loadSlots } from "../../actions";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ ws: string; slug: string }>; searchParams: Promise<{ einbettung?: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { ws, slug } = await params;
  const page = await loadBookingPage(ws, slug);
  return { title: page ? `${page.mt.name} – Termin buchen` : "Termin buchen", robots: { index: false } };
}

// Öffentliche Buchungsseite eines Sub-Accounts. Gibt nur Vorlagenname, Dauer, Beschreibung und freie Zeiten preis
// (keine Gastgeber-Namen oder Kalenderdaten).
export default async function BookingPage({ params, searchParams }: P) {
  const { ws: wsSlug, slug } = await params;
  const { einbettung } = await searchParams;
  const page = await loadBookingPage(wsSlug, slug);
  if (!page) notFound();
  const { ws, mt } = page;
  const embed = einbettung === "1";
  const video = VIDEO_LABEL[mt.videoProvider as VideoProvider] ?? null;
  // Beschreibung ist für Einladungen gedacht – Platzhalter auf der öffentlichen Seite nicht zeigen
  const description = mt.description?.replace(/\{\{[^}]*\}\}/g, "").trim();

  return (
    <main style={brandVars(ws)} className={`mx-auto max-w-2xl rounded-xl bg-white text-[#1f2a37] ${embed ? "p-4" : "p-6 shadow-sm sm:p-8"}`}>
      {!embed && <BrandHeader ws={ws} />}
      <h1 className="text-2xl font-semibold">{mt.name}</h1>
      <p className="mt-1 text-[15px] opacity-80">
        {mt.durationMin} Minuten{video ? ` · ${video}` : ""}
      </p>
      {description && <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed">{description}</p>}
      <div className="mt-6">
        <BookingWidget
          mode="book"
          load={loadSlots.bind(null, wsSlug, slug)}
          action={bookAction.bind(null, wsSlug, slug)}
          questions={parseQuestions(mt.questions)}
          formTs={signFormTimestamp(env.appSecret(), bookingFormKey(mt.id))}
          durationMin={mt.durationMin}
          privacyHint={`Ich bin einverstanden, dass ${ws.legalName ?? ws.name} meine Angaben zur Vereinbarung und Durchführung dieses Termins verarbeitet.`}
          submitLabel="Verbindlich buchen"
        />
      </div>
    </main>
  );
}
