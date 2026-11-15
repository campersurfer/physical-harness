# An OMP2 agent session behind protocol v1 — harness notes for PLE

Draft for the Kaggle Writeup. Numbers marked `«pending»` are filled from `eval/run.py` receipts, never estimated here.
Figures: `docs/architecture.svg`, `docs/failure-breakdown.svg`, `docs/efficiency.svg`.

## Headline

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

## Engineering reasoning on a real task «pending»

Walkthrough of one dev task's trajectory against the workflow a licensed engineer would follow (corpus triage →
governing document → computation with code → deliverable in the requested format → reviewer-style self-check), with
the actual failure or success and the tokens it cost.

## Efficiency (figure 2)

Score against tokens per task for the dev subset, with the measured mean marked, from the same receipts file that
produced the failure breakdown. «pending»

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
