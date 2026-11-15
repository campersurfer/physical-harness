# Status

Last updated 2026-11-14. Evidence only; anything not listed here has not been verified.

## Verified

| Check | Command | Result |
|---|---|---|
| Protocol scenarios (exec/read/write, cancellation, task MCP) | `bun test` | 8 pass / 0 fail: 3 evaluator-fixture scenarios + 5 bridge invariants |
| Entry manifest | `uv run python -m kit validate ~/ple-harness` | `ok: ple-omp2, google-cloud/claude-opus-5-5; egress none` |
| Container build (real builder image, linux/amd64) | `uv run python -m kit build ~/ple-harness` (on the x86_64 host) | `bundle 264 MiB, built in 47 s; serve image plebench-serve:e5337a34d27404eb` |
| `submission.yaml` stage of `kit check` | `uv run python -m kit check --no-smoke` | `[PASS] submission.yaml` |

Tool confinement is asserted at session start: the active tool list must equal
`ple_exec,ple_read_file,ple_write_file,ple_mcp`, and the run aborts otherwise. Usage frames come from settled
assistant messages only, so a call is counted once.

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
