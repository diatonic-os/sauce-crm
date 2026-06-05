import { Setting, Notice, Platform } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { generatePairingToken } from "../../../bridge/auth";
import { discoverTailscaleAddress } from "../../../bridge/server/Tailscale";

/** Settings section: Mobile Bridge. Desktop runs the (default-OFF) memory
 *  server; mobile points at the paired desktop. The server only ever binds the
 *  Tailscale interface and requires a shared pairing token. */
export function renderBridge(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  plugin.logger?.debug?.("settings.section_render", { section: "bridge" });
  const s = plugin.settings;
  if (!s.bridge) {
    s.bridge = {
      enabled: false,
      port: 8787,
      bindHost: "",
      baseUrl: "",
      pairingToken: "",
    };
  }
  const b = s.bridge;

  containerEl.createEl("h3", { text: "Mobile Bridge" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Lets the Obsidian mobile app reach this desktop's LanceDB memory " +
      "(semantic search, recall, provenance) over your private Tailscale " +
      "network. The server is off by default, binds the Tailscale interface " +
      "only (never the LAN/Internet), and requires a shared pairing token.",
  });

  if (Platform.isMobile) {
    renderMobile(containerEl, plugin, b);
  } else {
    renderDesktop(containerEl, plugin, b);
  }
}

type Bridge = NonNullable<SauceGraphPlugin["settings"]["bridge"]>;

function renderDesktop(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
  b: Bridge,
): void {
  const status = plugin.bridgeService?.status();
  const statusText = !status
    ? "not initialized"
    : status.running
      ? `running on ${status.bindHost}:${status.port}`
      : `stopped (${status.reason}${status.detail ? `: ${status.detail}` : ""})`;

  new Setting(containerEl)
    .setName("Enable memory server")
    .setDesc(
      `Serve this desktop's memory to your paired phone. Status: ${statusText}`,
    )
    .addToggle((t) =>
      t.setValue(!!b.enabled).onChange(async (v) => {
        b.enabled = v;
        await plugin.saveSettings();
        await plugin.refreshBridge();
        plugin.app.workspace.trigger("sauce:settings-rerender");
      }),
    );

  new Setting(containerEl)
    .setName("Port")
    .setDesc("TCP port the server listens on (Tailscale interface only).")
    .addText((t) =>
      t.setValue(String(b.port ?? 8787)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0 && n < 65536) {
          b.port = n;
          await plugin.saveSettings();
          await plugin.refreshBridge();
        }
      }),
    );

  const bindSetting = new Setting(containerEl)
    .setName("Bind address")
    .setDesc("Leave blank to auto-discover your Tailscale IPv4.")
    .addText((t) =>
      t
        .setPlaceholder("auto-discover")
        .setValue(b.bindHost ?? "")
        .onChange(async (v) => {
          b.bindHost = v.trim();
          await plugin.saveSettings();
          await plugin.refreshBridge();
        }),
    );
  // Fill in the discovered address as a hint.
  void discoverTailscaleAddress().then((addr) => {
    if (addr)
      bindSetting.setDesc(
        `Leave blank to auto-discover. Detected Tailscale IP: ${addr}`,
      );
  });

  new Setting(containerEl)
    .setName("Pairing token")
    .setDesc(
      b.pairingToken
        ? `Set (…${b.pairingToken.slice(-6)}). Enter this token on your phone to pair.`
        : "Not set. Generate a token, then enter it on your phone.",
    )
    .addButton((btn) =>
      btn
        .setButtonText(b.pairingToken ? "Regenerate" : "Generate")
        .onClick(async () => {
          b.pairingToken = generatePairingToken();
          await plugin.saveSettings();
          await plugin.refreshBridge();
          new Notice(
            "New pairing token generated. Enter it on your phone to re-pair.",
          );
          plugin.app.workspace.trigger("sauce:settings-rerender");
        }),
    );
}

function renderMobile(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
  b: Bridge,
): void {
  new Setting(containerEl)
    .setName("Desktop bridge URL")
    .setDesc(
      "e.g. http://<desktop-tailscale-ip>:8787 — find it in the desktop's Mobile Bridge settings.",
    )
    .addText((t) =>
      t
        .setPlaceholder("http://100.x.y.z:8787")
        .setValue(b.baseUrl ?? "")
        .onChange(async (v) => {
          b.baseUrl = v.trim();
          await plugin.saveSettings();
          await plugin.refreshBridge();
        }),
    );

  new Setting(containerEl)
    .setName("Pairing token")
    .setDesc("Paste the token shown in the desktop's Mobile Bridge settings.")
    .addText((t) =>
      t.setValue(b.pairingToken ?? "").onChange(async (v) => {
        b.pairingToken = v.trim();
        await plugin.saveSettings();
        await plugin.refreshBridge();
      }),
    );
}
