import { toE164 } from "./phone";
import type { DeliveryUpdate } from "../inbox/channel";

// Webhook-Parser (rein, testbar). Struktur nach offizieller Doku:
// Meta: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
// seven: https://docs.seven.io/en/rest-api/webhooks

export type MediaRef = { id: string; mime: string; filename?: string; caption?: string };

export type ParsedInbound = {
  externalId: string;
  /** E.164 der Absenderin */
  from: string;
  fromName?: string;
  /** E.164 der eigenen Nummer (falls im Payload) */
  to?: string;
  text: string;
  receivedAt: Date;
  media?: MediaRef;
};

export type ParsedWebhook = { messages: ParsedInbound[]; updates: DeliveryUpdate[]; channelId?: string };

const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function waText(m: Record<string, unknown>): { text: string; media?: MediaRef } {
  const type = str(m.type);
  if (type === "text") return { text: str(obj(m.text).body) };
  if (type === "image" || type === "document" || type === "audio" || type === "video" || type === "sticker") {
    const o = obj(m[type]);
    const caption = str(o.caption);
    const filename = str(o.filename) || undefined;
    const label = { image: "Bild", document: "Dokument", audio: "Sprachnachricht", video: "Video", sticker: "Sticker" }[type];
    return { text: caption || `[${label}${filename ? `: ${filename}` : ""}]`, media: { id: str(o.id), mime: str(o.mime_type), filename, caption: caption || undefined } };
  }
  if (type === "button") return { text: str(obj(m.button).text) };
  if (type === "interactive") {
    const i = obj(m.interactive);
    return { text: str(obj(i.button_reply).title) || str(obj(i.list_reply).title) || "[Interaktive Antwort]" };
  }
  if (type === "location") {
    const l = obj(m.location);
    return { text: `[Standort ${str(l.latitude)}, ${str(l.longitude)}${l.name ? ` – ${str(l.name)}` : ""}]` };
  }
  if (type === "reaction") return { text: `[Reaktion ${str(obj(m.reaction).emoji)}]` };
  return { text: `[Nicht unterstützter Nachrichtentyp: ${type || "unbekannt"}]` };
}

const WA_STATUS: Record<string, DeliveryUpdate["status"] | undefined> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

export function parseWhatsAppWebhook(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], updates: [] };
  const root = obj(body);
  if (root.object !== "whatsapp_business_account") return out;
  for (const entry of asArr(root.entry)) {
    for (const change of asArr(obj(entry).changes)) {
      const c = obj(change);
      if (c.field !== "messages") continue;
      const v = obj(c.value);
      const meta = obj(v.metadata);
      out.channelId ??= str(meta.phone_number_id) || undefined;
      // Eigene Nummer kommt von Meta ohne „+“; notfalls nur Ziffern übernehmen (Testnummern sind nicht immer gültig)
      const display = str(meta.display_phone_number).replace(/\D/g, "");
      const ownNumber = toE164(display) ?? (display.length >= 8 ? `+${display}` : undefined);
      const names = new Map<string, string>();
      for (const ct of asArr(v.contacts)) names.set(str(obj(ct).wa_id), str(obj(obj(ct).profile).name));
      for (const raw of asArr(v.messages)) {
        const m = obj(raw);
        const from = toE164(str(m.from));
        const id = str(m.id);
        if (!from || !id) continue;
        const { text, media } = waText(m);
        out.messages.push({
          externalId: id,
          from,
          fromName: names.get(str(m.from)) || undefined,
          to: ownNumber,
          text: text.slice(0, 10_000),
          receivedAt: new Date(Number(str(m.timestamp)) * 1000 || Date.now()),
          media: media && media.id ? media : undefined,
        });
      }
      for (const raw of asArr(v.statuses)) {
        const s = obj(raw);
        const status = WA_STATUS[str(s.status)];
        if (!status || !str(s.id)) continue;
        const err = obj(asArr(s.errors)[0]);
        out.updates.push({
          externalId: str(s.id),
          status,
          error: status === "failed" ? `${str(err.code)} ${str(err.title) || str(err.message)}`.trim().slice(0, 300) || "Zustellung fehlgeschlagen" : undefined,
          at: new Date(Number(str(s.timestamp)) * 1000 || Date.now()),
        });
      }
    }
  }
  return out;
}

/** seven.io-DLR-Status → einheitlicher Status. */
export function mapSevenStatus(s: string): DeliveryUpdate["status"] | null {
  const u = s.toUpperCase();
  if (u === "DELIVERED") return "delivered";
  if (["NOTDELIVERED", "REJECTED", "FAILED", "EXPIRED"].includes(u)) return "failed";
  if (["TRANSMITTED", "ACCEPTED", "BUFFERED"].includes(u)) return "sent";
  return null;
}

/** seven sendet z. B. „2021-08-24 08:08:00.000000“ (Ortszeit Europa/Berlin laut Beispielen) oder ISO. */
function sevenDate(s: string): Date {
  if (/^\d{9,11}$/.test(s)) return new Date(Number(s) * 1000);
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function parseSevenWebhook(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], updates: [] };
  const root = obj(body);
  const data = obj(root.data);
  const event = str(root.webhook_event);
  if (event === "sms_mo") {
    const from = toE164(str(data.sender));
    const id = str(data.id);
    if (from && id) {
      out.messages.push({
        externalId: `seven:${id}`,
        from,
        to: toE164(str(data.system)) ?? undefined,
        text: str(data.text).slice(0, 5_000),
        receivedAt: sevenDate(str(data.time)),
      });
    }
  } else if (event === "dlr") {
    const status = mapSevenStatus(str(data.status));
    const id = str(data.msg_id);
    if (status && id) out.updates.push({ externalId: `seven:${id}`, status, at: sevenDate(str(data.timestamp)), error: status === "failed" ? `Status ${str(data.status)}` : undefined });
  }
  return out;
}
