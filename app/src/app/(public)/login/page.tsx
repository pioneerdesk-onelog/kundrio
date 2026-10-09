import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { KundrioLogo } from "@/components/KundrioLogo";
import { LoginForm } from "./LoginForm";
import { demoGuest } from "@/lib/demo";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="mb-8 flex justify-center"><KundrioLogo className="h-10" /></div>
      <div className="rounded-xl border border-ink-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-ink-900">
        <h1 className="mb-4 font-display text-2xl">Anmelden</h1>
        <LoginForm next={next ?? "/"} demo={!!demoGuest()} />
      </div>
    </div>
  );
}
