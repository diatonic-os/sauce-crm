import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import { IntegrationRegistry } from "../../src/integrations/IntegrationRegistry";
import type {
  SmtpImapHost,
  ImapCredentials,
  SmtpCredentials,
} from "../../src/integrations/smtpimap/types";

// A fake socket bridge — records calls and returns canned data. The registry
// never opens real sockets; it only stores/exposes this host as the injection
// point named by UnconfiguredSmtpImapHost's error message.
function fakeSmtpImapHost(): SmtpImapHost & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    async imapListMailboxes() {
      return ["INBOX", "Sent"];
    },
    async imapList() {
      return [
        { uid: 1, mailbox: "INBOX", subject: "hi", from: "a@b.com" },
        { uid: 2, mailbox: "INBOX", subject: "yo", from: "c@d.com" },
      ];
    },
    async imapFetchBody() {
      return { raw: "raw-body" };
    },
    async smtpSend(_creds, msg) {
      sent.push(msg);
      return { accepted: msg.to, messageId: "<mid@test>" };
    },
  };
}

describe("IntegrationRegistry — smtp_imap registration", () => {
  it("exposes smtp_imap via byId(), list(), and resourcesFor()", () => {
    const reg = new IntegrationRegistry(new App(), {});

    const integ = reg.byId("smtp_imap");
    expect(integ).not.toBeNull();
    expect(integ!.id).toBe("smtp_imap");

    expect(reg.list().map((i) => i.id)).toContain("smtp_imap");

    const resources = reg.resourcesFor("smtp_imap");
    expect(resources.map((r) => r.id)).toEqual(["inbox", "sent"]);
    // Defaults are disabled until the user opts in, matching peer integrations.
    expect(resources.every((r) => !r.enabled)).toBe(true);
  });

  it("stores an injected socket bridge from tokens and via setSmtpImapHost()", () => {
    const bridge = fakeSmtpImapHost();
    const reg = new IntegrationRegistry(new App(), {
      smtpImapBridge: bridge,
    });
    expect(reg.getSmtpImapHost()).toBe(bridge);

    const reg2 = new IntegrationRegistry(new App(), {});
    expect(reg2.getSmtpImapHost()).toBeNull();
    const ret = reg2.setSmtpImapHost(bridge);
    expect(ret).toBe(reg2); // chainable
    expect(reg2.getSmtpImapHost()).toBe(bridge);
  });

  it("derives an SmtpImapAccount from imap/smtp credential resolvers", async () => {
    const imap: ImapCredentials = {
      host: "imap.example.com",
      port: 993,
      username: "you@example.com",
      password: "app-pw",
      tls: true,
    };
    const smtp: SmtpCredentials = {
      host: "smtp.example.com",
      port: 465,
      username: "you@example.com",
      password: "app-pw",
      tls: true,
    };
    const reg = new IntegrationRegistry(new App(), {
      imap: async () => imap,
      smtp: async () => smtp,
    });

    const account = await reg.loadSmtpImapAccount("drew");
    expect(account).not.toBeNull();
    expect(account!.id).toBe("drew");
    expect(account!.imapHost).toBe("imap.example.com");
    expect(account!.imapPort).toBe(993);
    expect(account!.smtpHost).toBe("smtp.example.com");
    expect(account!.smtpPort).toBe(465);
    expect(account!.username).toBe("you@example.com");

    expect(reg.smtpImap!.listAccounts().map((a) => a.id)).toContain("drew");
  });

  it("loadSmtpImapAccount is a no-op when no credential resolvers configured", async () => {
    const reg = new IntegrationRegistry(new App(), {});
    expect(await reg.loadSmtpImapAccount()).toBeNull();
    expect(reg.smtpImap!.listAccounts()).toHaveLength(0);
  });

  it("syncResource round-trips against the integration (stub returns zeroed counts)", async () => {
    const reg = new IntegrationRegistry(new App(), {});
    const integ = reg.byId("smtp_imap")!;
    const r = await integ.syncResource("inbox");
    expect(r).toEqual({ pulled: 0, pushed: 0, errors: 0 });
  });
});
