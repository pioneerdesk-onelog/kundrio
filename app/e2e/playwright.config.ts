import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Umgebung aus app/.env laden (DB, Mailpit, E2E_* Adressen)
try {
  process.loadEnvFile(path.join(__dirname, "../.env"));
} catch {
  /* .env optional (CI setzt Variablen direkt) */
}

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: path.join(__dirname, "tests"),
  outputDir: path.join(__dirname, "out/test-results"),
  globalSetup: path.join(__dirname, "global-setup.ts"),
  fullyParallel: false, // gemeinsame Testdaten → nacheinander, reproduzierbar
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(__dirname, "out/results.json") }],
    ["html", { open: "never", outputFolder: path.join(__dirname, "out/html") }],
  ],
  use: {
    baseURL: BASE_URL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
