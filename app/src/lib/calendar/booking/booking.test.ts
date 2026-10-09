import { describe, expect, it } from "vitest";
import {
  computeSlots,
  DEFAULT_AVAILABILITY,
  germanHolidays,
  groupByDay,
  neutralizePlaceholders,
  parseAvailability,
  parseQuestions,
  parseRangesText,
  serializeAvailability,
  weekdayOf,
  type Availability,
  type SlotInput,
} from "./rules";
import { bookingDoiKey, hashManageToken, isWellFormedToken, newManageToken } from "./token";

const empty: Availability["hours"] = { mo: [], di: [], mi: [], do: [], fr: [], sa: [], so: [] };
const avail = (hours: Partial<Availability["hours"]>, extra: Partial<Availability> = {}): Availability => ({
  hours: { ...empty, ...hours },
  zeitzone: "Europe/Berlin",
  feiertage: false,
  ...extra,
});
const base = (o: Partial<SlotInput>): SlotInput => ({
  now: new Date("2026-10-05T06:00:00Z"), // Montag, 08:00 Berlin
  availability: avail({ di: [["09:00", "12:00"]] }),
  durationMin: 30,
  bufferMin: 0,
  slotIntervalMin: 30,
  minNoticeHours: 0,
  maxDaysAhead: 14,
  hostIds: ["h1"],
  busyByHost: {},
  ...o,
});
const iso = (s: { start: Date }[]) => s.map((x) => x.start.toISOString());

describe("Wochenzeiten", () => {
  it("erzeugt Slots im Raster innerhalb der Zeitfenster (Berlin, Sommerzeit)", () => {
    const s = computeSlots(base({ fromDay: "2026-10-06", toDay: "2026-10-06" }));
    expect(iso(s)).toEqual([
      "2026-10-06T07:00:00.000Z",
      "2026-10-06T07:30:00.000Z",
      "2026-10-06T08:00:00.000Z",
      "2026-10-06T08:30:00.000Z",
      "2026-10-06T09:00:00.000Z",
      "2026-10-06T09:30:00.000Z",
    ]);
    expect(s[0].end.toISOString()).toBe("2026-10-06T07:30:00.000Z");
  });

  it("mehrere Fenster pro Tag, Slot muss vollständig hineinpassen", () => {
    const s = computeSlots(base({ availability: avail({ di: [["09:00", "10:00"], ["14:00", "15:10"]] }), durationMin: 60, fromDay: "2026-10-06", toDay: "2026-10-06" }));
    expect(iso(s)).toEqual(["2026-10-06T07:00:00.000Z", "2026-10-06T12:00:00.000Z"]);
  });

  it("Tage ohne Zeiten sind nicht buchbar", () => {
    const s = computeSlots(base({ fromDay: "2026-10-07", toDay: "2026-10-09" }));
    expect(s).toEqual([]);
  });

  it("ohne Gastgeber keine Slots", () => {
    expect(computeSlots(base({ hostIds: [] }))).toEqual([]);
  });

  it("weekdayOf", () => {
    expect(weekdayOf("2026-10-05")).toBe("mo");
    expect(weekdayOf("2026-10-25")).toBe("so");
  });
});

describe("Vorlauf und Zeitraum", () => {
  it("Vorlauf blendet frühe Slots aus", () => {
    // jetzt Di 06.10. 07:10 UTC (09:10 Berlin), 1 h Vorlauf → frühestens 10:10 → erster Slot 10:30
    const s = computeSlots(base({ now: new Date("2026-10-06T07:10:00Z"), minNoticeHours: 1, fromDay: "2026-10-06", toDay: "2026-10-06" }));
    expect(iso(s)[0]).toBe("2026-10-06T08:30:00.000Z");
    expect(s).toHaveLength(3);
  });

  it("buchbar höchstens maxDaysAhead Tage im Voraus", () => {
    const s = computeSlots(base({ maxDaysAhead: 8 })); // bis Di 13.10.
    const days = Object.keys(groupByDay(s));
    expect(days).toEqual(["2026-10-06", "2026-10-13"]);
    const s2 = computeSlots(base({ maxDaysAhead: 7 })); // bis Mo 12.10.
    expect(Object.keys(groupByDay(s2))).toEqual(["2026-10-06"]);
  });
});

