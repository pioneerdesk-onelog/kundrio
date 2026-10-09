import { describe, expect, it } from "vitest";
import { agencyFieldsForCli } from "./user-setup";

// Lasttest 2026-10-07 (LR-9): `npm run user:create -- … --agency` setzte nur isAgencyAdmin, agencyRole blieb „member“.
// Folge: Der laut Runbook erste Benutzer zählte nicht als Inhaber/Admin (Benutzerverwaltung, Zuweisungslisten im
// Posteingang/Team/Kalender, Konsistenzprüfung „Zuständige haben Zugriff“ mit 6.356 Abweichungen).

describe("agencyFieldsForCli", () => {
  it("erster Agentur-Benutzer wird Inhaber", () => {
    expect(agencyFieldsForCli({ agency: true, activeOwners: 0 })).toEqual({ isAgencyAdmin: true, agencyRole: "owner" });
  });
  it("weitere Agentur-Benutzer werden Admin", () => {
    expect(agencyFieldsForCli({ agency: true, activeOwners: 1 })).toEqual({ isAgencyAdmin: true, agencyRole: "admin" });
  });
  it("ohne --agency: Mitarbeiter", () => {
    expect(agencyFieldsForCli({ agency: false, activeOwners: 1 })).toEqual({ isAgencyAdmin: false, agencyRole: "member" });
  });
});
