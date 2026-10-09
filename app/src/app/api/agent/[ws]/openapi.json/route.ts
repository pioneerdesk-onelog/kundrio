import { getPublicWorkspace } from "@/lib/agent-core";
import { json, preflight } from "@/lib/agent-http";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ws: string }> }) {
  const ws = await getPublicWorkspace((await params).ws);
  if (!ws) return json({ error: "Unbekannt" }, 404);
  const err = { $ref: "#/components/schemas/Error" };
  return json({
    openapi: "3.1.0",
    info: {
      title: `${ws.name} – Schnittstelle für KI-Assistenten`,
      version: "1.0.0",
      description:
        "Fragen zu Angebot und Leistungen stellen und Anfragen übermitteln. Antworten stammen nur aus veröffentlichten Informationen und sind KI-generiert. Anfragen bearbeitet ein Mensch.",
    },
    servers: [{ url: `${env.appUrl()}/api/agent/${ws.slug}` }],
    paths: {
      "/info": {
        get: {
          operationId: "getInfo",
          summary: "Profil, Sprachen und Endpunkte",
          responses: { "200": { description: "Profil", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/ask": {
        post: {
          operationId: "ask",
          summary: "Frage aus veröffentlichten Informationen beantworten (KI-generiert, mit Quellen)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["question"],
                  properties: {
                    question: { type: "string", minLength: 3, maxLength: 1000 },
                    language: { type: "string", description: "z. B. de, en" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Antwort", content: { "application/json": { schema: { $ref: "#/components/schemas/Answer" } } } },
            "400": { description: "Ungültige Eingabe", content: { "application/json": { schema: err } } },
            "429": { description: "Zu viele Anfragen", content: { "application/json": { schema: err } } },
          },
        },
      },
      "/request": {
        post: {
          operationId: "requestContact",
          summary: "Kontakt-, Termin- oder Angebotsanfrage übermitteln (wird von einem Menschen bearbeitet)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "email", "message"],
                  properties: {
                    type: { type: "string", enum: ["contact", "appointment", "quote"], default: "contact" },
                    name: { type: "string", maxLength: 200 },
                    email: { type: "string", format: "email" },
                    phone: { type: "string", maxLength: 40 },
                    company: { type: "string", maxLength: 200 },
                    message: { type: "string", minLength: 5, maxLength: 4000 },
                    preferredTimes: { type: "string", maxLength: 500 },
                    agent: { type: "string", maxLength: 120, description: "Name des anfragenden KI-Assistenten" },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Angenommen", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, message: { type: "string" } } } } } },
            "400": { description: "Ungültige Eingabe", content: { "application/json": { schema: err } } },
            "429": { description: "Zu viele Anfragen", content: { "application/json": { schema: err } } },
          },
        },
      },
    },
    components: {
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" } } },
        Answer: {
          type: "object",
          properties: {
            answer: { type: "string" },
            aiGenerated: { type: "boolean" },
            notice: { type: "string" },
            sources: {
              type: "array",
              items: { type: "object", properties: { n: { type: "integer" }, title: { type: "string" }, url: { type: ["string", "null"] }, score: { type: "number" } } },
            },
          },
        },
      },
    },
  });
}

export const OPTIONS = preflight;
