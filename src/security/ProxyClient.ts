// SPEC §18.4 — Signed-egress relay. HMAC-SHA256(secret, METHOD || URL || ts || body_hash).
export interface ProxyConfig {
  enabled: boolean;
  baseUrl: string;
  sharedSecret: string;
}

export interface ProxyHost {
  hmacHex(key: string, msg: string): Promise<string>;
  sha256Hex(msg: string): Promise<string>;
  fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export class ProxyClient {
  constructor(
    private readonly host: ProxyHost,
    private cfg: ProxyConfig,
  ) {}

  setConfig(cfg: ProxyConfig): void {
    this.cfg = cfg;
  }
  isEnabled(): boolean {
    return this.cfg.enabled && !!this.cfg.baseUrl && !!this.cfg.sharedSecret;
  }

  async fetch(
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> {
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ?? "";
    if (!this.isEnabled()) {
      return this.host.fetch(url, {
        method,
        headers: init.headers ?? {},
        body: body || undefined,
      });
    }
    const ts = String(Date.now());
    const bodyHash = await this.host.sha256Hex(body);
    const sig = await this.host.hmacHex(
      this.cfg.sharedSecret,
      `${method}|${url}|${ts}|${bodyHash}`,
    );
    const headers: Record<string, string> = {
      ...(init.headers ?? {}),
      "X-Sauce-Target": url,
      "X-Sauce-Timestamp": ts,
      "X-Sauce-Signature": sig,
    };
    return this.host.fetch(this.cfg.baseUrl, {
      method,
      headers,
      body: body || undefined,
    });
  }
}
