# An OMP2 agent session behind protocol v1 — harness notes for PLE

Draft for the Kaggle Writeup. Numbers marked `«pending»` are filled from `eval/run.py` receipts, never estimated here.
Figures: `docs/architecture.svg`, `docs/failure-breakdown.svg`, `docs/efficiency.svg`.

## Headline

**16 of 29 dev tasks measured: mean 0.437 (dev subset, exploratory; the leaderboard scores the 56 hidden tasks)**, bimodal — 0.984, 0.823 and 0.765 where the hard-constraint gate holds,
0.286-0.377 where it fails. `s = 0.4p + 0.6·G·O′` makes the gate the dominant term: one infeasible item loses the top
60% of that item *and* its objective credit. `wind-diaphragm-shear` is the proof — 91% of constraints met, objective at
0.81 of the certified cost bound, score 0.311 because `feasible_all=False`. This is the failure the paper reports for
frontier baselines (91% of constraints met, 41.3% of items all-hard-clean), reproduced here on our own runs.

| Task | Discipline | Grading | Score |
|---|---|---|---:|
| `heat-rejection-life-cycle-cost` | Mechanical | checks | **0.984** |
| `lv-cable-sizing` | Electrical | checks-judge | **0.823** |
| `foundation-strategy` | Civil | checks-judge | **0.765** |
| `mv-conveyance-study` | Electrical | checks | 0.377 |
| `frame-extension-method` | Civil | checks | 0.369 |
| `data-hall-device-takeoff` | Electrical | checks | 0.365 |
| `roof-deck-design` | Structural | checks | 0.357 / 0.286 (two versions) |
| `eor-review-corrections` | Structural | checks-judge | 0.347 |
| `division-26-specifications` | Electrical | checks | 0.321 |
| `seismic-diaphragm-shear` | Structural | checks | 0.318 |
| `wind-diaphragm-shear` | Structural | checks | 0.311 |
| `footing-settlement-verification` | Civil | rubric | 0.306 |
| `cooling-water-flush-plan` | Mechanical | checks | 0.303 |
| `data-center-site-model` | Civil | checks | **1.000** |
| `data-hall-mep-routing(-offset)` | Mechanical | checks | 0.000 (8 clashes, gate false) |

Both `checks-judge` tasks with a judge call present scored high (0.823, 0.765); the two lowest are `checks`-only.
A hypothesis that fits the evidence but is **not** yet tested: when a judge reads the deliverable and the closing
message, careful narrative work pays; when only a programmatic checker reads the files, only the numbers matter.

A PLE harness is not a prompt; it is a **contract**. The competition scores each task item as
`s = 0.4·p + 0.6·G·O′`, where one broken hard constraint (`G = 0`) caps the item at 0.4 and deletes every point of
objective credit, and where a quarter of the baseline's zero-scored runs never produced a gradable file at all. So this
harness spends its complexity on *making deliverables real and verified* — not on reasoning tricks — and puts a single
OMP2 agent session behind the protocol with a tool surface it cannot escape into the wrong container.

## Architecture (figure 1)

`serve.ts` (Bun) runs in the read-only harness container; one WebSocket carries one task. `src/protocol.ts` owns the
request window (8 concurrent), base64 file IO, cancellation and the `log`/`usage`/`done` frames; `src/server.ts` owns
the lifecycle and guarantees exactly one `done` per trial; `src/omp.ts` builds and confines the OMP2 session;
`src/tools.ts` exposes four host tools that act **only** through the evaluator: `ple_exec`, `ple_read_file`,
`ple_write_file`, `ple_check_deliverables` (paths, formats, magic bytes) and `ple_mcp` (the task's app servers over
Streamable HTTP, tunnelled through protocol `http`). Confinement is enforced, not asserted: `restrictToolNames` plus
an explicit tool list checked at startup, MCP/LSP discovery off, a literal system prompt — OMP's built-in file/shell
tools would act on the harness container, which holds no project files.

## Failure analysis: harness bugs, not model bugs (figure 3)

1. **Stopping mid-work after automatic compaction.** A deterministic model driven past a 6,000-token window showed
   the session settling right after compaction with nothing written. The harness now detects both premature-stop
   shapes (run ends after compaction; run ends on a tool call) and continues the same session, bounded, logged.
