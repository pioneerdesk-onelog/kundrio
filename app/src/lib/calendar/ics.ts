// iCalendar-Einladungen (RFC 5545 / iTIP RFC 5546) für den Fallback ohne Google/Microsoft-Verbindung.
// Zeiten mit TZID=Europe/Berlin und mitgelieferter VTIMEZONE; Zeilen auf 75 Oktette gefaltet.

import { TIME_ZONE } from "./config";
import { utcToZonedLocal } from "./time";

export type IcsAttendee = { email: string; name?: string | null; role?: "REQ-PARTICIPANT" | "OPT-PARTICIPANT" };

export type IcsInput = {
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  organizer: { email: string; name?: string | null };
  attendees: IcsAttendee[];
  /** Zeitstempel der Erzeugung (Tests) */
  now?: Date;
  /** Erinnerungen in Minuten vor Beginn */
  reminders?: number[];
};

/** Text-Escaping nach RFC 5545 3.3.11 */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Parameterwerte (CN=…) in Anführungszeichen, ohne Steuerzeichen und Anführungszeichen. */
function paramValue(s: string): string {
  return `"${s.replace(/["\r\n\t]/g, "").slice(0, 100)}"`;
}

/** Faltet eine Zeile auf max. 75 Oktette (UTF-8-sicher, Fortsetzung mit Leerzeichen). */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    const limit = out.length === 0 ? 75 : 74; // Folgezeilen beginnen mit einem Leerzeichen
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const localStamp = (d: Date) => utcToZonedLocal(d, TIME_ZONE).replace(/[-:]/g, "");

const VTIMEZONE_BERLIN = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export function buildIcs(i: IcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Pioneerdesk//CRM//DE",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${i.method}`,
    ...VTIMEZONE_BERLIN,
    "BEGIN:VEVENT",
    `UID:${i.uid.replace(/[\r\n]/g, "")}`,
    `SEQUENCE:${Math.max(0, Math.floor(i.sequence))}`,
    `DTSTAMP:${utcStamp(i.now ?? new Date())}`,
    `DTSTART;TZID=${TIME_ZONE}:${localStamp(i.start)}`,
    `DTEND;TZID=${TIME_ZONE}:${localStamp(i.end)}`,
    `SUMMARY:${escapeText(i.summary)}`,
    ...(i.description ? [`DESCRIPTION:${escapeText(i.description)}`] : []),
    ...(i.location ? [`LOCATION:${escapeText(i.location)}`] : []),
    ...(i.url ? [`URL:${i.url.replace(/[\r\n]/g, "")}`] : []),
    `ORGANIZER;CN=${paramValue(i.organizer.name || i.organizer.email)}:mailto:${i.organizer.email}`,
    ...i.attendees.map(
      (a) =>
        `ATTENDEE;CN=${paramValue(a.name || a.email)};ROLE=${a.role ?? "REQ-PARTICIPANT"};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    ),
    `STATUS:${i.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    ...(i.method === "REQUEST"
      ? (i.reminders ?? []).flatMap((min) => [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeText(i.summary)}`,
          `TRIGGER:-PT${Math.max(0, Math.floor(min))}M`,
          "END:VALARM",
        ])
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
