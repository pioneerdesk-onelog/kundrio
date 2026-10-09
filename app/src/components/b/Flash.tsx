// Zeigt Erfolgs- oder Fehlermeldungen aus ?ok= / ?fehler= an.
export function Flash({ ok, fehler }: { ok?: string; fehler?: string }) {
  if (!ok && !fehler) return null;
  return (
    <div
      role={fehler ? "alert" : "status"}
      className={`mb-4 rounded-md border px-3 py-2 text-sm ${
        fehler
          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          : "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
      }`}
    >
      {fehler ?? ok}
    </div>
  );
}

export type FlashParams = Promise<{ ok?: string; fehler?: string }>;
