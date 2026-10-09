import { redirect } from "next/navigation";

// Das frühere Automations-Modul ist in den Prozessen aufgegangen.
export default async function AutomationenRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/sa/${slug}/prozesse`);
}
