// Desktop-Obsidian OAuth host adapter. Implements OAuthHost from OAuthFlow.ts
// using Electron's `shell.openExternal` to launch the user's browser and Node's
// built-in `http` module to bind an ephemeral loopback port for the redirect.
//
// Gated by isDesktopOnly: true in manifest.json — Node http isn't available on
// mobile Obsidian, so this file should never be imported on mobile builds.

import { requestUrl } from "obsidian";
import type { OAuthHost } from "./OAuthFlow";

interface ElectronShell {
  openExternal(url: string): Promise<void> | void;
}
interface NodeHttpServer {
  listen(port: number, host: string, cb?: () => void): unknown;
  close(cb?: () => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
}
interface NodeHttpRequest {
  url?: string;
}
interface NodeHttpResponse {
  writeHead(s: number, h?: Record<string, string>): void;
  end(b?: string): void;
}
interface NodeHttp {
  createServer(
    handler: (req: NodeHttpRequest, res: NodeHttpResponse) => void,
  ): NodeHttpServer;
}

function resolveElectronShell(): ElectronShell | null {
  // Obsidian desktop exposes `require` — but only on desktop. Mobile throws.
  try {
    const req = (window as unknown as { require?: (m: string) => unknown })
      .require;
    if (!req) return null;
    const electron = req("electron") as { shell?: ElectronShell };
    return electron.shell ?? null;
  } catch {
    return null;
  }
}

function resolveNodeHttp(): NodeHttp | null {
  try {
    const req = (window as unknown as { require?: (m: string) => unknown })
      .require;
    if (!req) return null;
    return req("http") as NodeHttp;
  } catch {
    return null;
  }
}

export class ObsidianOAuthHost implements OAuthHost {
  private readonly shell = resolveElectronShell();
  private readonly http = resolveNodeHttp();

  /** True iff this host can run a real OAuth flow (desktop Obsidian). */
  available(): boolean {
    return !!this.shell && !!this.http;
  }

  async openBrowser(url: string): Promise<void> {
    if (!this.shell)
      throw new Error(
        "OAuth requires desktop Obsidian (Electron shell unavailable)",
      );
    await this.shell.openExternal(url);
  }

  async listenOnce(port: number, path: string): Promise<URL> {
    if (!this.http)
      throw new Error(
        "OAuth requires desktop Obsidian (node:http unavailable)",
      );
    return new Promise<URL>((resolve, reject) => {
      const server = this.http!.createServer((req, res) => {
        try {
          const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
          if (url.pathname !== path) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("not the callback path");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html><meta charset="utf-8"><title>Sauce CRM — connected</title>
<style>body{font:14px/1.4 system-ui;margin:3rem auto;max-width:32rem;text-align:center}h1{font-weight:600}</style>
<h1>Connected — you can close this tab.</h1>
<p>Sauce CRM received the authorization code. The plugin will finish the token exchange.</p>`);
          server.close();
          resolve(url);
        } catch (e) {
          try {
            res.writeHead(500);
            res.end("internal");
          } catch {
            /* ignore */
          }
          reject(e);
        }
      });
      server.on("error", (err) => reject(err));
      server.listen(port, "127.0.0.1", () => {
        /* listening */
      });
      // 5-minute hard timeout
      setTimeout(() => {
        try {
          server.close();
        } catch {
          /* ignore */
        }
        reject(new Error("OAuth timeout (5 min)"));
      }, 5 * 60_000);
    });
  }

  async fetchJson<T>(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<T> {
    const r = await requestUrl({
      url,
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: init?.body,
      throw: false,
    });
    if (r.status >= 400)
      throw new Error(
        `OAuth ${url} failed: ${r.status} ${r.text.slice(0, 200)}`,
      );
    return JSON.parse(r.text) as T;
  }
}
