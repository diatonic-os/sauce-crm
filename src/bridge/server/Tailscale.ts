// MOB-BRIDGE-001 · W2 — Tailscale address auto-discovery (DESKTOP ONLY).
// Lazy node import so this file is safe to *load* in the bundle on any platform;
// it only does work when called on desktop. Returns the host's Tailscale IPv4
// (CGNAT range 100.64.0.0/10) to bind the server to, so the memory server is
// reachable from the paired phone but NOT on the LAN/Internet.
//
// We read os.networkInterfaces() only — no subprocess. When Tailscale is up its
// interface (tailscale0 / utun*) carries the 100.64/10 address, so this is
// sufficient and avoids spawning anything. The operator can override the bind
// address in settings if discovery comes up empty.

/** True iff `ip` is in the Tailscale CGNAT range 100.64.0.0/10. */
export function isTailscaleCgnat(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127;
}

/** Pick the first Tailscale-range IPv4 from a map of interface → addresses
 *  (the shape of os.networkInterfaces()). Pure, for testability. */
export function pickTailscaleAddress(
  ifaces: Record<string, Array<{ family?: string | number; address?: string; internal?: boolean }> | undefined>,
): string | null {
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      const fam = a.family;
      const isV4 = fam === "IPv4" || fam === 4;
      if (isV4 && !a.internal && a.address && isTailscaleCgnat(a.address)) {
        return a.address;
      }
    }
  }
  return null;
}

/** Discover this host's Tailscale IPv4 from network interfaces. Returns null on
 *  mobile (no Node) or when Tailscale isn't up. Never throws. */
export async function discoverTailscaleAddress(): Promise<string | null> {
  if (typeof process === "undefined") return null; // mobile — can't bind anyway
  try {
    const os = require("os") as typeof import("node:os");
    return pickTailscaleAddress(
      os.networkInterfaces() as Parameters<typeof pickTailscaleAddress>[0],
    );
  } catch {
    return null;
  }
}
