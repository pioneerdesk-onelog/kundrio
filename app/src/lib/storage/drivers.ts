import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { rfc3986, sha256Hex, signV4 } from "./sigv4";

// Speicher-Treiber: lokal (Entwicklung/VM) oder S3-kompatibel (STACKIT Object Storage).
// Dateien sind nie öffentlich – Auslieferung nur über geschützte Routen der App.

export interface StorageDriver {
  readonly kind: "local" | "s3";
  put(key: string, data: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Schlüssel nur aus sicheren Zeichen, keine Pfad-Ausbrüche. */
export function assertSafeKey(key: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,400}$/.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Ungültiger Speicher-Schlüssel");
  }
}

export class LocalDriver implements StorageDriver {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  private file(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Ungültiger Speicher-Schlüssel");
    return full;
  }

  async put(key: string, data: Uint8Array, _mime?: string) {
    const full = this.file(key);
    await mkdir(path.dirname(full), { recursive: true });
    // Atomar schreiben: erst Temp-Datei, dann umbenennen
    const tmp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, full);
  }

  async get(key: string) {
    return readFile(this.file(key));
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

export type S3Config = { endpoint: string; bucket: string; accessKey: string; secretKey: string; region: string };

export class S3Driver implements StorageDriver {
  readonly kind = "s3" as const;
  constructor(private readonly cfg: S3Config) {}

  // Pfad-Stil (endpoint/bucket/key) – funktioniert mit STACKIT und anderen S3-kompatiblen Diensten
  private url(key: string) {
    assertSafeKey(key);
    const base = this.cfg.endpoint.replace(/\/+$/, "");
    return new URL(`${base}/${rfc3986(this.cfg.bucket)}/${key.split("/").map(rfc3986).join("/")}`);
  }

  private async request(method: string, key: string, body?: Uint8Array, mime?: string) {
    const url = this.url(key);
    const payloadHash = body ? sha256Hex(body) : sha256Hex("");
    const headers = signV4({
      method,
      url,
      headers: { "x-amz-content-sha256": payloadHash, ...(mime ? { "content-type": mime } : {}) },
      payloadHash,
      accessKey: this.cfg.accessKey,
      secretKey: this.cfg.secretKey,
      region: this.cfg.region,
      service: "s3",
    });
    delete headers.host; // setzt fetch selbst
    const res = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined, signal: AbortSignal.timeout(30_000) });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      const text = await res.text().catch(() => "");
      const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
      throw new Error(`Objektspeicher: ${method} fehlgeschlagen (HTTP ${res.status}${code ? `, ${code}` : ""})`);
    }
    return res;
  }

  async put(key: string, data: Uint8Array, mime: string) {
    await this.request("PUT", key, data, mime);
  }

  async get(key: string) {
    const res = await this.request("GET", key);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string) {
    await this.request("DELETE", key);
  }
}

/** Treiber aus der Umgebung: S3, wenn S3_ENDPOINT + S3_BUCKET gesetzt sind, sonst lokaler Ordner. */
export function driverFromEnv(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  if (env.S3_ENDPOINT && env.S3_BUCKET) {
    if (!env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) throw new Error("S3_ACCESS_KEY und S3_SECRET_KEY fehlen");
    return new S3Driver({
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      region: env.S3_REGION || "eu01",
    });
  }
  return new LocalDriver(path.resolve(env.FILE_STORAGE_DIR || path.join(process.cwd(), ".data/files")));
}
