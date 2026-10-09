import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { emitEvent } from "../events";
import { formatAddress, newMessageId, sendRawDetailed, statusForDelivery, suppressionFor } from "../mail";
import { isValidOwner } from "../objects/defaults";
import { calendarEnv, requiredConnection, VIDEO_LABEL, type Provider, type VideoProvider } from "./config";
import { accessTokenFor, activeConnection } from "./connections";
import { buildIcs } from "./ics";
import { renderMeetingTemplate, type MeetingTemplateContext } from "./template";
import { formatRange } from "./time";
import { googleDeleteEvent, googleInsertEvent, googlePatchEvent, meetLinkOf, toGoogleEvent } from "./google";
import { graphCancelEvent, graphCreateEvent, graphDeleteEvent, graphUpdateEvent, teamsLinkOf, toGraphEvent } from "./graph";

// Termine mit Video-Call: Organisator-Kalender (Google/Microsoft) mit Einladung an alle Teilnehmenden,
// Kopie im Teamkalender (ohne erneute Einladung), CRM-Termin, Aktivität, Outbox-Ereignis.
// Fallback ohne Kalender-Verbindung: .ics-Einladung (RFC 5545) per CRM-Mail.

export type Attendee = { email: string; name?: string | null; contactId?: string; userId?: string; response?: string };
export type ExternalRef = { provider: Provider; calendarId: string; eventId: string; connectionId: string };
export type ExternalRefs = { organizer?: ExternalRef; team?: ExternalRef; ics?: boolean };

export type ScheduleInput = {
  workspaceId: string;
  organizerId: string;
  meetingTypeId?: string | null;
  title?: string | null;
  description?: string | null;
  start: Date;
  durationMin?: number | null;
  videoProvider?: VideoProvider | null;
  location?: string | null;
  contactIds: string[];
  internalUserIds?: string[];
  dealId?: string | null;
  companyId?: string | null;
  addToTeamCalendar?: boolean | null;
};

export class MeetingError extends Error {}

const icsUid = () => `${randomBytes(12).toString("hex")}@kundrio`;

function jitsiUrl() {
  return `${calendarEnv.jitsiBase()}/pd-${randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "")}`;
}

async function loadContext(i: ScheduleInput) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: i.workspaceId } });
  const mt = i.meetingTypeId ? await db.meetingType.findFirst({ where: { id: i.meetingTypeId, workspaceId: ws.id } }) : null;
  if (i.meetingTypeId && !mt) throw new MeetingError("Terminvorlage nicht gefunden.");
  if (!(await isValidOwner(ws.id, i.organizerId))) throw new MeetingError("Organisator hat keinen Zugriff auf diesen Sub-Account.");
  const organizer = await db.user.findUniqueOrThrow({ where: { id: i.organizerId }, select: { id: true, name: true, email: true } });
  const contacts = i.contactIds.length
    ? await db.contact.findMany({
        where: { id: { in: [...new Set(i.contactIds)] }, workspaceId: ws.id },
        include: { companyRecord: { select: { id: true, name: true } } },
      })
    : [];
  if (contacts.length !== new Set(i.contactIds).size) throw new MeetingError("Mindestens ein Kontakt wurde nicht gefunden.");
  const internalIds = [...new Set((i.internalUserIds ?? []).filter((u) => u !== organizer.id))];
  for (const u of internalIds) if (!(await isValidOwner(ws.id, u))) throw new MeetingError("Eine interne Person hat keinen Zugriff auf diesen Sub-Account.");
  const internal = internalIds.length ? await db.user.findMany({ where: { id: { in: internalIds } }, select: { id: true, name: true, email: true } }) : [];
  const deal = i.dealId ? await db.deal.findFirst({ where: { id: i.dealId, workspaceId: ws.id }, select: { id: true, title: true, companyId: true } }) : null;
  if (i.dealId && !deal) throw new MeetingError("Deal nicht gefunden.");
  const companyId = i.companyId ?? deal?.companyId ?? contacts[0]?.companyRecord?.id ?? null;
  const company = companyId ? await db.company.findFirst({ where: { id: companyId, workspaceId: ws.id }, select: { id: true, name: true } }) : null;
  return { ws, mt, organizer, contacts, internal, deal, company };
}

