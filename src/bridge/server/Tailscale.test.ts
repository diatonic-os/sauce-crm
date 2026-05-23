import { describe, it, expect } from "vitest";
import { isTailscaleCgnat, pickTailscaleAddress } from "./Tailscale";

describe("isTailscaleCgnat", () => {
  it("accepts addresses in 100.64.0.0/10", () => {
    expect(isTailscaleCgnat("100.64.0.1")).toBe(true);
    expect(isTailscaleCgnat("100.100.50.7")).toBe(true);
    expect(isTailscaleCgnat("100.127.255.254")).toBe(true);
  });
  it("rejects addresses outside the range", () => {
    expect(isTailscaleCgnat("100.63.0.1")).toBe(false); // below
    expect(isTailscaleCgnat("100.128.0.1")).toBe(false); // above
    expect(isTailscaleCgnat("192.168.1.1")).toBe(false);
    expect(isTailscaleCgnat("10.0.0.1")).toBe(false);
    expect(isTailscaleCgnat("not-an-ip")).toBe(false);
  });
});

describe("pickTailscaleAddress", () => {
  it("finds the external IPv4 Tailscale address", () => {
    const ifaces = {
      lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
      eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
      tailscale0: [{ family: "IPv4", address: "100.101.102.103", internal: false }],
    };
    expect(pickTailscaleAddress(ifaces)).toBe("100.101.102.103");
  });
  it("accepts numeric family (older node) and skips internal", () => {
    const ifaces = {
      tailscale0: [{ family: 4, address: "100.64.1.2", internal: false }],
    };
    expect(pickTailscaleAddress(ifaces)).toBe("100.64.1.2");
  });
  it("returns null when no Tailscale address present", () => {
    const ifaces = {
      eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
    };
    expect(pickTailscaleAddress(ifaces)).toBeNull();
  });
});
