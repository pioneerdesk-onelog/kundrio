import { NextResponse } from "next/server";
import { getCurrentUser, isAgencyStaffUser } from "@/lib/auth";
import { agencyZip } from "@/lib/export";

export const dynamic = "force-dynamic";

// Agentur-Gesamtexport: nur Agentur-Administratoren.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? "http://127.0.0.1:3100"));
  if (!isAgencyStaffUser(user)) return new NextResponse("Nur für Agentur-Administratoren", { status: 403 });
  const body = await agencyZip();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(body), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="export-agentur-${date}.zip"`,
      "cache-control": "no-store",
    },
  });
}
