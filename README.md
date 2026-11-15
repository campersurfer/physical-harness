# ple-omp2

A [Physical-Engineering's Last Exam](https://ple-bench.com) competition harness built on
[OMP2](https://omp.sh/docs/sdk). The harness is a WebSocket server that speaks competition protocol v1
(`docs/protocol.md` in `google-research/ple`); each task runs one OMP2 agent session whose only tools are the four
`ple_*` callbacks in `src/tools.ts`, and every one of those callbacks acts inside the task container through the
evaluator.

```
submission.yaml   entry name, model_api, install (Bun + deps), serve (bun serve.ts)
serve.ts          starts the protocol server
src/protocol.ts   protocol v1 client: requests, results, cancellation, usage, done/error
src/tools.ts      ple_exec, ple_read_file, ple_write_file, ple_check_deliverables, ple_mcp
src/mcp.ts        Streamable-HTTP MCP client tunneled through the protocol's `http` request
src/omp.ts        OMP2 session construction: provider registration, confinement, prompt, limits
src/server.ts     WebSocket lifecycle and the one-`done`-per-trial guarantee
prompts/system.md the task agent's instructions
test/             local evaluator fixture, deterministic model, protocol scenarios
```

## Why the tools are host-owned

OMP2's built-in file and shell tools would act on the harness container, not the task container, and the serve
container receives only a read-only bundle. The session is therefore restricted to exactly the `ple_*` tools, with
`restrictToolNames: true`, `allowRestrictedCustomTools: true`, MCP and LSP discovery disabled, and the active tool list
compared against the intended list before the prompt is sent. `src/server.ts` sends `done` (or `error`) on every
terminal path, including evaluator cancellation, because a socket closed without one scores as a harness failure.

## Local checks

```bash
bun install
bun test                     # three protocol scenarios against a local evaluator fixture
uv run python -m kit validate this repository
uv run python -m kit build this repository
uv run python -m kit check this repository          # needs Docker and model settings
uv run python eval/run.py this repository           # dev set; needs the gated HF dataset + a model
```

`bun test` needs no Docker, no model key, and no dataset: `test/fixture.ts` plays the evaluator over a real WebSocket
against a real `serve.ts` process, and `test/mock-model.ts` supplies a deterministic model so the protocol path is
reproducible. The kit and the dev set remain the authority for the container contract and the score.

### Checking the real container without a model key

`test/stub-model.py` is an OpenAI-compatible scripted model for local runs. Started alongside the kit, it lets the
entry exercise its real provider path (HTTP through the kit's egress proxy) inside the real serve container:

```bash
python3 test/stub-model.py 4123 &                       # scripted stand-in for a model
# env file for the kit: MODEL_PROXY_URL=http://127.0.0.1:4123, MODEL_PROXY_KEY=stub-key
uv run python -m kit up --env-file <env> <entry>        # prints ws://127.0.0.1:PORT/
bun test/container-check.ts ws://127.0.0.1:PORT/        # drives the running container
```

The stub reacts to the conversation (it writes `/app/hello.txt` for the kit smoke task, uses app servers when a task
offers them, and otherwise writes `results/deliverable.md`), so `kit check` can run its stages end to end without a
model key. It is test scaffolding and never part of the submitted entry; the dev-set run and the competition itself use
a real sponsored model.

## Fair play

The harness never reads graders, references, or its own `artifacts/`; it makes no network call except to its declared
model gateway; it contains no task-identity branching. Learned improvements belong in this repository's prompts, tools,
and checks as general behavior, never as per-task answers.
