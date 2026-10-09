import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { InboundMessage } from "../channel";
import { emailThreadKey, isAutoReply, isSpam, normalizeMessageId, parseReferences } from "../thread";

// RFC-822-Nachricht → InboundMessage (ohne DB, testbar mit Fixtures).

function addressesOf(a: AddressObject | AddressObject[] | undefined): { address: string; name?: string }[] {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  return list.flatMap((x) => x.value).filter((v) => v.address).map((v) => ({ address: v.address!.toLowerCase(), name: v.name || undefined }));
}

function headerMap(parsed: ParsedMail): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of parsed.headers) {
    out[k.toLowerCase()] = typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : (v as { text?: string; value?: unknown })?.text ?? String((v as { value?: unknown })?.value ?? "");
  }
  return out;
}

export async function parseRawEmail(raw: Buffer | string, opts: { fallbackId?: string } = {}): Promise<InboundMessage> {
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const from = addressesOf(parsed.from)[0];
  const messageId = normalizeMessageId(parsed.messageId) ?? `<${opts.fallbackId ?? `pd-${Date.now()}-${Math.random().toString(36).slice(2)}`}@inbox.local>`;
  const references = parseReferences(parsed.references as string | string[] | undefined);
  const inReplyTo = normalizeMessageId(parsed.inReplyTo) ?? undefined;
  const headers = headerMap(parsed);
  const subject = parsed.subject ?? undefined;
  return {
    externalId: messageId,
    threadKey: emailThreadKey({ messageId, inReplyTo, references }),
    from: from?.address ?? "unbekannt@invalid",
    fromName: from?.name,
    to: addressesOf(parsed.to).map((x) => x.address),
    cc: addressesOf(parsed.cc).map((x) => x.address),
    subject,
    text: (parsed.text ?? "").trim() || (parsed.html ? "(nur HTML-Inhalt)" : ""),
    html: typeof parsed.html === "string" ? parsed.html : undefined,
    inReplyTo,
    references,
    receivedAt: parsed.date ?? new Date(),
    attachments: parsed.attachments
      // eingebettete Bilder (cid:) nicht als Anhang übernehmen
      .filter((a) => a.contentDisposition !== "inline" || !a.contentId)
      .map((a) => ({ name: a.filename ?? "anhang", mime: a.contentType, content: a.content })),
    flags: { autoReply: isAutoReply(headers, subject, from?.address), spam: isSpam(headers) },
  };
}
