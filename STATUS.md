# Status

Last updated 2026-11-16. Evidence classes below are separate; fixtures and scripted gateway rehearsals are not competition performance.

## Current dev-set tally (16 of 29 tasks, gemini-4-argon, 2026-11-16)

Mean over the 16 measured tasks is **0.437**; strong results: 1.000 (civil site model — schema, geometry and all 17
constraints passed), 0.984 (mechanical LCC), 0.823 (electrical checks-judge). The two `data-hall-mep-routing` tasks
scored 0.000 — read `verifier/eval.stdout.txt` in those trials for the reason before the freeze run. The 13 `rubric`
tasks remain and are deferred to the freeze run, one ~20 GB world image at a time (they cannot coexist on a 150 GB
host). Artifacts are version-bound: the freeze run re-runs every task with the final harness.

## Source and deterministic checks

- Declared model: `google-cloud/gemini-4-argon`. Claude on the existing Vertex route is quota-blocked; no repeated probes are needed.
- SDK remains the **TypeScript/Bun** implementation, `@oh-my-pi/pi-coding-agent@18.19.0`, Bun 1.4.4—not the Rust OMP2 rewrite. Native qualification is a separate Cursus candidate, pinned at upstream `2f92f3b5aa2035d21c9f016f9ff6350795e5685a`; its single bounded build produced no executable, so no native migration is claimed here.
- `bun test test/bridge.test.ts test/protocol.test.ts` on 2026-11-15: **26 pass, 0 fail**, 130 assertions.
- Cancellation owns the task before asynchronous setup, aborts the active session, clears timers/steering/retry queues and sends one terminal without waiting for a model response. Late callbacks cannot restart work.
- Cancelling or closing a bridge with 20 requests settles all promises and starts no queued evaluator requests.
- MCP discovery provides bounded index pages and name/description search. `ple_mcp(action=schema)` returns the selected tool's complete schema; `action=call` preserves application errors.
- Tool outcome logs distinguish transport failure, process exit/timeout and MCP application errors. Nonzero process exits are observations, not adjudications of the user's goal.
- `PLE_TASK_BUDGET_SEC` optionally limits harness work without increasing or modifying the evaluator's declared limits. The existing 45-second wrap-up margin remains.
- `PLE_REQUIREMENT_AUDIT=off` disables the optional audit in the system prompt and checkpoint/continuation messages. The manifest keeps it off pending paired evidence; an enabled audit belongs in actual deliverables, not merely the closing message.

The long-context fixture observed 9 model calls and 9 reported usage frames in this execution, including two compaction events. This does not establish complete accounting on every path. `usage_accounting` explicitly labels settled-message tokens as lower-bound, excludes unobserved maintenance/unsettled calls, and leaves money unknown.

## Historical container and pipeline evidence

Earlier source passed a real linux/amd64 builder and serve-container exercise on the existing x86_64 execution host. The bundle was 264 MiB. `kit check` reached model/listen/smoke/MCP with a scripted OpenAI-compatible gateway; cancellation was exercised separately with the real serve container.

Scripted rehearsals on real dev-task containers:

| Task | Grading | Recorded reward | Evidence class |
|---|---|---:|---|
| `wind-diaphragm-shear` | checks | 0.0 | scripted-model pipeline rehearsal |
| `footing-settlement-verification` | rubric | 0.0 | scripted-model pipeline rehearsal |
| `lv-cable-sizing` | checks-judge | 0.0 | scripted-model pipeline rehearsal |

These establish pipeline behavior only. Do not submit their artifacts. Container execution of the repaired source is recorded separately by the bounded comparison.

## Genuine historical model execution

Run `real2`, entry `3c14f3f475b33bdeb448289f49baebbdf3f6fc9f` (clean), model `google-cloud/gemini-4-argon`, judge `gemini-4-argon`, dataset `e0c21fa558c3127785656398e3b3bd7da5e5a5a6`:

