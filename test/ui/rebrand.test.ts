// CON-SAUCEBOT S10 — rebrand guard. User-facing strings must read "SauceBot",
// but the load-bearing internal identifiers (view type id, command id, KeyVault
// key prefix, CSS classes, storage folder) must NOT change — renaming those
// would break saved workspace layouts, hotkeys, stored secrets, and styles.

import { describe, expect, it } from "vitest";
import {
  CopilotChatView,
  VIEW_COPILOT_CHAT,
} from "../../src/ui/views/v2/CopilotChatView";
import { V2_COMMANDS } from "../../src/ui/commands/V2Commands";

describe("rebrand → SauceBot (user-facing strings)", () => {
  it("the chat view title reads 'Sauce: SauceBot'", () => {
    const title = (
      CopilotChatView.prototype as unknown as { getDisplayText(): string }
    ).getDisplayText.call({});
    expect(title).toBe("Sauce: SauceBot");
  });

  it("the open-copilot command is labelled 'Open SauceBot'", () => {
    const cmd = V2_COMMANDS.find((c) => c.id === "sauce:open-copilot");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("Open SauceBot");
  });
});

describe("rebrand MUST NOT touch persisted internal identifiers", () => {
  it("the view type id stays 'sauce-copilot-chat' (saved layouts)", () => {
    expect(VIEW_COPILOT_CHAT).toBe("sauce-copilot-chat");
  });

  it("the open-copilot command id is unchanged (hotkey bindings)", () => {
    expect(V2_COMMANDS.some((c) => c.id === "sauce:open-copilot")).toBe(true);
  });
});
