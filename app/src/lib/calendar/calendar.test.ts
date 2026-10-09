import { describe, expect, it, beforeAll } from "vitest";
import { buildIcs, escapeText, foldLine } from "./ics";
import { renderMeetingTemplate, unknownPlaceholders } from "./template";
import { zonedLocalToUtc, utcToZonedLocal, tzOffsetMinutes } from "./time";
import { suggestSlots } from "./availability";
import { toGoogleEvent, meetLinkOf } from "./google";
import { toGraphEvent, teamsLinkOf } from "./graph";

beforeAll(() => {
  process.env.APP_SECRET = process.env.APP_SECRET || "x".repeat(40);
});

describe("Zeitzone Europe/Berlin", () => {
  it("rechnet Sommer- und Winterzeit korrekt um", () => {
    expect(zonedLocalToUtc("2026-07-15T10:00")!.toISOString()).toBe("2026-07-15T08:00:00.000Z");
    expect(zonedLocalToUtc("2026-12-15T10:00")!.toISOString()).toBe("2026-12-15T09:00:00.000Z");
    expect(tzOffsetMinutes(new Date("2026-07-01T00:00:00Z"))).toBe(120);
    expect(utcToZonedLocal(new Date("2026-12-15T09:00:00Z"))).toBe("2026-12-15T10:00:00");
  });
  it("lehnt ungültige Eingaben ab", () => {
    expect(zonedLocalToUtc("morgen")).toBeNull();
  });
});

describe("ICS (RFC 5545)", () => {
  const base = {
    method: "REQUEST" as const,
    uid: "abc@kundrio",
    sequence: 0,
    start: new Date("2026-10-08T08:00:00Z"),
    end: new Date("2026-10-08T08:30:00Z"),
    summary: "Erstgespräch; Müller, GmbH",
    description: "Zeile 1\nZeile 2",
    location: "https://meet.jit.si/pd-x",
    url: "https://meet.jit.si/pd-x",
    organizer: { email: "orga@example.com", name: "Orga \"Test\"" },
    attendees: [{ email: "kunde@example.com", name: "Kunde" }],
    now: new Date("2026-10-07T10:00:00Z"),
    reminders: [15],
  };
  it("erzeugt gültige Struktur mit Zeitzone und CRLF", () => {
    const ics = buildIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin");
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20261008T100000");
    expect(ics).toContain("DTEND;TZID=Europe/Berlin:20261008T103000");
    expect(ics).toContain("DTSTAMP:20261007T100000Z");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics.match(/\r\n(?! )/g)!.length).toBeGreaterThan(10);
    // keine nackten LF
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });
  it("escaped Text und entfernt Anführungszeichen aus CN", () => {
    const ics = buildIcs(base).replace(/\r\n /g, "");
    expect(ics).toContain("SUMMARY:Erstgespräch\\; Müller\\, GmbH");
    expect(ics).toContain("DESCRIPTION:Zeile 1\\nZeile 2");
    expect(ics).toContain('ORGANIZER;CN="Orga Test":mailto:orga@example.com');
    expect(escapeText("a\\b")).toBe("a\\\\b");
  });
  it("Absage setzt CANCEL/CANCELLED ohne Erinnerung", () => {
    const ics = buildIcs({ ...base, method: "CANCEL", sequence: 2 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).not.toContain("VALARM");
  });
  it("faltet lange Zeilen auf ≤ 75 Oktette (UTF-8)", () => {
    const folded = foldLine("DESCRIPTION:" + "ä".repeat(100));
    for (const l of folded.split("\r\n")) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "ä".repeat(100));
  });
});

