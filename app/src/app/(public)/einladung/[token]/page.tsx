import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { findOpenInvitation, INVITED_PASSWORD } from "@/lib/invitations";
import { KundrioLogo } from "@/components/KundrioLogo";
import { btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { acceptAsExistingUser, acceptAsNewUser } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Einladung annehmen – Kundrio", robots: { index: false } };

const AGENCY_LABEL: Record<string, string> = { owner: "Inhaber", admin: "Admin", member: "Mitarbeiter" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findOpenInvitation(token);

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto mt-12 max-w-md">
      <div className="mb-8 flex justify-center"><KundrioLogo className="h-10" /></div>
      <div className="rounded-xl border border-ink-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-ink-900">{children}</div>
    </div>
  );

  if (!inv) {
    return shell(
      <>
        <h1 className="mb-2 font-display text-2xl">Einladung nicht gültig</h1>
        <p className="text-[15px] text-ink-600 dark:text-ink-200">Der Link ist abgelaufen, wurde widerrufen oder bereits verwendet. Bitte bitten Sie um eine neue Einladung.</p>
      </>,
    );
  }

  const role = inv.workspace
    ? (await db.role.findUnique({ where: { workspaceId_key: { workspaceId: inv.workspace.id, key: inv.roleKey ?? "" } } }))?.name ?? inv.roleKey
    : AGENCY_LABEL[inv.agencyRole ?? "member"];
  const target = inv.workspace ? inv.workspace.name : `Agentur ${(await db.agency.findFirst({ select: { name: true } }))?.name ?? ""}`.trim();
  const user = await db.user.findUnique({ where: { email: inv.email }, select: { passwordHash: true } });
  const isNew = !user || user.passwordHash === INVITED_PASSWORD;
  const me = await getCurrentUser();

  return shell(
    <>
      <h1 className="mb-1 font-display text-2xl">Einladung annehmen</h1>
      <p className="mb-5 text-[15px] text-ink-600 dark:text-ink-200">
        Zugang zu <b>{target}</b> als <b>{role}</b> für <b>{inv.email}</b>.
      </p>
      {isNew ? (
        <StateForm action={acceptAsNewUser.bind(null, token)} className="space-y-4">
          <label className="block"><span className={labelCls}>Ihr Name</span><input name="name" required maxLength={120} autoComplete="name" className={inputCls} /></label>
          <label className="block"><span className={labelCls}>Passwort (mind. 12 Zeichen)</span><input name="password" type="password" required minLength={12} autoComplete="new-password" className={inputCls} /></label>
          <label className="block"><span className={labelCls}>Passwort wiederholen</span><input name="confirm" type="password" required minLength={12} autoComplete="new-password" className={inputCls} /></label>
          <Submit>Konto aktivieren</Submit>
        </StateForm>
      ) : me && me.email === inv.email ? (
        <StateForm action={acceptAsExistingUser.bind(null, token)}>
          <p className="text-[15px]">Sie sind als {me.name} angemeldet.</p>
          <Submit>Einladung annehmen</Submit>
        </StateForm>
      ) : (
        <div className="space-y-3 text-[15px]">
          <p>Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melden Sie sich {me ? <>mit <b>{inv.email}</b> an (aktuell angemeldet als {me.email})</> : "an"} und öffnen Sie den Link erneut.</p>
          <Link href={`/login?next=${encodeURIComponent(`/einladung/${token}`)}`} className={btnGhostCls}>Zur Anmeldung</Link>
        </div>
      )}
    </>,
  );
}
