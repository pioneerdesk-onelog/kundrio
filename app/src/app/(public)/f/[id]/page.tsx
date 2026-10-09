import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseFields } from "@/lib/b-forms";
import { PublicForm } from "@/components/b/PublicForm";
import { submitForm } from "./actions";
import { env } from "@/lib/env";
import { signFormTimestamp } from "@/lib/trust";

export const dynamic = "force-dynamic";

// Öffentliche Formularseite. Gibt nur Formularname, Felder und Absendername preis.
export default async function PublicFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await db.form.findUnique({ where: { id }, include: { workspace: { select: { name: true } } } });
  if (!form) notFound();
  return (
    <div className="mx-auto max-w-lg rounded-lg bg-white p-6 shadow-sm dark:bg-ink-900">
      <h1 className="mb-1 text-lg font-semibold">{form.name}</h1>
      <p className="mb-4 text-xs text-ink-400 dark:text-ink-200">{form.workspace.name}</p>
      <PublicForm action={submitForm.bind(null, form.id)} fields={parseFields(form.fields)} consentText={form.consentText} ts={signFormTimestamp(env.appSecret(), form.id)} />
    </div>
  );
}