describe("Platzhalter in Terminvorlagen", () => {
  const ctx = { contact: { FIRSTNAME: "Anna" }, company: { name: "Berger GmbH" }, owner: { name: "Marcus" }, meeting: { joinUrl: "https://x" } };
  it("ersetzt bekannte Werte und Standardwerte", () => {
    expect(renderMeetingTemplate("Hallo {{ contact.FIRSTNAME }} von {{ company.name }}", ctx)).toBe("Hallo Anna von Berger GmbH");
    expect(renderMeetingTemplate('{{ deal.title | default: "Ihr Projekt" }}', ctx)).toBe("Ihr Projekt");
    expect(renderMeetingTemplate("{{ contact.LASTNAME }}", ctx)).toBe("");
  });
  it("kein Prototyp-Zugriff, keine Zeilenumbrüche aus Werten", () => {
    expect(renderMeetingTemplate("{{ contact.constructor }}", ctx)).toBe("");
    expect(renderMeetingTemplate("{{ contact.FIRSTNAME }}", { contact: { FIRSTNAME: "A\nB" } })).toBe("A B");
  });
  it("findet unbekannte Platzhalter", () => {
    expect(unknownPlaceholders("{{ contact.FIRSTNAME }} {{ params.x }} {{ foo }}")).toEqual(["{{ params.x }}", "{{ foo }}"]);
  });
});

describe("Terminvorschläge", () => {
  it("nur Mo–Fr in Arbeitszeit, belegte Zeiten (inkl. Puffer) ausgespart", () => {
    const from = new Date("2026-10-09T06:00:00Z"); // Fr 08:00 Berlin
    const busy = [{ start: new Date("2026-10-09T07:00:00Z"), end: new Date("2026-10-09T08:00:00Z") }]; // 09–10 Uhr
    const slots = suggestSlots(busy, { from, days: 4, durationMin: 30, bufferMin: 0, max: 30 });
    expect(slots[0].start.toISOString()).toBe("2026-10-09T08:00:00.000Z"); // 10:00
    expect(slots.some((s) => [0, 6].includes(new Date(s.start.getTime() + 2 * 3600e3).getUTCDay()))).toBe(false);
    const withBuffer = suggestSlots(busy, { from, days: 1, durationMin: 30, bufferMin: 15, max: 3 });
    expect(withBuffer[0].start.toISOString()).toBe("2026-10-09T08:30:00.000Z");
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prüfung beliebiger API-Payloads
type Rec = Record<string, any>;

describe("Payload-Mapping", () => {
  const i = {
    title: "Erstgespräch",
    description: "Text",
    start: new Date("2026-10-08T08:00:00Z"),
    end: new Date("2026-10-08T08:30:00Z"),
    attendees: [{ email: "kunde@example.com", name: "Kunde" }],
    reminders: [1440, 15],
  };
  it("Google: Meet über conferenceData.createRequest (hangoutsMeet), Ortszeit + timeZone", () => {
    const e = toGoogleEvent({ ...i, withMeet: true }) as unknown as Rec;
    expect(e.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(e.conferenceData.createRequest.requestId).toMatch(/^[0-9a-f]{18}$/);
    expect(e.start).toEqual({ dateTime: "2026-10-08T10:00:00", timeZone: "Europe/Berlin" });
    expect(e.attendees).toEqual([{ email: "kunde@example.com", displayName: "Kunde" }]);
    expect(e.reminders.overrides).toHaveLength(2);
    const j = toGoogleEvent({ ...i, withMeet: false, joinUrl: "https://meet.jit.si/pd-1" }) as unknown as Rec;
    expect(j.conferenceData).toBeUndefined();
    expect(j.location).toBe("https://meet.jit.si/pd-1");
    expect(meetLinkOf({ id: "1", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/a-b-c" }] } })).toBe("https://meet.google.com/a-b-c");
    expect(meetLinkOf({ id: "1", hangoutLink: "https://meet.google.com/x" })).toBe("https://meet.google.com/x");
  });
  it("Graph: Teams über isOnlineMeeting + teamsForBusiness, Link aus onlineMeeting.joinUrl", () => {
    const e = toGraphEvent({ ...i, withTeams: true }) as unknown as Rec;
    expect(e.isOnlineMeeting).toBe(true);
    expect(e.onlineMeetingProvider).toBe("teamsForBusiness");
    expect(e.attendees[0]).toEqual({ emailAddress: { address: "kunde@example.com", name: "Kunde" }, type: "required" });
    expect(e.start.timeZone).toBe("Europe/Berlin");
    expect(toGraphEvent({ ...i, withTeams: false }).isOnlineMeeting).toBeUndefined();
    expect(teamsLinkOf({ id: "1", onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" } })).toContain("teams.microsoft.com");
  });
});
