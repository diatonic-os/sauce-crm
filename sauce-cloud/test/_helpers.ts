import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// `supabase status -o env` emits API_URL / ANON_KEY / SERVICE_ROLE_KEY (CLI 2.84);
// accept SUPABASE_* fallbacks. Stack runs on remapped port 54521 — never hardcode 54321.
const URL = process.env.API_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54521";
const ANON = (process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY)!;
const SERVICE = (process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!;

export const service = (): SupabaseClient =>
  createClient(URL, SERVICE, { auth: { persistSession: false } });
export const anon = (): SupabaseClient =>
  createClient(URL, ANON, { auth: { persistSession: false } });

/** Create a confirmed auth user + its accounts + balance row; return {id, client}. */
export async function makeUser(plan = "free") {
  const svc = service();
  const email = `u${Date.now()}_${Math.random().toString(36).slice(2)}@test.local`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: "pw-123456", email_confirm: true });
  if (error) throw error;
  const id = data.user!.id;
  await svc.from("accounts").insert({ id, plan_id: plan });
  await svc.from("credit_balances").insert({ account_id: id, balance: 0 });
  const userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email, password: "pw-123456" });
  return { id, email, client: userClient };
}