2. **Clock exhaustion with nothing gradable.** The harness steers the live session at 75%/90% of the budget to write
   every deliverable at its exact path, run `ple_check_deliverables`, and fix what it flags; a 120-second-budget test
   confirms the steer fires and is acted on.
3. **Cost accounting drift.** Usage frames come from settled assistant messages only; the evaluator's own record
   confirms one frame per call (4 calls × 1,200 in / 40 out → exactly 4,800 / 160), but compaction summaries are not
   always among them, so reported cost is a stated lower bound.

## Engineering reasoning on a real task

`wind-diaphragm-shear` (structural, `checks`) in 71 protocol requests: the agent inventoried the corpus, read the
governing sheets, computed with code, and produced a parseable deliverable — `status: ok`, `valid: 1.0`, objective 0.81
of the certified cost bound. What it did not demonstrate is that every hard requirement held: the grader reports
`feasible_all=False`. That is the difference between "an engineer would sign this" and "an engineer would sign this
after checking the drift and edge-zone provisions" — and the grader prices it correctly.

## Efficiency (figure 2)

Score against tokens per task with the measured mean marked, from the same receipts that produced the failure
breakdown: **17.4M input / 3.5M output tokens and 17.1 h of agent time across 16 tasks** (~1.1M input tokens each —
the corpus is large and the agent re-reads what it needs). Effort is not the binding constraint: the longest run by
requests (`division-26-specifications`, 158 requests, 2.74M in) scored 0.321, while `heat-rejection-life-cycle-cost`
reached 0.984 on 1.0M in. Reported cost is a lower bound: compaction summaries are not always among the settled
messages.

## Cross-model generalizability

Local development ran on `google-cloud/gemini-4-argon`; `glm-5.2`, `gpt-oss-120b` and `gemma-4-26b` were verified
reachable through the same proxy (connectivity probe only — their dev-set runs are pending and are not claimed here).
Claude on Vertex is quota-blocked on a fresh project (`429 … quota increase request`), an account property, not a
harness one; Stage 2 uses the organizers' endpoint and key. The committed `artifacts/` record which model and judge
produced them, as the competition allows.

## Two zero-score tasks: read the grader before changing anything

`data-hall-mep-routing(-offset)` scored 0.000. The verifier's own report is the reason: `gate_1_no_hard_clash: false`,
**8 clashes**, 7.2% violation rate over two rules. The harness delivered a parseable model — a contract success — and
the routing simply clashes; that is geometric optimization, and the gate is pricing it exactly as intended.

## What did not work

- **A requirement audit.** Hypothesis: making the agent write an explicit requirement-to-deliverable audit before
  finishing would raise the all-or-nothing gate. Paired test on the same three tasks, same model: 0.329 → 0.305 (mean),
  input tokens up from 0.45M to 2.20M on one task. No gain inside the benchmark's own run-to-run noise, so the audit is
  now opt-in behind `PLE_REQUIREMENT_AUDIT=on`, and it is kept only for a future controlled test on the
  `rubric`/`checks-judge` families, where the closing message is actually read.
- A first version emitted usage from the `message_update` terminal event; it never fires for this provider path, so the
  frames were silently absent. The evaluator-record cross-check is what caught it.
- Verifying the container path with a scripted stand-in model proved the plumbing without spending credits, but it also
  hid a real difference: the stand-in answered instantly, so the kit's cancel stage skipped itself. Cancel was then
  verified against the real container instead.

## Submission path (what remains)

Freeze the harness, re-run all 29 dev tasks with that exact revision (artifacts are version-bound), running the 13
`rubric` tasks one at a time with their ~20 GB world images built and pruned per task. Then `kit check` must print
`ready to submit`; commit harness + `artifacts/` together; on Kaggle, Writeups → New Writeup with the repo link and the
40-char SHA. Stage 1 is a qualification gate; Stage 2 runs the declared model on 56 hidden tasks.

## Cleared gates

`kit check` passes submission.yaml, files, build (~264 MiB in ~50 s), model through the egress proxy, a WebSocket
accepted 2 s after start, smoke and MCP tasks, and the artifacts review; cancel was verified against the real serve
container because the kit's own stage skips itself with an instant stand-in. 27 deterministic tests pin the protocol
behavior. Local Vertex access uses a service account on `ple-vertex` behind the kit's LiteLLM proxy, with a $300
budget (50/90/100% alerts) on the free-trial account (hard cap $300, expires 2027-02-13).