function templateCtx(c: Awaited<ReturnType<typeof loadContext>>, start: Date, end: Date, durationMin: number, joinUrl: string | null): MeetingTemplateContext {
  const first = c.contacts[0];
  return {
    contact: first
      ? {
          FIRSTNAME: first.firstName ?? "",
          LASTNAME: first.lastName ?? "",
          NAME: [first.firstName, first.lastName].filter(Boolean).join(" "),
          EMAIL: first.email ?? "",
          COMPANY: first.companyRecord?.name ?? first.company ?? "",
        }
      : {},
    company: c.company ? { name: c.company.name } : {},
    deal: c.deal ? { title: c.deal.title } : {},
    owner: { name: c.organizer.name, email: c.organizer.email },
    meeting: { date: formatRange(start, end), duration: String(durationMin), joinUrl: joinUrl ?? "", workspace: c.ws.name },
  };
}

/** Alle Kalender-Kopien anlegen und den CRM-Termin speichern. */
export async function scheduleMeeting(i: ScheduleInput, actor: string) {
  const c = await loadContext(i);
  const durationMin = Math.min(Math.max(i.durationMin ?? c.mt?.durationMin ?? 30, 5), 600);
  const start = i.start;
  const end = new Date(start.getTime() + durationMin * 60000);
  if (Number.isNaN(start.getTime())) throw new MeetingError("Ungültige Startzeit.");
  const video = (i.videoProvider ?? (c.mt?.videoProvider as VideoProvider) ?? "none") as VideoProvider;
  const warnings: string[] = [];

  // Organisator-Verbindung: Meet braucht Google, Teams braucht Microsoft; sonst bevorzugt Google, dann Microsoft
  const needed = requiredConnection(video);
  const orgConn = needed
    ? await activeConnection(c.organizer.id, needed)
    : ((await activeConnection(c.organizer.id, "google")) ?? (await activeConnection(c.organizer.id, "microsoft")));
  if (needed && !orgConn) {
    throw new MeetingError(`${VIDEO_LABEL[video]} braucht eine verbundene ${needed === "google" ? "Google" : "Microsoft"}-Kalenderverbindung des Organisators (Konto → Kalender).`);
  }

  // Video-Link ohne Kalender-Anbieter
  let joinUrl: string | null = null;
  if (video === "jitsi") joinUrl = jitsiUrl();
  if (video === "opentalk") {
    const loc = i.location?.trim() ?? "";
    if (!/^https:\/\//.test(loc)) throw new MeetingError("Für OpenTalk bitte den Raum-Link (https://…) als Ort angeben.");
    joinUrl = loc;
  }

  // Teilnehmende: Kontakte mit E-Mail (gesperrte Adressen auslassen) + interne Personen
  const attendees: Attendee[] = [];
  for (const ct of c.contacts) {
    if (!ct.email) {
      warnings.push(`${[ct.firstName, ct.lastName].filter(Boolean).join(" ") || "Kontakt"} hat keine E-Mail-Adresse – nicht eingeladen.`);
      continue;
    }
    const blocked = await suppressionFor(c.ws.id, ct.email);
    if (blocked && blocked.reason !== "unsubscribed") {
      warnings.push(`${ct.email} ist gesperrt (${blocked.reason}) – nicht eingeladen.`);
      continue;
    }
    attendees.push({ email: ct.email.toLowerCase(), name: [ct.firstName, ct.lastName].filter(Boolean).join(" ") || null, contactId: ct.id, response: "offen" });
  }
  for (const u of c.internal) attendees.push({ email: u.email.toLowerCase(), name: u.name, userId: u.id, response: "offen" });

  const ctxBefore = templateCtx(c, start, end, durationMin, joinUrl);
  const title = (i.title?.trim() || renderMeetingTemplate(c.mt?.titleTemplate ?? "Termin", ctxBefore)).replace(/\s+–\s*$/, "").slice(0, 200) || "Termin";
  const descTemplate = i.description ?? c.mt?.description ?? "";
  const reminders = c.mt?.reminders ?? [15];
  const location = video === "onsite" || video === "phone" ? (i.location ?? c.mt?.location ?? null) : (i.location ?? null);

  const refs: ExternalRefs = {};
  const uid = icsUid();
  const created: (() => Promise<void>)[] = []; // Aufräumen bei Fehlern

  try {
    // 1) Organisator-Kalender (Einladungen verschickt Google/Microsoft)
    if (orgConn) {
      const token = await accessTokenFor(orgConn);
      if (orgConn.provider === "google") {
        const description = renderMeetingTemplate(descTemplate, ctxBefore);
        const ev = await googleInsertEvent(
          token,
          orgConn.calendarId,
          toGoogleEvent({ title, description, location, start, end, attendees, withMeet: video === "google_meet", reminders, joinUrl }),
          true,
        );
        if (video === "google_meet") joinUrl = meetLinkOf(ev);
        refs.organizer = { provider: "google", calendarId: orgConn.calendarId, eventId: ev.id, connectionId: orgConn.id };
        created.push(() => googleDeleteEvent(token, orgConn.calendarId, ev.id, false));
        if (video === "google_meet" && !joinUrl) warnings.push("Google hat den Meet-Link noch nicht geliefert – er erscheint nach der nächsten Synchronisation.");
      } else {
        const description = renderMeetingTemplate(descTemplate, ctxBefore);
        const ev = await graphCreateEvent(
          token,
          orgConn.calendarId,
          toGraphEvent({ title, description, location, start, end, attendees, withTeams: video === "ms_teams", reminders, joinUrl }),
        );
        if (video === "ms_teams") joinUrl = teamsLinkOf(ev);
        refs.organizer = { provider: "microsoft", calendarId: orgConn.calendarId, eventId: ev.id, connectionId: orgConn.id };
        created.push(() => graphDeleteEvent(token, ev.id));
      }
    }

    const ctx = templateCtx(c, start, end, durationMin, joinUrl);
    const description = renderMeetingTemplate(descTemplate, ctx);

    // 2) Teamkalender (Kopie ohne Teilnehmende → keine zweite Einladung an Kunden)
    const team = c.ws.teamCalendar as { provider?: Provider; calendarId?: string; connectionId?: string } | null;
    const wantTeam = i.addToTeamCalendar ?? c.mt?.addToTeamCalendar ?? true;
    if (wantTeam && team?.connectionId && team.calendarId && !(refs.organizer && refs.organizer.calendarId === team.calendarId && refs.organizer.connectionId === team.connectionId)) {
      const tconn = await db.calendarConnection.findFirst({ where: { id: team.connectionId, status: "active" } });
      if (!tconn) {
        warnings.push("Teamkalender-Verbindung ist nicht aktiv – Termin nicht im Teamkalender.");
      } else {
        try {
          const ttoken = await accessTokenFor(tconn);
          const teamDesc = [description, `Teilnehmende: ${attendees.map((a) => a.name || a.email).join(", ")}`, `Organisator: ${c.organizer.name}`].filter(Boolean).join("\n\n");
          if (tconn.provider === "google") {
            const ev = await googleInsertEvent(ttoken, team.calendarId, toGoogleEvent({ title, description: teamDesc, location, start, end, attendees: [], withMeet: false, reminders: [], joinUrl }), false);
            refs.team = { provider: "google", calendarId: team.calendarId, eventId: ev.id, connectionId: tconn.id };
          } else {
            const ev = await graphCreateEvent(ttoken, team.calendarId, toGraphEvent({ title, description: teamDesc, location, start, end, attendees: [], withTeams: false, reminders: [], joinUrl }));
            refs.team = { provider: "microsoft", calendarId: team.calendarId, eventId: ev.id, connectionId: tconn.id };
          }
        } catch (e) {
          warnings.push(`Teamkalender: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
        }
      }
    }

    // 3) Fallback ohne Organisator-Kalender: .ics-Einladung per CRM-Mail
    if (!orgConn) {
      refs.ics = true;
      const recipients = [...attendees, { email: c.organizer.email.toLowerCase(), name: c.organizer.name, userId: c.organizer.id }];
      for (const a of recipients) {
        await sendInvite(c.ws.id, a, {
          method: "REQUEST",
          uid,
          sequence: 0,
          start,
          end,
          title,
          description,
          location: location ?? joinUrl,
          url: joinUrl,
          organizer: c.organizer,
          attendees,
          reminders,
          video,
        });
      }
    }

    // 4) CRM-Termin, Aktivitäten, Ereignis
    const ev = await db.$transaction(async (tx) => {
      const ev = await tx.event.create({
        data: {
          workspaceId: c.ws.id,
          title,
          description: description || null,
          startsAt: start,
          endsAt: end,
          location,
          contactId: c.contacts[0]?.id ?? null,
          ownerId: c.organizer.id,
          videoProvider: video,
          joinUrl,
          attendees: attendees as unknown as Prisma.InputJsonValue,
          meetingTypeId: c.mt?.id ?? null,
          externalRefs: refs as unknown as Prisma.InputJsonValue,
          status: "scheduled",
          icsUid: uid,
          icsSequence: 0,
        },
      });
      for (const ct of c.contacts) {
        await tx.activity.create({
          data: {
            workspaceId: c.ws.id,
            contactId: ct.id,
            type: "SYSTEM",
            body: `Termin geplant: ${title} (${formatRange(start, end)})${joinUrl ? ` · ${VIDEO_LABEL[video]}` : ""}`,
            meta: { eventId: ev.id, videoProvider: video },
          },
        });
      }
      if (c.contacts[0]) {
        await emitEvent(
          {
            workspaceId: c.ws.id,
            type: "meeting.scheduled",
            objectType: "contact",
            objectId: c.contacts[0].id,
            data: { eventId: ev.id, meetingTypeId: c.mt?.id ?? null, videoProvider: video, startsAt: start.toISOString(), dealId: c.deal?.id ?? null },
          },
          tx,
        );
      }
      return ev;
    });
    await audit({ workspaceId: c.ws.id, actor, action: "meeting.scheduled", target: ev.id, detail: { videoProvider: video, attendees: attendees.length, ics: Boolean(refs.ics) } });
    return { eventId: ev.id, joinUrl, warnings };
  } catch (e) {
    for (const undo of created.reverse()) await undo().catch(() => {});
    throw e;
  }
}

type InviteArgs = {
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  title: string;
  description: string;
  location: string | null;
  url: string | null;
  organizer: { email: string; name: string };
  attendees: Attendee[];
  reminders: number[];
  video: VideoProvider;
};

/** Einladung/Absage als Mail mit .ics-Anhang (über die normale Versand-Schicht inkl. Freigabeliste). */
async function sendInvite(workspaceId: string, to: Attendee, a: InviteArgs) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (!ws.mailFromEmail) throw new MeetingError(`Für ${ws.name} ist keine Absenderadresse hinterlegt.`);
  const blocked = await suppressionFor(workspaceId, to.email);
  if (blocked && blocked.reason !== "unsubscribed") return;
  const ics = buildIcs({
    method: a.method,
    uid: a.uid,
    sequence: a.sequence,
    start: a.start,
    end: a.end,
    summary: a.title,
    description: a.description,
    location: a.location,
    url: a.url,
    organizer: a.organizer,
    attendees: a.attendees,
    reminders: a.reminders,
  });
  const when = formatRange(a.start, a.end);
  const subject = a.method === "CANCEL" ? `Abgesagt: ${a.title}` : a.sequence > 0 ? `Aktualisiert: ${a.title}` : `Einladung: ${a.title}`;
  const text = [
    a.method === "CANCEL" ? `Der folgende Termin wurde abgesagt:` : `Sie sind zu folgendem Termin eingeladen:`,
    ``,
    a.title,
    when,
    a.url ? `${VIDEO_LABEL[a.video]}: ${a.url}` : a.location ? `Ort: ${a.location}` : "",
    ``,
    a.method === "CANCEL" ? "" : a.description,
    ``,
    `Organisator: ${a.organizer.name} <${a.organizer.email}>`,
    a.method === "CANCEL" ? "" : `Den Termin können Sie über den Anhang (einladung.ics) in Ihren Kalender übernehmen.`,
  ]
    .filter((l, idx, arr) => !(l === "" && arr[idx - 1] === ""))
    .join("\n");
  const msg = await db.emailMessage.create({
    data: {
      workspaceId,
      contactId: to.contactId,
      direction: "OUT",
      fromAddr: ws.mailFromEmail,
      toAddr: to.email,
      subject,
      bodyText: text,
      messageId: newMessageId(ws.mailFromEmail),
      status: "queued",
      kind: "transactional",
      tags: ["termin"],
    },
  });
  try {
    const { messageId, delivery } = await sendRawDetailed({
      from: formatAddress(ws.mailFromEmail, ws.mailFromName),
      to: [to.email],
      replyTo: a.organizer.email,
      subject,
      text,
      headers: { "X-PD-Message-Id": msg.id },
      attachments: [{ filename: a.method === "CANCEL" ? "absage.ics" : "einladung.ics", content: Buffer.from(ics, "utf8").toString("base64"), encoding: "base64" }],
      messageId: msg.messageId!,
    });
    await db.emailMessage.update({ where: { id: msg.id }, data: { messageId, status: statusForDelivery(delivery), sentAt: new Date() } });
    await db.emailEvent.create({ data: { workspaceId, messageId: msg.id, event: "request", reason: delivery } });
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e).slice(0, 500);
    await db.emailMessage.update({ where: { id: msg.id }, data: { status: "failed", error } });
    throw e;
  }
}

async function loadEvent(workspaceId: string, eventId: string) {
  const ev = await db.event.findFirst({ where: { id: eventId, workspaceId }, include: { owner: { select: { id: true, name: true, email: true } } } });
  if (!ev) throw new MeetingError("Termin nicht gefunden.");
  return ev;
}

/** Absage: alle Kopien entfernen bzw. absagen, Teilnehmende benachrichtigen. */
export async function cancelMeeting(workspaceId: string, eventId: string, actor: string, reason = "") {
  const ev = await loadEvent(workspaceId, eventId);
  if (ev.status === "cancelled") return;
  const refs = (ev.externalRefs ?? {}) as ExternalRefs;
  const attendees = (ev.attendees ?? []) as Attendee[];
  const errors: string[] = [];
  if (refs.organizer) {
    try {
      const conn = await db.calendarConnection.findUniqueOrThrow({ where: { id: refs.organizer.connectionId } });
      const token = await accessTokenFor(conn);
      if (refs.organizer.provider === "google") await googleDeleteEvent(token, refs.organizer.calendarId, refs.organizer.eventId, true);
      else await graphCancelEvent(token, refs.organizer.eventId, reason || "Der Termin wurde abgesagt.");
    } catch (e) {
      errors.push(`Organisator-Kalender: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (refs.team) {
    try {
      const conn = await db.calendarConnection.findUniqueOrThrow({ where: { id: refs.team.connectionId } });
      const token = await accessTokenFor(conn);
      if (refs.team.provider === "google") await googleDeleteEvent(token, refs.team.calendarId, refs.team.eventId, false);
      else await graphDeleteEvent(token, refs.team.eventId);
    } catch (e) {
      errors.push(`Teamkalender: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const sequence = ev.icsSequence + 1;
  if (refs.ics && ev.owner) {
    for (const a of [...attendees, { email: ev.owner.email, name: ev.owner.name, userId: ev.owner.id }]) {
      await sendInvite(workspaceId, a, {
        method: "CANCEL",
        uid: ev.icsUid ?? `${ev.id}@kundrio`,
        sequence,
        start: ev.startsAt,
        end: ev.endsAt,
        title: ev.title,
        description: reason,
        location: ev.location,
        url: ev.joinUrl,
        organizer: { email: ev.owner.email, name: ev.owner.name },
        attendees,
        reminders: [],
        video: ev.videoProvider as VideoProvider,
      }).catch((e) => errors.push(`Absage-Mail an ${a.email}: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  await db.event.update({ where: { id: ev.id }, data: { status: "cancelled", icsSequence: sequence } });
  for (const a of attendees.filter((x) => x.contactId)) {
    await db.activity.create({ data: { workspaceId, contactId: a.contactId!, type: "SYSTEM", body: `Termin abgesagt: ${ev.title}`, meta: { eventId: ev.id } } });
  }
  await audit({ workspaceId, actor, action: "meeting.cancelled", target: ev.id, detail: { errors: errors.length } });
  return { errors };
}

/** Verschieben: alle Kopien aktualisieren (Google/Microsoft benachrichtigen selbst; ICS mit SEQUENCE+1). */
export async function rescheduleMeeting(workspaceId: string, eventId: string, start: Date, durationMin: number | null, actor: string) {
  const ev = await loadEvent(workspaceId, eventId);
  if (ev.status === "cancelled") throw new MeetingError("Abgesagte Termine lassen sich nicht verschieben.");
  const dur = durationMin ?? Math.round((ev.endsAt.getTime() - ev.startsAt.getTime()) / 60000);
  const end = new Date(start.getTime() + dur * 60000);
  const refs = (ev.externalRefs ?? {}) as ExternalRefs;
  const attendees = (ev.attendees ?? []) as Attendee[];
  const errors: string[] = [];
  const time = (r: ExternalRef) => (r.provider === "google" ? toGoogleEvent({ title: ev.title, start, end, attendees: [], withMeet: false }) : toGraphEvent({ title: ev.title, start, end, attendees: [], withTeams: false }));
  for (const [key, r] of Object.entries({ organizer: refs.organizer, team: refs.team })) {
    if (!r) continue;
    try {
      const conn = await db.calendarConnection.findUniqueOrThrow({ where: { id: r.connectionId } });
      const token = await accessTokenFor(conn);
      const t = time(r) as { start: unknown; end: unknown };
      if (r.provider === "google") await googlePatchEvent(token, r.calendarId, r.eventId, { start: t.start, end: t.end }, key === "organizer");
      else await graphUpdateEvent(token, r.eventId, { start: t.start, end: t.end });
    } catch (e) {
      errors.push(`${key === "organizer" ? "Organisator-Kalender" : "Teamkalender"}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const sequence = ev.icsSequence + 1;
  if (refs.ics && ev.owner) {
    for (const a of [...attendees, { email: ev.owner.email, name: ev.owner.name, userId: ev.owner.id }]) {
      await sendInvite(workspaceId, a, {
        method: "REQUEST",
        uid: ev.icsUid ?? `${ev.id}@kundrio`,
        sequence,
        start,
        end,
        title: ev.title,
        description: ev.description ?? "",
        location: ev.location ?? ev.joinUrl,
        url: ev.joinUrl,
        organizer: { email: ev.owner.email, name: ev.owner.name },
        attendees,
        reminders: [15],
        video: ev.videoProvider as VideoProvider,
      }).catch((e) => errors.push(`Aktualisierung an ${a.email}: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  await db.event.update({ where: { id: ev.id }, data: { startsAt: start, endsAt: end, icsSequence: sequence } });
  await audit({ workspaceId, actor, action: "meeting.rescheduled", target: ev.id, detail: { errors: errors.length } });
  return { errors };
}
