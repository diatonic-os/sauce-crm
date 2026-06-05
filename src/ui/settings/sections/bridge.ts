import { Setting, Notice, Platform } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { generatePairingToken } from "../../../bridge/auth";
import { discoverTailscaleAddress } from "../../../bridge/server/Tailscale";
import {
  makeDaemonFetch,
  probeDaemon,
  DAEMON_DEFAULT_PORT,
} from "../../../services/DaemonClient";

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
    renderDaemon(containerEl, plugin);
  }
}

/** Settings block: sauce-crm-daemon. Desktop-only. When enabled and the daemon
 *  answers /health, the plugin uses the daemon's Lance store remotely and skips
 *  local Lance init (single-writer rule). A reload is required for an enable/
 *  disable to re-run the boot path cleanly. */
function renderDaemon(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  const s = plugin.settings;
  if (!s.daemon) {
    s.daemon = { enabled: false, port: DAEMON_DEFAULT_PORT, pairingToken: "" };
  }
  const d = s.daemon;

  containerEl.createEl("h3", { text: "Local daemon" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Offload the LanceDB store to a loopback sauce-crm-daemon process " +
      "(127.0.0.1). When enabled and the daemon is running, this plugin talks " +
      "to it over a signed local connection and does NOT open the store itself " +
      "(single-writer). Enabling or disabling takes effect on next reload.",
  });

  new Setting(containerEl)
    .setName("Use local daemon")
    .setDesc(
      d.enabled
        ? plugin.daemonBackend
          ? "Enabled and connected. The daemon owns the Lance store this session."
          : "Enabled, but the daemon was not reachable at load. Reload after starting it."
        : "Disabled. The plugin opens the LanceDB store directly.",
    )
    .addToggle((t) =>
      t.setValue(!!d.enabled).onChange(async (v) => {
        d.enabled = v;
        await plugin.saveSettings();
        new Notice(
          "Reload Obsidian for the local-daemon change to take effect.",
        );
        plugin.app.workspace.trigger("sauce:settings-rerender");
      }),
    );

  new Setting(containerEl)
    .setName("Port")
    .setDesc("Loopback TCP port the daemon listens on (default 8788).")
    .addText((t) =>
      t.setValue(String(d.port ?? DAEMON_DEFAULT_PORT)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0 && n < 65536) {
          d.port = n;
          await plugin.saveSettings();
        }
      }),
    );

  new Setting(containerEl)
    .setName("Pairing token")
    .setDesc(
      d.pairingToken
        ? `Set (…${d.pairingToken.slice(-6)}). Must match the daemon's config token.`
        : "Not set. Paste the daemon's token, or generate one and set it in the daemon config.",
    )
    .addText((t) =>
      t
        .setPlaceholder("paste daemon token")
        .setValue(d.pairingToken ?? "")
        .onChange(async (v) => {
          d.pairingToken = v.trim();
          await plugin.saveSettings();
        }),
    )
    .addButton((btn) =>
      btn.setButtonText("Generate").onClick(async () => {
        d.pairingToken = generatePairingToken();
        await plugin.saveSettings();
        new Notice(
          "New daemon token generated. Put the SAME token in the daemon config, then reload.",
        );
        plugin.app.workspace.trigger("sauce:settings-rerender");
      }),
    );

  // Live status row: probe /health and render version / uptime / lance dim.
  const statusSetting = new Setting(containerEl)
    .setName("Status")
    .setDesc("Probing…")
    .addButton((btn) =>
      btn.setButtonText("Reconnect").onClick(async () => {
        await plugin.reconnectDaemon();
        plugin.app.workspace.trigger("sauce:settings-rerender");
      }),
    );
  void probeDaemon(makeDaemonFetch(), { port: d.port }).then((h) => {
    if (!h) {
      statusSetting.setDesc(
        d.enabled
          ? "Daemon not reachable on this port."
          : "Daemon not reachable (and integration is disabled).",
      );
      return;
    }
    const lance = h.lance.available
      ? `lance ready (dim ${h.lance.dim})`
      : "lance warming";
    const upS = Math.round(h.uptimeMs / 1000);
    statusSetting.setDesc(
      `Connected — v${h.version}, pid ${h.pid}, up ${upS}s, ${lance}.`,
    );
  });
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
