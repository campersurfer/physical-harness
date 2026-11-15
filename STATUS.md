# Status

Last updated 2026-11-14. Evidence only; anything not listed here has not been verified.

## Verified

| Check | Command | Result |
|---|---|---|
| Protocol scenarios and bridge invariants | `bun test` | 9 pass / 0 fail (evaluator fixture: basic, cancel, MCP, deliverable check; bridge: request window, chunking, timeout clamp, cancellation, hostile frames) |
| Entry manifest | `uv run python -m kit validate` | `ok: ple-omp2, google-cloud/claude-opus-5-5; egress none` |
| Container build (real builder image, linux/amd64) | `uv run python -m kit build` on the x86_64 host | `bundle 264 MiB, built in 48 s` |
| Real serve container, real provider path | `kit up` + `bun test/container-check.ts ws://…` | both scenarios pass: 4 protocol requests and 4 usage frames answered inside the container, deliverable written, `done` after cancel |
| `kit check` stages | `uv run python -m kit check --env-file <stub>` | `submission.yaml`, `build`, `model`, `listen` pass; `smoke` and `mcp` are driven end to end by the scripted stand-in model |

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
