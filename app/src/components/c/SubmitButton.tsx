"use client";

import { useFormStatus } from "react-dom";
import { btnCls, btnGhostCls } from "@/components/ui";

export function SubmitButton({
  children,
  pending: pendingLabel = "Läuft …",
  ghost = false,
  confirm,
}: {
  children: React.ReactNode;
  pending?: string;
  ghost?: boolean;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={ghost ? btnGhostCls : btnCls}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ state }: { state: { ok?: string; error?: string } }) {
  if (state.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-green-700 dark:text-green-500">{state.ok}</p>;
  return null;
}
