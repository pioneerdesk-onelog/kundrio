import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalDriver, assertSafeKey, driverFromEnv } from "./drivers";
import { signV4, sha256Hex } from "./sigv4";
import { detectFileType, MAX_FILE_BYTES, safeFileName } from "./validate";

const enc = (s: string) => new TextEncoder().encode(s);

describe("Upload-Prüfung", () => {
  it("erkennt erlaubte Typen am Inhalt", () => {
    expect(detectFileType("CI.pdf", enc("%PDF-1.7 …"))).toBe("pdf");
    expect(detectFileType("brand.docx", new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toBe("docx");
    expect(detectFileType("logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(detectFileType("logo.svg", enc('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("svg");
    expect(detectFileType("notes.md", enc("# Marke"))).toBe("md");
  });
  it("lehnt falsche Endung, getarnte Inhalte, leere und zu große Dateien ab", () => {
    expect(() => detectFileType("x.exe", enc("MZ"))).toThrow(/nicht erlaubt/);
    expect(() => detectFileType("fake.pdf", enc("<html>"))).toThrow(/passt nicht/);
    expect(() => detectFileType("leer.txt", new Uint8Array())).toThrow(/leer/);
    expect(() => detectFileType("bin.txt", new Uint8Array([1, 0, 2]))).toThrow(/passt nicht/);
    expect(() => detectFileType("gross.pdf", new Uint8Array(MAX_FILE_BYTES + 1))).toThrow(/25 MB/);
  });
  it("bereinigt Dateinamen", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName('C:\\x\\Mein "CI".pdf')).toBe("Mein _CI_.pdf");
  });
});

describe("Lokaler Speicher", () => {
  let dir = "";
  afterAll(async () => dir && rm(dir, { recursive: true, force: true }));
  it("schreibt, liest, löscht – ohne Pfad-Ausbruch", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "crm-store-"));
    const d = new LocalDriver(dir);
    await d.put("ws1/2026/abc.pdf", enc("hallo"), "application/pdf");
    expect((await d.get("ws1/2026/abc.pdf")).toString()).toBe("hallo");
    expect((await readdir(path.join(dir, "ws1/2026"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    await d.delete("ws1/2026/abc.pdf");
    await expect(d.get("ws1/2026/abc.pdf")).rejects.toThrow();
    expect(() => assertSafeKey("../x")).toThrow();
    expect(() => assertSafeKey("a//b")).toThrow();
    await expect(d.put("/etc/x", enc("x"), "text/plain")).rejects.toThrow();
  });
  it("wählt den Treiber aus der Umgebung", () => {
    expect(driverFromEnv({ FILE_STORAGE_DIR: "/tmp/x" } as unknown as NodeJS.ProcessEnv).kind).toBe("local");
    expect(driverFromEnv({ S3_ENDPOINT: "https://s3.example", S3_BUCKET: "b", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "s" } as unknown as NodeJS.ProcessEnv).kind).toBe("s3");
    expect(() => driverFromEnv({ S3_ENDPOINT: "https://s3.example", S3_BUCKET: "b" } as unknown as NodeJS.ProcessEnv)).toThrow(/S3_ACCESS_KEY/);
  });
});

describe("AWS Signature V4", () => {
  it("entspricht dem offiziellen AWS-Testvektor (IAM ListUsers)", () => {
    const h = signV4({
      method: "GET",
      url: new URL("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      payloadHash: sha256Hex(""),
      accessKey: "AKIDEXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "iam",
      now: new Date("2015-08-30T12:36:00Z"),
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
    expect(h["x-amz-date"]).toBe("20150830T123600Z");
  });
});
