"use client";

import { useState } from "react";
import { inputCls, labelCls } from "@/components/ui";
import { StateForm, Submit, type FormState } from "./StateForm";

type Ws = { id: string; name: string; roles: { key: string; name: string }[] };

export function AgencyInviteForm({ action, workspaces, canGrantPrivileged }: { action: (p: FormState, fd: FormData) => Promise<FormState>; workspaces: Ws[]; canGrantPrivileged: boolean }) {
  const [role, setRole] = useState("member");
  return (
    <StateForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>E-Mail</span>
          <input name="email" type="email" required maxLength={200} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Name (optional)</span>
          <input name="name" maxLength={120} className={inputCls} />
        </label>
      </div>
      <fieldset>
        <legend className={labelCls}>Agentur-Rolle</legend>
        <div className="flex flex-wrap gap-4 text-[15px]">
          <label className="flex items-center gap-2"><input type="radio" name="agencyRole" value="member" checked={role === "member"} onChange={() => setRole("member")} /> Mitarbeiter (nur zugewiesene Sub-Accounts)</label>
          <label className={`flex items-center gap-2 ${canGrantPrivileged ? "" : "opacity-50"}`}><input type="radio" name="agencyRole" value="admin" disabled={!canGrantPrivileged} checked={role === "admin"} onChange={() => setRole("admin")} /> Admin (alle Sub-Accounts, Benutzer)</label>
          <label className={`flex items-center gap-2 ${canGrantPrivileged ? "" : "opacity-50"}`}><input type="radio" name="agencyRole" value="owner" disabled={!canGrantPrivileged} checked={role === "owner"} onChange={() => setRole("owner")} /> Inhaber (alles inkl. Abrechnung)</label>
        </div>
        {!canGrantPrivileged && <p className="mt-1 text-sm text-ink-400">Admins und Inhaber kann nur ein Inhaber einladen.</p>}
      </fieldset>
      {role === "member" && (
        <fieldset>
          <legend className={labelCls}>Sub-Accounts und Rolle dort</legend>
          <div className="space-y-2">
            {workspaces.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-48 items-center gap-2 text-[15px]">
                  <input type="checkbox" name="ws" value={w.id} /> {w.name}
                </label>
                <select name={`role_${w.id}`} defaultValue="vertrieb" className={`${inputCls} max-w-56`} aria-label={`Rolle in ${w.name}`}>
                  {w.roles.map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <Submit>Einladung senden</Submit>
    </StateForm>
  );
}
