// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceSecretStore } from "../../src/backend/lance/LanceSecretStore";
import type { EncryptedSecret } from "../../src/security/KeyVault";

function secret(service: string, byte: number, rotated: number | null = null): EncryptedSecret {
  return {
    service,
    ciphertext: new Uint8Array([byte, byte + 1, byte + 2, 0, 255]),
    nonce: new Uint8Array([1, 2, 3]),
    kdfSalt: new Uint8Array([9, 8, 7, 6]),
    kdfIters: 200_000,
    createdTs: 1_700_000_000_000,
    rotatedTs: rotated,
  };
}

describe("LanceSecretStore", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("round-trips an encrypted secret byte-for-byte", async () => {
    h = await tmpLance();
    const store = new LanceSecretStore(await h.table(TABLES.apiKeysEnc));
    await store.put("openai", secret("openai", 10));

    const got = await store.get("openai");
    expect(got).not.toBeNull();
    expect(Array.from(got!.ciphertext)).toEqual([10, 11, 12, 0, 255]);
    expect(Array.from(got!.nonce)).toEqual([1, 2, 3]);
    expect(Array.from(got!.kdfSalt)).toEqual([9, 8, 7, 6]);
    expect(got!.kdfIters).toBe(200_000);
    expect(got!.rotatedTs).toBeNull();
  });

  it("upserts (mergeInsert) rather than duplicating on re-put", async () => {
    h = await tmpLance();
    const store = new LanceSecretStore(await h.table(TABLES.apiKeysEnc));
    await store.put("anthropic", secret("anthropic", 1));
    await store.put("anthropic", secret("anthropic", 50, 1_700_000_999_000));

    expect(await store.list()).toEqual(["anthropic"]);
    const got = await store.get("anthropic");
    expect(Array.from(got!.ciphertext)).toEqual([50, 51, 52, 0, 255]);
    expect(got!.rotatedTs).toBe(1_700_000_999_000);
  });

  it("lists sorted services and removes by key", async () => {
    h = await tmpLance();
    const store = new LanceSecretStore(await h.table(TABLES.apiKeysEnc));
    await store.put("zeta", secret("zeta", 1));
    await store.put("alpha", secret("alpha", 2));
    expect(await store.list()).toEqual(["alpha", "zeta"]);

    await store.remove("alpha");
    expect(await store.list()).toEqual(["zeta"]);
    expect(await store.get("alpha")).toBeNull();
  });
});
