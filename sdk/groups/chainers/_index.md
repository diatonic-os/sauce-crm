---
group: chainers
summary: Deterministic pipelines composing tools→actions with explicit, acyclic edges.
generated_from: composition of tools/ + helpers/
---

# chainers/ — deterministic pipelines

A chainer is a typed, acyclic pipeline: each stage names its input tool/helper
and output. Execution order is declared, not emergent. Chainers are where
looping, time-sync, and the embedding flow live — all driven by
`helpers/logical-clock`, never wall-clock.

## Seed members

| id | stages | platform |
|---|---|---|
| `embedding-pipeline` | metadata-read → IEmbedder → IVectorStore.upsert | [desktop, mobile] |
| `auto-touch-pipeline` | connector event → frontmatter-merge → vault-process-note | [desktop, mobile] |
| `time-sync-loop` | interval-register → logical-clock tick → reconcile vault state | [desktop, mobile] |
| `intro-routing` | infer-edges → score → draft-touch | [desktop, mobile] |

## Determinism
- All loops bounded and idempotent: a re-run with unchanged inputs is a no-op.
- `time-sync-loop` reconciles by logical clock; no two devices race on wall time.
