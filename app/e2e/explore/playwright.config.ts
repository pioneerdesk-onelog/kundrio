import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Erkundungstest je Rolle (Testplan Block 2) – NICHT Teil von `npm run e2e`.
//   npx playwright test -c e2e/explore/playwright.config.ts            (alle Rollen)
//   npx playwright test -c e2e/explore/playwright.config.ts -g vertrieb
// Screenshots + Befunde: e2e/out/explore/<rolle>/ (Seiten-PNGs, befunde.json)
try {
  process.loadEnvFile(path.join(__dirname, "../../.env"));
} catch {
  /* optional */
}

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.explore\.ts$/,
  outputDir: path.join(__dirname, "../out/explore/test-results"),
  globalSetup: path.join(__dirname, "../global-setup.ts"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
