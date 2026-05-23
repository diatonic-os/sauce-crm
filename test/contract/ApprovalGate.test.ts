import { describe, expect, it } from "vitest";
import {
  ApprovalGate,
  AutoApproveUI,
  AutoDenyUI,
  MemoryApprovalStore,
  type ApprovalRequest,
  type ApprovalUI,
  type ApprovalVerdict,
} from "../../src/contract/ApprovalGate";

class ScriptedUI implements ApprovalUI {
  constructor(private readonly answers: ApprovalVerdict[]) {}
  private ix = 0;
  prompts: ApprovalRequest[] = [];
  async prompt(req: ApprovalRequest): Promise<ApprovalVerdict> {
    this.prompts.push(req);
    const a = this.answers[this.ix++] ?? "deny-once";
    return a;
  }
}

const REQ_EDIT: ApprovalRequest = {
  actionClass: "edit-file",
  summary: "Modify plugin/src/foo.ts",
  details: "diff: +5 lines",
  risk: "low",
};

describe("ApprovalGate — single-shot verdicts", () => {
  it("approve-once → approved=true, no sticky decision persisted", async () => {
    const store = new MemoryApprovalStore();
    const ui = new ScriptedUI(["approve-once"]);
    const gate = new ApprovalGate(store, ui);
    const r = await gate.ask(REQ_EDIT);
    expect(r.approved).toBe(true);
    expect(r.verdict).toBe("approve-once");
    const rec = await store.read();
    expect(rec.decisions["edit-file"]).toBeUndefined();
  });

  it("deny-once → approved=false, no sticky decision persisted", async () => {
    const store = new MemoryApprovalStore();
    const ui = new ScriptedUI(["deny-once"]);
    const gate = new ApprovalGate(store, ui);
    const r = await gate.ask(REQ_EDIT);
    expect(r.approved).toBe(false);
    expect((await store.read()).decisions["edit-file"]).toBeUndefined();
  });
});

describe("ApprovalGate — sticky decisions", () => {
  it("approve-always → first call prompts and persists, subsequent calls skip prompt", async () => {
    const store = new MemoryApprovalStore();
    const ui = new ScriptedUI(["approve-always"]);
    const gate = new ApprovalGate(store, ui);

    const r1 = await gate.ask(REQ_EDIT);
    expect(r1.approved).toBe(true);
    expect((await store.read()).decisions["edit-file"]).toBe("approve-always");

    // Second call must NOT prompt.
    const r2 = await gate.ask(REQ_EDIT);
    expect(r2.approved).toBe(true);
    expect(r2.verdict).toBe("approve-always");
    expect(ui.prompts.length).toBe(1);
  });

  it("deny-always → persists and blocks all future calls of the same class", async () => {
    const store = new MemoryApprovalStore();
    const ui = new ScriptedUI(["deny-always"]);
    const gate = new ApprovalGate(store, ui);

    const r1 = await gate.ask(REQ_EDIT);
    expect(r1.approved).toBe(false);
    const r2 = await gate.ask(REQ_EDIT);
    expect(r2.approved).toBe(false);
    expect(ui.prompts.length).toBe(1);
  });

  it("clear() revokes a sticky decision and re-prompts on next call", async () => {
    const store = new MemoryApprovalStore();
    const ui = new ScriptedUI(["approve-always", "deny-once"]);
    const gate = new ApprovalGate(store, ui);

    await gate.ask(REQ_EDIT);
    expect(ui.prompts.length).toBe(1);
    await gate.clear("edit-file");
    expect((await store.read()).decisions["edit-file"]).toBeUndefined();
    const r = await gate.ask(REQ_EDIT);
    expect(ui.prompts.length).toBe(2);
    expect(r.approved).toBe(false);
  });

  it("different action classes have independent sticky decisions", async () => {
    const store = new MemoryApprovalStore();
    const ui = new ScriptedUI(["approve-always", "deny-always"]);
    const gate = new ApprovalGate(store, ui);
    const r1 = await gate.ask({ ...REQ_EDIT, actionClass: "edit-file" });
    const r2 = await gate.ask({ ...REQ_EDIT, actionClass: "spawn-process" });
    expect(r1.approved).toBe(true);
    expect(r2.approved).toBe(false);
    const rec = await store.read();
    expect(rec.decisions["edit-file"]).toBe("approve-always");
    expect(rec.decisions["spawn-process"]).toBe("deny-always");
  });
});

describe("ApprovalGate — convenience UIs for tests", () => {
  it("AutoApproveUI never blocks", async () => {
    const gate = new ApprovalGate(new MemoryApprovalStore(), new AutoApproveUI());
    expect((await gate.ask(REQ_EDIT)).approved).toBe(true);
  });

  it("AutoDenyUI always blocks", async () => {
    const gate = new ApprovalGate(new MemoryApprovalStore(), new AutoDenyUI());
    expect((await gate.ask(REQ_EDIT)).approved).toBe(false);
  });
});
