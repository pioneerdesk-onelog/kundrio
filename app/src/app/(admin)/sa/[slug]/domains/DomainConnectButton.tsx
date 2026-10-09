"use client";

import { useActionState } from "react";
import { btnGhostCls } from "@/components/ui";
import type { DcState } from "./actions";

export function DomainConnectButton({ action }: { action: (prev: DcState) => Promise<DcState> }) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <div className="space-y-2">
      <form action={run}>
        <button className={btnGhostCls} disabled={pending}>{pending ? "Prüfe …" : "Domain Connect prüfen"}</button>
      </form>
      {state.error && <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">{state.error}</p>}
      {state.ok && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
          {state.ok}{" "}
          {state.applyUrl && (
            <a className="font-medium underline" href={state.applyUrl} target="_blank" rel="noopener noreferrer">
              Beim Anbieter bestätigen
            </a>
          )}
        </p>
      )}
    </div>
  );
}
