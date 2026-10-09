"use client";

import { inputCls } from "@/components/ui";
import { StateForm, Submit, type FormState } from "./StateForm";

export function TeamForm({
  action,
  name,
  members,
  selected,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  name: string;
  members: { id: string; name: string }[];
  selected: string[];
}) {
  return (
    <StateForm action={action}>
      <input name="name" defaultValue={name} required maxLength={80} aria-label="Teamname" className={inputCls} />
      <fieldset>
        <legend className="mb-1 text-sm text-ink-400">Mitglieder</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2">
              <input type="checkbox" name="member" value={m.id} defaultChecked={selected.includes(m.id)} /> {m.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Submit variant="ghost">Team speichern</Submit>
    </StateForm>
  );
}