describe("Puffer und Belegt-Zeiten", () => {
  it("belegte Zeiten blockieren überlappende Slots", () => {
    const busy = { h1: [{ start: new Date("2026-10-06T08:00:00Z"), end: new Date("2026-10-06T08:30:00Z") }] };
    const s = computeSlots(base({ busyByHost: busy, fromDay: "2026-10-06", toDay: "2026-10-06" }));
    expect(iso(s)).not.toContain("2026-10-06T08:00:00.000Z");
    expect(iso(s)).toContain("2026-10-06T07:30:00.000Z");
    expect(iso(s)).toContain("2026-10-06T08:30:00.000Z");
  });

  it("Puffer hält Abstand vor und nach belegten Zeiten", () => {
    const busy = { h1: [{ start: new Date("2026-10-06T08:00:00Z"), end: new Date("2026-10-06T08:30:00Z") }] };
    const s = computeSlots(base({ busyByHost: busy, bufferMin: 15, fromDay: "2026-10-06", toDay: "2026-10-06" }));
    expect(iso(s)).toEqual(["2026-10-06T07:00:00.000Z", "2026-10-06T09:00:00.000Z", "2026-10-06T09:30:00.000Z"]);
  });

  it("Rundlauf: Slot bleibt frei, solange ein Gastgeber frei ist", () => {
    const busy = { h1: [{ start: new Date("2026-10-06T07:00:00Z"), end: new Date("2026-10-06T10:00:00Z") }] };
    const s = computeSlots(base({ hostIds: ["h1", "h2"], busyByHost: busy, fromDay: "2026-10-06", toDay: "2026-10-06" }));
    expect(s).toHaveLength(6);
    expect(s.every((x) => x.hostIds.join() === "h2")).toBe(true);
  });
});

describe("Sommerzeitwechsel und Zeitzonen", () => {
  it("09:00 Berlin bleibt 09:00 lokal über den Wechsel am 25.10.2026", () => {
    const a = avail({ fr: [["09:00", "09:30"]], mo: [["09:00", "09:30"]] });
    const s = computeSlots(base({ availability: a, now: new Date("2026-10-20T00:00:00Z"), fromDay: "2026-10-23", toDay: "2026-10-26" }));
    expect(iso(s)).toEqual(["2026-10-23T07:00:00.000Z", "2026-10-26T08:00:00.000Z"]);
  });

  it("Nacht des Wechsels: Fenster 01:00–04:00 lokal ist 4 Stunden lang", () => {
    const a = avail({ so: [["01:00", "04:00"]] });
    const s = computeSlots(base({ availability: a, durationMin: 60, slotIntervalMin: 60, now: new Date("2026-10-20T00:00:00Z"), fromDay: "2026-10-25", toDay: "2026-10-25" }));
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(iso(s)[0]).toBe("2026-10-24T23:00:00.000Z");
    expect(s.at(-1)!.end.toISOString()).toBe("2026-10-25T03:00:00.000Z");
    // keine Überlappungen
    for (let k = 1; k < s.length; k++) expect(s[k].start.getTime()).toBeGreaterThanOrEqual(s[k - 1].end.getTime());
  });

  it("Wochenzeiten in anderer Zeitzone (New York) werden korrekt umgerechnet", () => {
    const a = avail({ di: [["09:00", "10:00"]] }, { zeitzone: "America/New_York" });
    const s = computeSlots(base({ availability: a, durationMin: 60, fromDay: "2026-10-06", toDay: "2026-10-06" }));
    expect(iso(s)).toEqual(["2026-10-06T13:00:00.000Z"]); // EDT = UTC-4
  });

  it("Gruppierung nach Besucher-Zeitzone verschiebt den Tag", () => {
    const s = computeSlots(base({ availability: avail({ di: [["00:30", "01:00"]] }), fromDay: "2026-10-06", toDay: "2026-10-06" }));
    expect(Object.keys(groupByDay(s, "Europe/Berlin"))).toEqual(["2026-10-06"]);
    expect(Object.keys(groupByDay(s, "America/New_York"))).toEqual(["2026-10-05"]);
  });
});

