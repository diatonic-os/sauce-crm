import { describe, expect, it } from "vitest";
import { makeUser, service } from "./_helpers";
async function setBalance(id: string, bal: number) {
  await service().from("credit_balances").update({ balance: bal }).eq("account_id", id);
}
async function getBalance(id: string): Promise<number> {
  const { data } = await service().from("credit_balances").select("balance").eq("account_id", id).single();
  return data!.balance;
}
describe("credit RPCs", () => {
  it("reserve then commit charges the ACTUAL amount and refunds the estimate diff", async () => {
    const u = await makeUser(); await setBalance(u.id, 1000);
    const svc = service();
    const { data: resId } = await svc.rpc("reserve_credits", { p_account: u.id, p_estimate: 400 });
    expect(resId).toBeTruthy();
    expect(await getBalance(u.id)).toBe(600);
    await svc.rpc("commit_usage", { p_reservation: resId, p_account: u.id, p_actual: 250, p_model: "openai/gpt-4o-mini", p_input: 100, p_output: 50, p_request_id: "req-1" });
    expect(await getBalance(u.id)).toBe(750);
    const { count } = await svc.from("usage_events").select("*", { count: "exact", head: true }).eq("account_id", u.id);
    expect(count).toBe(1);
  });
  it("reserve returns null (paywall) when balance is insufficient and does NOT decrement", async () => {
    const u = await makeUser(); await setBalance(u.id, 100);
    const { data: resId } = await service().rpc("reserve_credits", { p_account: u.id, p_estimate: 500 });
    expect(resId).toBeNull();
    expect(await getBalance(u.id)).toBe(100);
  });
  it("release refunds a held reservation in full", async () => {
    const u = await makeUser(); await setBalance(u.id, 1000);
    const svc = service();
    const { data: resId } = await svc.rpc("reserve_credits", { p_account: u.id, p_estimate: 300 });
    await svc.rpc("release_reservation", { p_reservation: resId, p_account: u.id });
    expect(await getBalance(u.id)).toBe(1000);
  });
  it("concurrent reserves never overspend (only as many as the balance allows succeed)", async () => {
    const u = await makeUser(); await setBalance(u.id, 1000);
    const svc = service();
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.rpc("reserve_credits", { p_account: u.id, p_estimate: 200 })));
    const ok = results.filter((r) => r.data != null).length;
    expect(ok).toBe(5);
    expect(await getBalance(u.id)).toBe(0);
  });
  it("grant_monthly_credits is idempotent per period (reset-to-allotment)", async () => {
    const u = await makeUser("plus"); await setBalance(u.id, 5);
    const svc = service();
    await svc.rpc("grant_monthly_credits", { p_account: u.id, p_plan: "plus", p_period: "2026-05" });
    const after1 = await getBalance(u.id);
    await svc.rpc("grant_monthly_credits", { p_account: u.id, p_plan: "plus", p_period: "2026-05" });
    const after2 = await getBalance(u.id);
    expect(after1).toBe(250000000000);
    expect(after2).toBe(after1);
  });

  it("commit_usage is single-shot — a duplicate commit does not double-refund", async () => {
    const u = await makeUser(); await setBalance(u.id, 1000);
    const svc = service();
    const { data: resId } = await svc.rpc("reserve_credits", { p_account: u.id, p_estimate: 400 });
    const args = { p_reservation: resId, p_account: u.id, p_actual: 250, p_model: "openai/gpt-4o-mini", p_input: 1, p_output: 1, p_request_id: "r" };
    await svc.rpc("commit_usage", args);
    await svc.rpc("commit_usage", args);            // duplicate must be a no-op
    expect(await getBalance(u.id)).toBe(750);        // charged once (not 900)
  });

  it("release after commit is a no-op (no double refund)", async () => {
    const u = await makeUser(); await setBalance(u.id, 1000);
    const svc = service();
    const { data: resId } = await svc.rpc("reserve_credits", { p_account: u.id, p_estimate: 400 });
    await svc.rpc("commit_usage", { p_reservation: resId, p_account: u.id, p_actual: 250, p_model: "m", p_input: 1, p_output: 1, p_request_id: "r" });
    await svc.rpc("release_reservation", { p_reservation: resId, p_account: u.id });
    expect(await getBalance(u.id)).toBe(750);        // not 1150
  });

  it("commit_usage rejects a reservation not owned by the account", async () => {
    const a = await makeUser(); const b = await makeUser();
    await setBalance(a.id, 1000);
    const svc = service();
    const { data: resId } = await svc.rpc("reserve_credits", { p_account: a.id, p_estimate: 100 });
    const { error } = await svc.rpc("commit_usage", { p_reservation: resId, p_account: b.id, p_actual: 50, p_model: "m", p_input: 1, p_output: 1, p_request_id: "r" });
    expect(error).toBeTruthy();                       // unknown reservation for b
    expect(await getBalance(a.id)).toBe(900);         // a's hold untouched
  });
});
