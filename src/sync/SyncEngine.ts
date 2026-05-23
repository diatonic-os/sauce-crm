// SPEC §34.1 — Glue: integrations + scheduler + conflict resolver + change feed.
import type { IIntegration, SyncResource } from "../integrations/IIntegration";
import { Scheduler, type ScheduledJob } from "./Scheduler";
import { ChangeFeed } from "./ChangeFeed";

export class SyncEngine {
  readonly scheduler = new Scheduler();
  readonly changes = new ChangeFeed();
  private integrations = new Map<string, IIntegration>();

  register(integration: IIntegration): void {
    this.integrations.set(integration.id, integration);
  }
  list(): IIntegration[] {
    return [...this.integrations.values()];
  }

  async wireResources(integrationId: string): Promise<void> {
    const i = this.integrations.get(integrationId);
    if (!i) throw new Error(`no integration: ${integrationId}`);
    const resources = await i.listResources();
    for (const r of resources) {
      const job: ScheduledJob = {
        id: `${integrationId}::${r.id}`,
        integration: integrationId,
        resource: r.id,
        frequency: r.frequency,
        run: async () => {
          const res = await i.syncResource(r.id);
          this.changes.emit({
            ts: Date.now(),
            kind: "integration-pull",
            integration: integrationId,
            resource: r.id,
            entityId: r.id,
            meta: res,
          });
        },
      };
      this.scheduler.add(job);
    }
  }

  start(): void {
    this.scheduler.start();
  }
  stop(): void {
    this.scheduler.stop();
  }
}
