// TEST-ONLY credential source — reads from process.env. Never imported by src/*.
// Used by the live-creds e2e harness to feed real keys into providers via the same
// CredentialSource surface that production uses (so the test exercises identical code paths).
import type { CredentialSource } from "../src/copilot/CredentialSource";

export class EnvCredentialSource implements CredentialSource {
  readonly label = "env(test-only)";
  constructor(
    private readonly env: Record<string, string | undefined>,
    private readonly map: Record<string, string>,
  ) {}
  available(): boolean {
    return Object.keys(this.map).length > 0;
  }
  async get(service: string): Promise<string | null> {
    const envKey = this.map[service];
    if (!envKey) return null;
    return this.env[envKey] ?? null;
  }
  async put(_service: string, _value: string): Promise<void> {
    throw new Error(
      "EnvCredentialSource is read-only; production writes must use KeyVaultCredentialSource",
    );
  }
  async clear(_service: string): Promise<void> {
    throw new Error("EnvCredentialSource is read-only");
  }
}