| Task | Official score | Official solver seconds |
|---|---:|---:|
| `wind-diaphragm-shear` | 0.311111 | 4049 |
| `lv-cable-sizing` | 0.823194 | 2721 |
| `footing-settlement-verification` | 0.306452 | 1834 |

Declared three-task mean: **0.4802523333**. Full29 zero-filled contribution: **0.0496812759**, not a complete leaderboard measurement. All three were measured and exported deliverable files; this alone is not a general gradable-deliverable guarantee.

Official wind metrics record `parse_ok=true`, `feasible_all_scenarios=false` and `objective_paid=0`. This supports testing requirement checking; no particular governing-clause diagnosis follows from the score.

Reported solver usage: 1,155,443 input, 35,830,415 cache, 549,741 output tokens; 8604 solver seconds. Missing maintenance, complete judge usage and monetary charges remain unknown. No efficiency claim is supported.

The run's `results.json` SHA-256 is `0ae1af1490e7afb7ac8a1c74d2f32454ad2146162ef499a1b592dff657da9839`. It predates the current correctness repairs and is diagnostic evidence, not the repaired baseline. `real1` is a separate failed/quota-constrained Claude series and must not be paired with it.

## Bounded comparison

The outer Cursus adapter owns source snapshots, frozen evaluation identity, run intents, official execution, receipt normalization and deterministic decisions. The inner submitted entry requires none of its services.

The prepared experiment is requirement-audit off/on on the same repaired source, the same Gemini model/judge, pinned kit/data, `wind-diaphragm-shear` and `lv-cable-sizing`, concurrency one, one explicit paired repeat, and a common 300-second work budget (approximately 255 seconds before wrap-up). Each arm gets at most 1800 outer seconds and one evaluator attempt. No retry campaign follows merely to obtain a gain. A positive single repeat is directional/inconclusive, not promotion.

The Cursus operation `ple-audit-20261115-pair1` generated both source arms from repaired commit
`4e6915f66e404c98abcb063a527b00d4db3835e4` but dispatched **zero** new model trials: an existing five-task run
occupied the shared host. Its canonical receipt `receipt-c33d949f-2293-41d9-b2dc-81dbf3314c99` is inconclusive
(`BLOCKED`), not a performance comparison. The unchanged-result control was rejected. The audit-off incumbent remains;
no promotion, serving transfer, repaired-container result or new score gain is claimed. Resume only as a new bounded
operation once the host is quiet and the remaining allowance has been read back.

On the single 2026-11-16 reconciliation, the existing batch was still active; no paired run was resubmitted and the historical receipt was not reopened. Cursus integrated per-dispatch allowance freshness and a host-wide evaluation lease. A 300-second failure is only a budget-limited screen unless the audit behavior was actually reached; one repeat still cannot promote. Native worker/CLI rehearsals and the rendered Cursus Tern view are not PLE performance or final submission artifacts.

## Host prerequisites and artifact boundary

Docker, Harbor 0.20.0, the gated dataset and the working Gemini/judge route already exist on the established host. Do not repeat installation or enrollment from older proposals. Available disk and memory must be checked before execution; rubric world images can exceed 22 GB.

`--trials 1` controls concurrent tasks, not statistical repeats. Separate run IDs identify repeats.

The official artifact rules permit missing dev-task folders with warnings and zero contribution. The pinned exporter requires measured results for the tasks it exports; this is not a requirement to evaluate all 29 tasks before a local comparison. Full coverage remains a final-package goal.

Keep research-arm artifacts and scripted/cross-model rehearsals outside final submission artifacts. Use `--no-export` for research arms; retain each run's organizer-generated manifest unchanged. Final committed artifacts must come from the submitted harness and declared `model_api`, exported by organizer tooling. A manifest model label cannot detect a scripted stand-in.

No official submission or production deployment is authorized by this source update. Future packaging still requires the official artifact review, `kit check`, a deliberately selected harness commit and the owner's submission action.
