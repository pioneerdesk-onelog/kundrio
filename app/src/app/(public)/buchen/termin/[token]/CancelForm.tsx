"use client";

import { useActionState } from "react";
import type { BookState } from "../../actions";

export function CancelForm({ action }: { action: (prev: BookState, fd: FormData) => Promise<BookState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Grund (optional)</span>
        <textarea name="reason" rows={2} maxLength={500} className="w-full rounded-md border border-black/20 bg-white px-3 py-2 text-[16px]" />
      </label>
      {state.error && (
        <p role="alert" className="text-[15px] text-red-700">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="rounded-lg border border-red-700 px-5 py-2.5 text-[15px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
        {pending ? "Wird abgesagt …" : "Termin absagen"}
      </button>
    </form>
  );
}
