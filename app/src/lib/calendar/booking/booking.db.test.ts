// DB-Integrationstest Doppelbuchungsschutz. Läuft nur mit Datenbank:
//   node --env-file=.env node_modules/vitest/vitest.mjs run src/lib/calendar/booking/booking.db.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MeetingType, Workspace } from "@prisma/client";

vi.mock("server-only", () => ({}));

const enabled = !!process.env.DATABASE_URL && process.env.MAIL_MODE !== "smtp";

describe.skipIf(!enabled)("Doppelbuchungsschutz (DB)", () => {
  let ws: Workspace;
  let mt: MeetingType;
  let userId: string;
  const tag = `bk-test-${Date.now().toString(36)}`;

  beforeAll(async () => {
    const { db } = await import("../../db");
    const agency = await db.agency.findFirstOrThrow();
    const u = await db.user.create({ data: { email: `${tag}@example.invalid`, name: "Test Gastgeber", passwordHash: "x", active: true } });
    userId = u.id;
    ws = await db.workspace.create({ data: { agencyId: agency.id, slug: tag, name: "Buchungstest", mailFromEmail: "termine@example.invalid", mailFromName: "Buchungstest" } });
    await db.membership.create({ data: { userId, workspaceId: ws.id } });
    const all: Record<string, [string, string][]> = Object.fromEntries(["mo", "di", "mi", "do", "fr", "sa", "so"].map((d) => [d, [["00:00", "23:59"]]]));
    mt = await db.meetingType.create({
      data: {
        workspaceId: ws.id,
        name: "Erstgespräch",
        titleTemplate: "Erstgespräch",
        durationMin: 30,
        videoProvider: "none",
        bookingEnabled: true,
        bookingSlug: "erstgespraech",
        availability: { ...all, zeitzone: "Europe/Berlin", feiertage: false },
        minNoticeHours: 1,
        maxDaysAhead: 7,
        slotIntervalMin: 30,
        hostUserIds: [userId],
      },
    });
  });

  afterAll(async () => {
    const { db } = await import("../../db");
    if (ws) await db.workspace.delete({ where: { id: ws.id } }).catch(() => {});
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => {});
    await db.$disconnect();
  });

  it("parallele Buchungen desselben Slots: genau eine gelingt", async () => {
    const { availableSlots, bookSlot, BookingError, eventByToken } = await import("./service");
    const slots = await availableSlots(ws, mt);
    expect(slots.length).toBeGreaterThan(0);
    const start = slots[3].start;
    const tries = Array.from({ length: 5 }, (_, k) =>
      bookSlot({ ws, mt, start, guest: { firstName: "Gast", lastName: String(k), email: `${tag}-${k}@example.invalid` }, answers: {}, newsletterConsent: false }),
    );
    const res = await Promise.allSettled(tries);
    const ok = res.filter((r) => r.status === "fulfilled");
    const failed = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed.every((f) => f.reason instanceof BookingError)).toBe(true);

    const { db } = await import("../../db");
    const events = await db.event.findMany({ where: { workspaceId: ws.id, startsAt: start } });
    expect(events.filter((e) => e.status === "scheduled")).toHaveLength(1);
    expect(events.filter((e) => e.status === "held")).toHaveLength(0);

    // Slot ist danach nicht mehr frei; Token führt zum Termin, DB enthält nur den Hash
    const after = await availableSlots(ws, mt);
    expect(after.some((s) => s.start.getTime() === start.getTime())).toBe(false);
    const token = (ok[0] as PromiseFulfilledResult<{ token: string }>).value.token;
    const ev = await eventByToken(token);
    expect(ev?.status).toBe("scheduled");
    expect(ev?.bookingTokenHash).not.toContain(token);
    expect(await db.crmEvent.count({ where: { workspaceId: ws.id, type: "meeting.booked" } })).toBe(1);
  }, 60_000);

  it("Absage per Token gibt den Slot wieder frei", async () => {
    const { availableSlots, bookSlot, cancelByToken } = await import("./service");
    const slots = await availableSlots(ws, mt);
    const start = slots[6].start;
    const r = await bookSlot({ ws, mt, start, guest: { firstName: "Gast", lastName: "Absage", email: `${tag}-c@example.invalid` }, answers: {}, newsletterConsent: false });
    expect((await availableSlots(ws, mt)).some((s) => s.start.getTime() === start.getTime())).toBe(false);
    await cancelByToken(r.token, "passt doch nicht");
    expect((await availableSlots(ws, mt)).some((s) => s.start.getTime() === start.getTime())).toBe(true);
  }, 60_000);
});
