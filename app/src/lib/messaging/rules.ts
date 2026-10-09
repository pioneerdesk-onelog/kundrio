// Versandregeln für WhatsApp/SMS (rein, ohne DB – testbar).
// Rechtsgrundlage Werbung: § 7 Abs. 2 Nr. 2 UWG – Werbung über elektronische Post (dazu zählen SMS/Messenger)
// nur mit vorheriger ausdrücklicher Einwilligung. Transaktionale Nachrichten (Antwort auf Anfrage, Vertrag) sind keine Werbung.

export type ChannelKind = "whatsapp" | "sms";
export type Purpose = "transactional" | "marketing";

export const WHATSAPP_WINDOW_HOURS = 24;

/** Abmeldewörter (Groß/Klein egal, nur wenn die Nachricht im Wesentlichen nur daraus besteht). */
const STOP_WORDS = ["stop", "stopp", "abmelden", "abbestellen", "unsubscribe", "austragen", "keine nachrichten mehr"];
const START_WORDS = ["start", "anmelden"];

function norm(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStopMessage(text: string | null | undefined): boolean {
  const t = norm(text ?? "");
  if (!t || t.length > 40) return false;
  return STOP_WORDS.some((w) => t === w || t === `bitte ${w}` || t.startsWith(`${w} `) || t.endsWith(` ${w}`));
}

export function isStartMessage(text: string | null | undefined): boolean {
  const t = norm(text ?? "");
  return START_WORDS.includes(t);
}

/** Liegt der letzte Eingang innerhalb des Kundenservice-Fensters? */
export function withinWindow(lastInboundAt: Date | null | undefined, now = new Date(), hours = WHATSAPP_WINDOW_HOURS): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < hours * 3600_000;
}

export type ConsentState = {
  smsConsentAt?: Date | null;
  whatsappConsentAt?: Date | null;
  whatsappOptOutAt?: Date | null;
  /** SMS-Abmeldung (Contact.attributes.SMS_OPT_OUT_AT) */
  smsOptOutAt?: Date | null;
};

export type SendCheck =
  | { ok: true }
  | { ok: false; code: "opted_out" | "no_consent" | "window_closed" | "no_template" | "no_number"; message: string };

/**
 * Darf an diesen Kontakt über diesen Kanal gesendet werden?
 * - Abmeldung sperrt alles außer der einmaligen Abmeldebestätigung (separat, nicht über diese Prüfung).
 * - Werbung braucht die Kanal-Einwilligung.
 * - WhatsApp: Freitext nur im 24-h-Fenster, sonst nur freigegebene Vorlage.
 */
export function checkSend(input: {
  kind: ChannelKind;
  purpose: Purpose;
  hasNumber: boolean;
  consent: ConsentState;
  lastInboundAt?: Date | null;
  usesTemplate: boolean;
  now?: Date;
}): SendCheck {
  const { kind, purpose, consent } = input;
  if (!input.hasNumber) return { ok: false, code: "no_number", message: "Für den Kontakt ist keine gültige Mobilnummer hinterlegt." };
  const optedOut = kind === "whatsapp" ? consent.whatsappOptOutAt : consent.smsOptOutAt;
  if (optedOut) return { ok: false, code: "opted_out", message: `Der Kontakt hat sich von ${kind === "whatsapp" ? "WhatsApp" : "SMS"}-Nachrichten abgemeldet.` };
  if (purpose === "marketing") {
    const consentAt = kind === "whatsapp" ? consent.whatsappConsentAt : consent.smsConsentAt;
    if (!consentAt) {
      return { ok: false, code: "no_consent", message: "Werbung per SMS/WhatsApp nur mit vorheriger ausdrücklicher Einwilligung (§ 7 Abs. 2 Nr. 2 UWG)." };
    }
  }
  if (kind === "whatsapp" && !input.usesTemplate && !withinWindow(input.lastInboundAt, input.now)) {
    return {
      ok: false,
      code: "window_closed",
      message: "Außerhalb des 24-Stunden-Fensters erlaubt WhatsApp nur freigegebene Vorlagen.",
    };
  }
  return { ok: true };
}
