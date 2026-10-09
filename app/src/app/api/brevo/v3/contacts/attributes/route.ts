import { withApi } from "@/lib/lists-api";
import { listProperties, parseOptions, toBrevoType } from "@/lib/properties";

// GET /v3/contacts/attributes – Standardattribute + eigene Felder
const STANDARD = [
  { name: "FIRSTNAME", category: "normal", type: "text" },
  { name: "LASTNAME", category: "normal", type: "text" },
  { name: "SMS", category: "normal", type: "text" },
  { name: "COMPANY", category: "normal", type: "text" },
  { name: "DOUBLE_OPT-IN", category: "category", type: "category", enumeration: [{ value: 1, label: "Yes" }, { value: 2, label: "No" }] },
];

export async function GET(req: Request) {
  return withApi(req, "contacts:read", async ({ workspaceId }) => {
    const props = await listProperties(workspaceId);
    const custom = props
      .filter((p) => !STANDARD.some((s) => s.name === p.key))
      .map((p) => {
        const type = toBrevoType(p.type);
        const opts = parseOptions(p.options);
        return {
          name: p.key,
          category: type === "category" ? "category" : "normal",
          type,
          ...(type === "category" ? { enumeration: opts.map((o, i) => ({ value: i + 1, label: o.label })) } : {}),
        };
      });
    return Response.json({ attributes: [...STANDARD, ...custom] });
  });
}