describe("Feiertage", () => {
  it("bundesweite Feiertage 2026", () => {
    const h = germanHolidays(2026);
    for (const d of ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-10-03", "2026-12-25", "2026-12-26"]) expect(h.has(d)).toBe(true);
    expect(h.has("2026-11-01")).toBe(false); // Allerheiligen nur regional
  });

  it("optional nicht buchbar", () => {
    const a = (f: boolean) => avail({ sa: [["09:00", "10:00"]] }, { feiertage: f }); // 03.10.2026 ist Samstag
    const args = { fromDay: "2026-10-03", toDay: "2026-10-03", now: new Date("2026-10-01T00:00:00Z") };
    expect(computeSlots(base({ availability: a(false), ...args }))).toHaveLength(2);
    expect(computeSlots(base({ availability: a(true), ...args }))).toHaveLength(0);
  });
});

describe("Einstellungen parsen", () => {
  it("parseRangesText", () => {
    expect(parseRangesText("09:00-12:00, 13:00-17:00").ranges).toEqual([["09:00", "12:00"], ["13:00", "17:00"]]);
    expect(parseRangesText("").ranges).toEqual([]);
    expect(parseRangesText("12:00-09:00").error).toBeTruthy();
    expect(parseRangesText("9 bis 5").error).toBeTruthy();
  });

  it("parseAvailability / serializeAvailability (Rundweg, Standard bei Unsinn)", () => {
    const a = avail({ mo: [["08:00", "12:00"]] }, { zeitzone: "Europe/Vienna", feiertage: true });
    expect(parseAvailability(serializeAvailability(a))).toEqual(a);
    expect(parseAvailability({})).toEqual(DEFAULT_AVAILABILITY);
    expect(parseAvailability({ mo: [["08:00", "12:00"]], zeitzone: "Mars/Olymp" }).zeitzone).toBe("Europe/Berlin");
  });

  it("parseQuestions begrenzt und validiert", () => {
    const q = parseQuestions([{ key: "frage_1", label: "Worum geht es?", type: "textarea", required: true }, { key: "Böse Taste", label: "x", type: "text" }, "x"]);
    expect(q).toEqual([{ key: "frage_1", label: "Worum geht es?", type: "textarea", required: true }]);
  });

  it("Platzhalter in Gast-Eingaben werden entschärft", () => {
    expect(neutralizePlaceholders("Hallo {{ owner.email }}")).not.toContain("{{");
  });
});

describe("Verwaltungs-Token", () => {
  it("zufällig, wohlgeformt, nur HMAC gespeichert", () => {
    const a = newManageToken("geheim");
    const b = newManageToken("geheim");
    expect(a.token).not.toBe(b.token);
    expect(isWellFormedToken(a.token)).toBe(true);
    expect(a.hash).toBe(hashManageToken("geheim", a.token));
    expect(a.hash).not.toContain(a.token);
    expect(hashManageToken("anderes", a.token)).not.toBe(a.hash);
  });

  it("lehnt kaputte Token ab", () => {
    for (const t of ["", "kurz", "x".repeat(44), "a".repeat(42) + "/", "../" + "a".repeat(40)]) expect(isWellFormedToken(t)).toBe(false);
  });

  it("DOI-Kennung ohne Punkte", () => {
    expect(bookingDoiKey("cm123")).toBe("bk-cm123");
  });
});
