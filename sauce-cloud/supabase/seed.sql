-- seed.sql — plans + model catalog (µ-credits). Tune amounts/prices later.
insert into public.plans (id, name, monthly_credits, price_cents, stripe_price_id, tier_rank, features) values
  ('free', 'Free',   2000000000,        0, null,                0, '{"hosted_memory": false}'),
  ('plus', 'Plus',   250000000000,   1900, 'price_PLACEHOLDER_PLUS', 1, '{"hosted_memory": true}'),
  ('pro',  'Pro',  1500000000000,   4900, 'price_PLACEHOLDER_PRO',  2, '{"hosted_memory": true}')
on conflict (id) do nothing;
insert into public.model_catalog (id, provider, display_name, credit_per_1k_input, credit_per_1k_output, min_tier_rank, enabled) values
  ('anthropic/claude-haiku-4-5-20251001', 'anthropic', 'Claude Haiku 4.5', 800000,   4000000,  0, true),
  ('openai/gpt-4o-mini',                  'openai',    'GPT-4o mini',      150000,    600000,  0, true),
  ('anthropic/claude-sonnet-4-6',         'anthropic', 'Claude Sonnet 4.6', 3000000, 15000000, 1, true),
  ('openai/gpt-4o',                       'openai',    'GPT-4o',           2500000, 10000000,  1, true),
  ('anthropic/claude-opus-4-7',           'anthropic', 'Claude Opus 4.7', 15000000, 75000000,  2, true)
on conflict (id) do nothing;
