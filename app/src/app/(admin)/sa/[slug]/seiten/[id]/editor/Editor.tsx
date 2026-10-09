"use client";

import "@puckeditor/core/puck.css";
import { Puck, useGetPuck, type Data } from "@puckeditor/core";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { createConfig } from "@/components/blocks/config";
import type { PageMeta } from "@/components/blocks/types";
import type { ActionState } from "../../actions";

type Props = {
  title: string;
  data: object;
  meta: PageMeta;
  forms: { id: string; name: string }[];
  save: (data: unknown) => Promise<ActionState>;
  backHref: string;
};

function SaveActions({ save, backHref, onResult }: { save: Props["save"]; backHref: string; onResult: (s: ActionState) => void }) {
  const getPuck = useGetPuck();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Link href={backHref} className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm text-[#1f2a37] hover:bg-black/5">Zurück</Link>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => onResult(await save(getPuck().appState.data)))}
        className="rounded-md bg-[#0b4f6c] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#08405a] disabled:opacity-50"
      >
        {pending ? "Speichert …" : "Entwurf speichern"}
      </button>
    </div>
  );
}

export function Editor({ title, data, meta, forms, save, backHref }: Props) {
  const config = useMemo(() => createConfig(forms), [forms]);
  const [status, setStatus] = useState<ActionState>({});
  const [dirty, setDirty] = useState(false);
  // Vergleichsbasis: zuletzt gespeicherter Stand (Puck meldet onChange auch beim Laden)
  const saved = useRef(JSON.stringify(data));
  const latest = useRef<unknown>(data);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-[#1f2a37]">
      <div role="status" aria-live="polite" className="sr-only">{status.ok ?? status.error ?? ""}</div>
      {(status.ok || status.error || dirty) && (
        <div className={`px-4 py-1.5 text-sm ${status.error ? "bg-red-50 text-red-800" : dirty ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
          {status.error ?? (dirty ? "Ungespeicherte Änderungen – zum Veröffentlichen erst speichern, dann auf der Seitenübersicht prüfen und veröffentlichen." : status.ok)}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Puck
          config={config}
          data={data as Partial<Data>}
          metadata={meta}
          headerTitle={title}
          height="100%"
          onChange={(d) => {
            latest.current = d;
            setDirty(JSON.stringify(d) !== saved.current);
          }}
          overrides={{
            headerActions: () => (
              <SaveActions
                save={save}
                backHref={backHref}
                onResult={(s) => {
                  setStatus(s);
                  if (s.ok) {
                    saved.current = JSON.stringify(latest.current);
                    setDirty(false);
                  }
                }}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
