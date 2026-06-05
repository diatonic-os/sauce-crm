import { describe, expect, it } from "vitest";
import {
  NotionIntegration,
  type NotionIntegrationHost,
} from "../../src/integrations/notion";
import type { FetchHost } from "../../src/integrations/notion/NotionClient";
import type { ScopeRegistry } from "../../src/security/ScopeRegistry";
import type { ProxyClient } from "../../src/security/ProxyClient";

const scopes = { require: () => {} } as unknown as ScopeRegistry;
const proxy = {} as unknown as ProxyClient;

// Fake fetch returning a single database-query page batch with two title-bearing
// pages and no further cursor.
function fakeFetch(): FetchHost {
  return {
    async fetch(_url, _init) {
      const body = JSON.stringify({
        results: [
          {
            id: "p1",
            object: "page",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Acme Corp" }],
              },
            },
          },
          {
            id: "p2",
            object: "page",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Globex" }],
              },
            },
          },
        ],
        next_cursor: null,
      });
      return { status: 200, headers: {}, body };
    },
  };
}

describe("NotionIntegration — pageTitle surfacing", () => {
  it("surfaces pulled page titles through onPagesDiscovered", async () => {
    const discovered: string[] = [];
    const host: NotionIntegrationHost = {
      scopes,
      proxy,
      fetch: fakeFetch(),
      token: async () => "secret",
      onPagesDiscovered: (titles) => discovered.push(...titles),
    };
    const integ = new NotionIntegration(host);

    const r = await integ.syncResource("database:db123");
    expect(r.pulled).toBe(2);
    expect(r.errors).toBe(0);
    expect(discovered).toEqual(["Acme Corp", "Globex"]);
  });

  it("counts pages even without an onPagesDiscovered hook", async () => {
    const host: NotionIntegrationHost = {
      scopes,
      proxy,
      fetch: fakeFetch(),
      token: async () => "secret",
    };
    const integ = new NotionIntegration(host);
    const r = await integ.syncResource("database:db123");
    expect(r.pulled).toBe(2);
  });
});
