# An OMP2 agent session behind protocol v1 — harness notes for PLE

Draft for the Kaggle Writeup. Numbers marked `«pending»` are filled from `eval/run.py` receipts, never estimated here.
Figures: `docs/architecture.svg`, `docs/failure-breakdown.svg`, `docs/efficiency.svg`.

## Headline

**First real dev-set results (8 tasks, one model, no harness tuning): mean 0.475**, bimodal — 0.984 and 0.823 where the
hard-constraint gate holds, 0.31–0.38 where it does not. The gate, not the objective, is where the points are:
`wind-diaphragm-shear` met 91% of its constraints and reached 81% of the certified cost bound, yet scored 0.311 because
`feasible_all=False` caps the affected items at `0.4p` and deletes their objective credit. That is the same failure the
paper reports for frontier baselines (91% of constraints met, 41.3% of items all-hard-clean), reproduced here.

| Task | Discipline | Grading | Score |
|---|---|---|---:|
| `heat-rejection-life-cycle-cost` | Mechanical | checks | **0.984** |
| `lv-cable-sizing` | Electrical | checks-judge | **0.823** |
| `mv-conveyance-study` | Electrical | checks | 0.377 |
| `roof-deck-design` | Structural | checks | 0.357 |
| `division-26-specifications` | Electrical | checks | 0.321 |
| `seismic-diaphragm-shear` | Structural | checks | 0.318 |
| `wind-diaphragm-shear` | Structural | checks | 0.311 |
| `footing-settlement-verification` | Civil | rubric | 0.306 |

A PLE harness is not a prompt; it is a **contract**. The competition scores each task item as
`s = 0.4·p + 0.6·G·O′`, where one broken hard constraint (`G = 0`) caps the item at 0.4 and deletes every point of
objective credit, and where a quarter of the baseline's zero-scored runs never produced a gradable file at all. So this
harness spends its complexity on *making deliverables real and verified* — not on reasoning tricks — and puts a single
OMP2 agent session behind the protocol with a tool surface it cannot escape into the wrong container.

## Architecture (figure 1)

`submission.yaml` starts `serve.ts` (Bun) in the read-only harness container. One WebSocket carries one task.
`src/protocol.ts` owns the request window (8 concurrent), base64 file IO, cancellation and the one-way `log`/`usage`/
`done` frames; `src/server.ts` owns the lifecycle and guarantees exactly one `done` per trial; `src/omp.ts` builds the
OMP2 session and confines it; `src/tools.ts` exposes four host tools that act **only** through the evaluator:

| Tool | Purpose |
|---|---|
| `ple_exec` | `bash -c` inside the task container, timeout clamped to the remaining budget |
| `ple_read_file` / `ple_write_file` | text and binary transfer, chunked writes above 10 MB |
| `ple_check_deliverables` | verifies each requested path exists, is non-empty, and is really the format it claims (JSON parses, CSV rows align, PDF/Office magic bytes) |
| `ple_mcp` | the task's app servers (documents, sheets, mail, CAD) over Streamable HTTP, tunnelled through protocol `http` |

Confinement is enforced, not asserted: `customTools` + `toolNames` + `restrictToolNames` + `allowRestrictedCustomTools`,
MCP/LSP discovery off, a literal system prompt, and a startup check that the session's active tool list equals the
intended four. OMP's built-in file/shell tools would act on the *harness* container — which holds no project files — so
they are removed rather than discouraged.

## Failure analysis: three failure classes that are harness bugs, not model bugs (figure 3)

1. **Stopping mid-work after automatic compaction.** With a deterministic model driven past a 6,000-token window, the
   session settled immediately after compaction with only the summary as its last output — nothing written. On a real
   six-hour task that silently ends the run near the end of its context budget. The harness now detects both shapes of
   premature stop (run ends right after compaction; run ends with the model's last output being a tool call) and
   continues the same session, bounded to three continuations, logging each one.
2. **Running out of clock with nothing gradable.** The harness steers the *live* session at 75% and 90% of the budget:
   stop exploring, write every deliverable at its exact path with current numbers, run `ple_check_deliverables`, fix
   what it flags, then keep improving. A 120-second-budget test with a model that only explores confirms the steer
   fires and the agent acts on it.
3. **Cost accounting drift.** Usage frames are emitted from settled assistant messages only, which the evaluator's own
   record confirms (stub model: 4 calls × 1,200 in / 40 out → `n_input_tokens: 4800`, `n_output_tokens: 160`).
   Maintenance calls (compaction summaries) are not always delivered as settled messages, so reported cost is a lower
   bound; the writeup says so rather than implying exactness.

## Engineering reasoning on a real task

`wind-diaphragm-shear` (structural, `checks`) in 71 protocol requests: the agent inventoried the project corpus, read
the governing sheets, computed with code, and emitted a parseable deliverable — `status: ok`, `parse_ok: true`,
`valid: 1.0`, objective 0.812 of the certified cost bound. What it did *not* do is demonstrate that every hard
requirement held: the grader reports `feasible_all=False`. That is the difference between "an engineer would sign this"
and "an engineer would sign this after checking the drift and edge-zone provisions", and the grader is right to price
it the way it does.

## Efficiency (figure 2)

Score against tokens per task, with the measured mean marked, from the same receipts file that produced the failure
breakdown. Across the eight tasks: **7.86M input / 1.77M output tokens** — roughly 1.2M input tokens per task, because
the corpus is large and the agent re-reads what it needs. The spread is informative: the two high-scoring tasks were not
the cheapest (`heat-rejection-life-cycle-cost` 1.0M in, `lv-cable-sizing` 0.37M in) but the *longest* run by requests
(`division-26-specifications`, 158 requests, 2.74M in) scored 0.321 — effort spent, gate still failed. Cost is a
lower bound here: usage frames come from settled assistant messages, and compaction summaries are not always among
them.

## Cross-model generalizability

Local development ran on `google-cloud/gemini-4-argon` (with `glm-5.2`, `gpt-oss-120b` and `gemma-4-26b` verified
reachable through the same proxy for a second family). Claude on Vertex is **quota-blocked on a fresh project**
(`429 … submit a quota increase request`), which is a property of the account, not of the harness; Stage 2 uses the
organizers' endpoint and key. The committed `artifacts/` were generated locally, and this writeup records the model and
judge used, as the competition allows.

## What did not work

- A first version emitted usage from the `message_update` terminal event; it never fires for this provider path, so the
  frames were silently absent. The evaluator-record cross-check is what caught it.
- Verifying the container path with a scripted stand-in model proved the plumbing without spending credits, but it also
  hid a real difference: the stand-in answered instantly, so the kit's cancel stage skipped itself. Cancel was then
  verified against the real container instead.
