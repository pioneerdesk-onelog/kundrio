import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eventByToken } from "@/lib/calendar/booking/service";
import { formatRange } from "@/lib/calendar/time";
import { BookingWidget } from "../../BookingWidget";
import { BrandHeader, brandVars } from "../../brand";
import { cancelAction, loadRescheduleSlots, rescheduleAction } from "../../actions";
import { CancelForm } from "./CancelForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ihr Termin", robots: { index: false }, referrer: "no-referrer" };

// Bestätigungs- und Verwaltungsseite für Gäste (Link aus der Bestätigungsmail). Ohne Login – der Link ist das Geheimnis.
export default async function ManageBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ neu?: string; verschoben?: string; abgesagt?: string; aktion?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const ev = await eventByToken(token);
  if (!ev) notFound();
  const ws = ev.workspace;
  const active = ev.status === "scheduled";
  const past = ev.startsAt.getTime() < Date.now();
  const durationMin = Math.round((ev.endsAt.getTime() - ev.startsAt.getTime()) / 60_000);
  const confirmation = ev.meetingType?.confirmationText?.trim();

  return (
    <main style={brandVars(ws)} className="mx-auto max-w-2xl space-y-6 rounded-xl bg-white p-6 text-[#1f2a37] shadow-sm sm:p-8">
      <BrandHeader ws={ws} />
      {sp.neu && active && (
        <div role="status" className="rounded-lg bg-emerald-50 p-4 text-emerald-900">
          <p className="font-semibold">Vielen Dank – Ihr Termin ist gebucht.</p>
          <p className="text-[15px]">Eine Bestätigung mit allen Details ist per E-Mail unterwegs.</p>
          {confirmation && <p className="mt-2 whitespace-pre-line text-[15px]">{confirmation}</p>}
        </div>
      )}
      {sp.verschoben && active && (
        <p role="status" className="rounded-lg bg-emerald-50 p-4 font-semibold text-emerald-900">
          Ihr Termin wurde verschoben.
        </p>
      )}
      {(sp.abgesagt || ev.status === "cancelled") && (
        <p role="status" className="rounded-lg bg-amber-50 p-4 font-semibold text-amber-900">
          Dieser Termin ist abgesagt.
        </p>
      )}

      <section aria-labelledby="t-head">
        <h1 id="t-head" className="text-2xl font-semibold">
          {ev.meetingType?.name ?? ev.title}
        </h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[16px]">
          <dt className="opacity-70">Wann</dt>
          <dd className={active ? "" : "line-through"}>{formatRange(ev.startsAt, ev.endsAt)} (Zeitzone Europe/Berlin)</dd>
          {ev.owner?.name && (
            <>
              <dt className="opacity-70">Mit</dt>
              <dd>{ev.owner.name}</dd>
            </>
          )}
          {active && ev.joinUrl && (
            <>
              <dt className="opacity-70">Video-Call</dt>
              <dd>
                <a href={ev.joinUrl} className="break-all text-[color:var(--bk-primary)] underline" rel="noreferrer">
                  {ev.joinUrl}
                </a>
              </dd>
            </>
          )}
          {active && ev.location && (
            <>
              <dt className="opacity-70">Ort</dt>
              <dd>{ev.location}</dd>
            </>
          )}
        </dl>
        {active && (
          <p className="mt-3">
            <a href={`/buchen/termin/${token}/ics`} className="text-[15px] text-[color:var(--bk-primary)] underline">
              In den eigenen Kalender übernehmen (.ics)
            </a>
          </p>
        )}
      </section>

      {active && !past && (
        <>
          <section aria-labelledby="r-head" className="border-t border-black/10 pt-6">
            <h2 id="r-head" className="mb-3 text-lg font-semibold">
              Termin verschieben
            </h2>
            {sp.aktion === "verschieben" ? (
              <BookingWidget mode="reschedule" load={loadRescheduleSlots.bind(null, token)} action={rescheduleAction.bind(null, token)} durationMin={durationMin} submitLabel="Auf diese Zeit verschieben" />
            ) : (
              <a href="?aktion=verschieben" className="inline-block rounded-lg border border-[var(--bk-primary)] px-5 py-2.5 text-[15px] font-semibold text-[color:var(--bk-primary)]">
                Neue Zeit wählen
              </a>
            )}
          </section>
          <section aria-labelledby="c-head" className="border-t border-black/10 pt-6">
            <h2 id="c-head" className="mb-3 text-lg font-semibold">
              Termin absagen
            </h2>
            <CancelForm action={cancelAction.bind(null, token)} />
          </section>
        </>
      )}
    </main>
  );
}
