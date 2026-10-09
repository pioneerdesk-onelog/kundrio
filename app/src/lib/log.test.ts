import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

describe("log – keine personenbezogenen Daten in Server-Logs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maskiert E-Mail-Adressen in Fehlertexten (z. B. SMTP-Ablehnung)", () => {
    const out: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => (out.push(String(s)), true));
    log.error("job failed", { type: "mail.transactional", error: "550 5.1.1 <Anna.Probe+x@Example.de>: Recipient address rejected" });
    expect(out.join("")).not.toMatch(/anna\.probe/i);
    expect(out.join("")).toContain("550 5.1.1");
    expect(out.join("")).toContain("[E-Mail]");
  });

  it("maskiert Felder mit verdächtigen Namen weiterhin", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    log.info("x", { email: "a@b.de", jobId: "j1" });
    expect(out.join("")).toContain("[maskiert]");
    expect(out.join("")).toContain("j1");
  });
});
