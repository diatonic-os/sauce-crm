// SPEC §18.7 — Export Encrypted Backup.
// Mirrors BackupService.run() payload shape but wraps the JSON in an AES-256-GCM
// envelope derived from an operator passphrase via PBKDF2-SHA256 (200k iters).
//
// Crypto is sourced exclusively from `globalThis.crypto.subtle` (WebCrypto in the
// Electron renderer). No new npm deps. No Node `crypto` module.

import { App, TFile, normalizePath } from "obsidian";
import { EntityService } from "../services/EntityService";
import { QueryService } from "../services/QueryService";
import type { V2Runtime } from "../v2-init";

export interface EncryptedBackupReport {
  path: string;
  bytes: number;
  encrypted: boolean;
}

interface EncryptedEnvelope {
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: "AES-256-GCM";
  iv: string;
  ciphertext: string;
}

const PBKDF2_ITERATIONS = 200_000;

function bytesToBase64(u: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]!); // i < u.length — bounds-checked
  return btoa(bin);
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export class EncryptedBackupService {
  constructor(
    public app: App,
    public entities: EntityService,
    public query: QueryService,
    public v2: V2Runtime | null,
  ) {}

  async runEncrypted(passphrase: string): Promise<EncryptedBackupReport> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const folder = this.entities.paths.backups;
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {
        /* ok */
      });
    }
    const path = normalizePath(`${folder}/sauce-backup-${stamp}.enc.json`);

    const people = this.entities.allPeople().map((e) => ({
      id: e.file.path,
      basename: e.file.basename,
      fm: e.frontmatter,
    }));
    const orgs = this.entities.allOrgs().map((e) => ({
      id: e.file.path,
      basename: e.file.basename,
      fm: e.frontmatter,
    }));
    const touches = this.entities.allTouches().map((e) => ({
      id: e.file.path,
      basename: e.file.basename,
      fm: e.frontmatter,
    }));
    const addenda = this.entities.allAddenda().map((e) => ({
      id: e.file.path,
      basename: e.file.basename,
      fm: e.frontmatter,
    }));
    const adjacency = this.query.collectAdjacency();

    const payload = {
      version: 1,
      generatedAt: stamp,
      people,
      orgs,
      touches,
      addenda,
      adjacency,
    };
    const plaintext = JSON.stringify(payload);

    const subtle = globalThis.crypto.subtle;
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const ctBuf = await subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    );

    const envelope: EncryptedEnvelope = {
      version: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PBKDF2_ITERATIONS,
        salt: bytesToBase64(salt),
      },
      cipher: "AES-256-GCM",
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ctBuf)),
    };
    const content = JSON.stringify(envelope, null, 2);

    const ex = this.app.vault.getAbstractFileByPath(path);
    if (ex && ex instanceof TFile) await this.app.vault.modify(ex, content);
    else await this.app.vault.create(path, content);

    return { path, bytes: content.length, encrypted: true };
  }

  async decrypt(envelope: string, passphrase: string): Promise<string | null> {
    let env: EncryptedEnvelope;
    try {
      env = JSON.parse(envelope) as EncryptedEnvelope;
    } catch {
      return null;
    }
    if (
      !env ||
      env.version !== 1 ||
      env.cipher !== "AES-256-GCM" ||
      !env.kdf ||
      !env.iv ||
      !env.ciphertext
    ) {
      return null;
    }
    try {
      const salt = base64ToBytes(env.kdf.salt);
      const iv = base64ToBytes(env.iv);
      const ct = base64ToBytes(env.ciphertext);
      const key = await deriveKey(passphrase, salt);
      const ptBuf = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ct,
      );
      return new TextDecoder().decode(ptBuf);
    } catch {
      return null;
    }
  }
}
