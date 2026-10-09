import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import { driverFromEnv, type StorageDriver } from "./drivers";
import { ALLOWED, detectFileType, safeFileName } from "./validate";

export { MAX_FILE_BYTES, ACCEPT_ATTR } from "./validate";

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  driver ??= driverFromEnv();
  return driver;
}

export type StoredFileKind = "brandbook" | "logo" | "document" | "other";

/**
 * Datei prüfen und ablegen. Gleiche Datei (Prüfsumme) im selben Sub-Account wird nicht doppelt gespeichert.
 * Hinweis: Es gibt (noch) keinen Virenscan – Dateien werden nie ausgeführt und nur als Download ausgeliefert.
 */
export async function storeFile(input: { workspaceId: string; kind: StoredFileKind; name: string; data: Uint8Array; createdBy?: string }) {
  const type = detectFileType(input.name, input.data);
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const existing = await db.storedFile.findFirst({ where: { workspaceId: input.workspaceId, sha256, kind: input.kind } });
  if (existing) return { file: existing, duplicate: true as const };

  const name = safeFileName(input.name);
  const ext = ALLOWED[type].ext[0];
  const now = new Date();
  const key = `${input.workspaceId}/${now.getUTCFullYear()}/${randomBytes(12).toString("hex")}.${ext}`;
  await storage().put(key, input.data, ALLOWED[type].mime);
  try {
    const file = await db.storedFile.create({
      data: { workspaceId: input.workspaceId, kind: input.kind, name, mime: ALLOWED[type].mime, size: input.data.length, sha256, storageKey: key, createdBy: input.createdBy },
    });
    return { file, duplicate: false as const };
  } catch (e) {
    await storage().delete(key).catch(() => {});
    throw e;
  }
}

export async function readStoredFile(workspaceId: string, fileId: string) {
  const file = await db.storedFile.findFirst({ where: { id: fileId, workspaceId } });
  if (!file) return null;
  return { file, data: await storage().get(file.storageKey) };
}

export async function deleteStoredFile(workspaceId: string, fileId: string) {
  const file = await db.storedFile.findFirst({ where: { id: fileId, workspaceId } });
  if (!file) return false;
  await storage().delete(file.storageKey);
  await db.storedFile.delete({ where: { id: file.id } });
  return true;
}
