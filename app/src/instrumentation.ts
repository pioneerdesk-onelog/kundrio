// Läuft einmal beim Start des Next.js-Servers (nicht beim Build).
// Unvollständige Produktionskonfiguration → Prozess beenden (Next würde sonst „ungesund“ weiterlaufen).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnv } = await import("./lib/env");
  try {
    assertProductionEnv();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
