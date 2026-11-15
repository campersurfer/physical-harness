# Status

Last updated 2026-11-14. Evidence only; anything not listed here has not been verified.

## Verified

| Check | Command | Result |
|---|---|---|
| Protocol scenarios and bridge invariants | `bun test` | 10 pass / 0 fail (evaluator fixture: basic, cancel, MCP, deliverable check, long-context compaction; bridge: request window, chunking, timeout clamp, cancellation, hostile frames) |
| Entry manifest | `uv run python -m kit validate` | `ok: ple-omp2, google-cloud/claude-opus-5-5; egress none` |
| Container build (real builder image, linux/amd64) | `uv run python -m kit build` on the x86_64 host | `bundle 264 MiB, built in 48 s` |
| Real serve container, real provider path | `kit up` + `bun test/container-check.ts ws://…` | both scenarios pass: 4 protocol requests and 4 usage frames answered inside the container, deliverable written, `done` after cancel — re-run after the mid-work-continuation change and still passing |
| `kit check` stages | `uv run python -m kit check --env-file <stub>` | `submission.yaml`, `build`, `model`, `listen` pass; `smoke` and `mcp` are driven end to end by the scripted stand-in model |

Two findings from the long-context scenario (a synthetic conversation driven past a 6,000-token window):

1. **A run can stop right after automatic compaction**, with the rest of the work unfinished — the session settled with
   only the compaction summary as its last output. The harness now continues such a run (bounded to three
   continuations, and it also continues when a run ends with the model's last output being a tool call) and logs why.
   Without this, a long task could silently end with almost nothing written.
2. **Reported usage can under-count maintenance calls.** In one deterministic run the model saw 10 calls while the
   harness reported 9 usage frames; compaction summaries are not always delivered as settled assistant messages. The
   gap is small but non-zero, so any cost figure derived from these frames is a lower bound, and the writeup must say so.

Tool confinement is asserted at session start: the active tool list must equal
`ple_exec,ple_read_file,ple_write_file,ple_check_deliverables,ple_mcp`, and the run aborts otherwise. Usage frames come
from settled assistant messages only, so a call is counted once. A failed turn is retried at most three more times
while real task time remains, and bad writes are capped: a `.json` deliverable that does not parse, an empty file, or a
file whose magic bytes contradict its extension is reported by `ple_check_deliverables` before the run finishes.

## How the container path was verified without a model key

`test/stub-model.py` is a scripted OpenAI-compatible server. Pointing the kit's `MODEL_PROXY_URL` at it makes the entry
run its **real provider path** — HTTP through the kit's egress proxy, in the real read-only serve container — while the
stub supplies the assistant turns. `test/container-check.ts` then answers the harness's protocol requests and asserts
the outcome. The dev-set run and Stage 2 use a real sponsored model; nothing in the entry depends on the stub.

## Pipeline rehearsals on real dev tasks (scripted model, no model budget)

Real dev tasks were run through Harbor on the x86_64 host with `test/stub-model.py` standing in for the gateway. This
proves the pipeline; the rewards are 0 because the scripted model writes no real deliverable, and none of these
artifacts may be committed.

| Task | Grading | Outcome |
|---|---|---|
| `wind-diaphragm-shear` | `checks` | serve `completed`, 4 protocol requests, verifier reward 0.0 |
| `footing-settlement-verification` | `rubric` (LLM judge) | serve `completed`, 6 requests, judge produced `grade.json`, reward 0.0 |
| `lv-cable-sizing` | `checks-judge` | serve `completed`, 4 requests, `grade.json` with `exec_status: ERR_NO_SUBMISSION`, reward 0.0 |

The `checks-judge` verdict also shows the grader's own scoring rule in the wild: `0.4 p + 0.6 [h=1] O'`, with
`paper_score.items: 0` when nothing exists at the declared deliverable path. That matches the published rule and is the
mechanism behind the "no gradable deliverable" failure class.

Usage accounting was verified against the evaluator's own record: with the stub reporting 1,200 input and 40 output
tokens per call, four model calls produced exactly `n_input_tokens: 4800`, `n_output_tokens: 160` in the trial record —
one usage frame per settled call, no double counting and no omission on the normal path.

Disk is the practical constraint found here: the rubric task's world image alone is **22.1 GB**, and one run filled a
150 GB host to 11 GB free before deliberate cleanup (stale serve images plus build cache, which reclaimed ~20 GB). So
the 29-task dev set should run in batches, with each batch's images pruned on purpose; `artifacts/` accumulates across
batches, and the export refuses to produce a committable folder until every task has a result.

## First bounded dev run

One task per grading type, chosen to exercise three different graders without the multi-gigabyte world images:

```bash
# local.env (outside this repository): MODEL_PROXY_URL + MODEL_PROXY_KEY, JUDGE_* if separate, HF_TOKEN
uv run python eval/run.py this repository --env-file local.env \
  --tasks wind-diaphragm-shear,footing-settlement-verification,lv-cable-sizing --trials 1
python3 tools/ple-receipts.py --run runs/<run> --dev-set eval/dev_set.yaml --markdown summary.md
python3 tools/ple-figures.py --receipts runs/<run>/receipts.json --out-dir figures/
```

`wind-diaphragm-shear` is `checks`, `footing-settlement-verification` is `rubric`, `lv-cable-sizing` is `checks-judge`.
Watch peak memory: the largest dev tasks want 6 CPU and 16.25 GB, which exceeds a 15 GB host, so the first subset is
deliberately small and the full set follows only after measuring. The 12 `rubric` tasks run world environments whose
images are around 17 GB and can take an hour to build the first time; if that blocks the first run, drop
`footing-settlement-verification` and let the two non-rubric tasks prove the pipeline first — the judge path then
follows on the same host with a warm image cache.

## Full dev-set plan (after the three-task subset)

1. Run the non-rubric tasks first (`checks`, `checks-judge`): they use small images and can share the host.
2. Then the 12 `rubric` tasks one at a time — each world image is large (the one built here is 22.1 GB), so prune a
   task's image only after its artifacts are exported, and re-check free space before each batch. `artifacts/`
   accumulates; only a complete 29-task set produces a committable folder.
3. Cross-model pass for the writeup: repeat a small subset on `glm-5.2` (or `gpt-oss-120b` / `gemma-4-26b`) — all three
   are reachable through the same proxy — and record score, tokens and where the two models diverge.
4. `claude-opus-5-5` is quota-blocked on this account (`429 … quota increase request`); a quota increase for partner
   models normally needs a paid account, so local runs stay on Gemini/open-weight families.

## Artifacts provenance

The working copy on the run host currently holds `artifacts/` from the **scripted-model rehearsals** — those folders are
pipeline evidence, not results, and must be regenerated by real runs before anything is committed. `eval/run.py`
rewrites a task's folder each time that task runs, and refuses to produce a committable folder until every dev task has
a real result.

## Submission checklist (Kaggle Writeup route)

1. `uv run python eval/run.py <entry> --env-file local.env` until every one of the 29 dev tasks has a result, then
   `uv run python -m kit artifacts <entry>` and commit `artifacts/` together with the harness.
2. `uv run python -m kit check <entry>` must print `ready to submit`.
3. Push the commit; record the 40-character SHA (`git rev-parse HEAD`).
4. On Kaggle: **Writeups → New Writeup**, attach the repository under *Project Links*, put the SHA at the top, and
   cover the five rubric criteria with the three required figures (architecture diagram, score-vs-cost plot,
   dev-set failure breakdown). Drafts are not judged; the writeup must be submitted.
5. Stage 2 runs the declared `model_api` on 56 hidden tasks; the writeup must state which model and judge produced
   the committed artifacts when they were generated locally.

## Blocked on inputs

| Stage | Needs |
|---|---|
| `kit check` (model, listen, smoke, cancel stages) | `MODEL_PROXY_URL` + `MODEL_PROXY_KEY` (or another OpenAI-compatible proxy that serves the sponsored names) |
| Dev-set run → `artifacts/` | The gated Hugging Face dataset (`google/physical-engineerings-last-exam`) plus a model; local dev needs no Google Cloud billing, and the Kaggle writeup must record which model/judge the artifacts came from |
| Submission | A GitHub destination for this repository (public at close, or private with the `ple-submission` GitHub App) and a Kaggle Writeup with the commit SHA |

## Environment notes

- The entry is built and checked on an x86_64 host with Docker. This machine's Docker is Rosetta-emulated, where
  `bun install` segfaults even with the `-baseline` Bun build, so local container builds are not a usable signal.
- Bun's `-baseline` release is used in `install` because it runs on x64 CPUs with and without AVX2.
- `eval/run.py` writes `artifacts/`; nothing in this repository may create or edit it by hand.
