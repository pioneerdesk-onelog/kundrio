import { z } from "zod";

export const FIELD_TYPES = ["text", "email", "tel", "textarea"] as const;

export const fieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Schlüssel: Buchstaben, Ziffern, _ (mit Buchstabe beginnend)"),
  label: z.string().trim().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
});

export const fieldsSchema = z
  .array(fieldSchema)
  .min(1, "Mindestens ein Feld")
  .max(30)
  .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, "Schlüssel müssen eindeutig sein")
  .refine((fs) => fs.every((f) => !["consent", "website_url"].includes(f.key)), "Schlüssel consent/website_url sind reserviert");

export type FormField = z.infer<typeof fieldSchema>;

export function parseFields(raw: unknown): FormField[] {
  const r = fieldsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

const MAX_LEN: Record<FormField["type"], number> = { text: 200, email: 254, tel: 40, textarea: 5000 };

/** Baut aus der Formulardefinition ein zod-Schema für eine Einsendung. */
export function submissionSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    let s: z.ZodType;
    if (f.type === "email") s = z.email("Ungültige E-Mail-Adresse").max(MAX_LEN.email);
    else if (f.type === "tel") s = z.string().trim().max(MAX_LEN.tel).regex(/^[0-9+()\/\s.-]*$/, "Ungültige Telefonnummer");
    else s = z.string().trim().max(MAX_LEN[f.type]);
    if (f.required) s = (s as z.ZodString).min(1, `${f.label} ist ein Pflichtfeld`);
    shape[f.key] = f.required ? s : z.union([s, z.literal("")]).optional();
  }
  return z.object(shape);
}
