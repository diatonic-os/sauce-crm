import { describe, expect, it } from "vitest";
import { makeUser, service } from "./_helpers";
describe("RLS isolation", () => {
  it("a user reads only their own balance, never another's", async () => {
    const a = await makeUser(); const b = await makeUser();
    await service().from("credit_balances").update({ balance: 500 }).eq("account_id", a.id);
    await service().from("credit_balances").update({ balance: 999 }).eq("account_id", b.id);
    const { data } = await a.client.from("credit_balances").select("account_id,balance");
    expect(data).toHaveLength(1);
    expect(data![0].account_id).toBe(a.id);
    expect(data![0].balance).toBe(500);
  });
  it("a client cannot write the ledger directly (no insert grant)", async () => {
    const a = await makeUser();
    const { error } = await a.client.from("credit_ledger").insert({ account_id: a.id, kind: "grant", amount: 1000000 });
    expect(error).toBeTruthy();
  });
  it("plans + model_catalog are publicly readable", async () => {
    const a = await makeUser();
    const { data } = await a.client.from("model_catalog").select("id").eq("enabled", true);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("authenticated clients cannot execute the service-role credit RPCs", async () => {
    const u = await makeUser();
    const { error } = await u.client.rpc("reserve_credits", { p_account: u.id, p_estimate: 1 });
    expect(error).toBeTruthy();                       // execute revoked from authenticated
  });
});
