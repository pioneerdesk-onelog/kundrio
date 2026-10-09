"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import { btnCls, inputCls } from "@/components/ui";

export function LoginForm({ next, demo = false }: { next: string; demo?: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{demo ? "Benutzername oder E-Mail" : "E-Mail"}</span>
        <input name="email" type={demo ? "text" : "email"} autoComplete="username" required className={inputCls} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Passwort</span>
        <input name="password" type="password" autoComplete="current-password" required className={inputCls} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{state.error}</p>}
      <button className={`${btnCls} w-full justify-center`} disabled={pending}>
        {pending ? "Anmelden …" : "Anmelden"}
      </button>
    </form>
  );
}
