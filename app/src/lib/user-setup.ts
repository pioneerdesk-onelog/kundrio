// Agentur-Rolle für `npm run user:create` (scripts/user.ts). isAgencyAdmin ist aus agencyRole abgeleitet –
// beide Felder müssen zusammen gesetzt werden (LR-9). Rein, ohne DB.

export function agencyFieldsForCli(input: { agency: boolean; activeOwners: number }) {
  if (!input.agency) return { isAgencyAdmin: false, agencyRole: "member" as const };
  return { isAgencyAdmin: true, agencyRole: input.activeOwners === 0 ? ("owner" as const) : ("admin" as const) };
}
