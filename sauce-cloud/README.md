Sauce Cloud control plane. `npm install && npm run db:start`, then export the keys printed by `supabase status -o env` (SUPABASE_URL/ANON/SERVICE_ROLE), then `npm test`. Migrations in `supabase/migrations/`, seed in `supabase/seed.sql`. Run `npm run db:reset` between full test runs for a clean ledger.

## Running tests

```bash
export $(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')
npm test
```
