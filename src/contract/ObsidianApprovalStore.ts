// Concrete ApprovalStore that persists decisions in the plugin's
// settings via the Plugin.saveData() round-trip. Reads/writes are
// passed through a small accessor so the gate doesn't need a direct
// reference to the plugin class (and tests can swap it freely).

import type { ApprovalRecord, ApprovalStore } from "./ApprovalGate";

export interface ApprovalSettingsAccessor {
  read(): ApprovalRecord;
  write(r: ApprovalRecord): Promise<void>;
}

export class ObsidianApprovalStore implements ApprovalStore {
  constructor(private readonly accessor: ApprovalSettingsAccessor) {}

  async read(): Promise<ApprovalRecord> {
    return this.accessor.read();
  }

  async write(r: ApprovalRecord): Promise<void> {
    await this.accessor.write(r);
  }
}
