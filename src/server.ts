/**
 * Protocol v1 WebSocket server: one connection, one task.
 *
 * Lifecycle: accept -> task message -> build session -> prompt -> summarize ->
 * `done`. Every path that can end a trial (normal end, agent error, evaluator
 * cancellation, deadline) ends in exactly one `done` or `error` frame, because a
 * socket closed without one is scored as a harness failure.
 */

import { EvaluatorBridge, type TaskMessage, parseResultFrame } from "./protocol";
import { createPleSession, renderTaskPrompt } from "./omp";

const WRAP_UP_MARGIN_SEC = 45;
const SHUTDOWN_GRACE_SEC = 20;

type Connection = {
  bridge: null | EvaluatorBridge;
  summary: string;
  finished: boolean;
  finishing: boolean;
  deadline: ReturnType<typeof setTimeout> | null;
  abortRequested: (() => void) | null;
};

/**
 * Continuation text sent when a run stops with the model's last output being a
 * tool call — the session ended mid-work (automatic compaction can do this),
 * and the deliverables are not finished.
 */
/**
 * Steering text sent when the task's time budget is mostly spent. The paper's
 * baseline loses runs to the time limit with nothing gradable written, so the
 * agent is told to secure the deliverables before the evaluator stops it.
 */
const TIME_CHECKPOINT_PROMPT =
  "Time check: roughly three quarters of the task budget is gone. Stop exploring and make the deliverables real now — " +
  "write every file the task asked for at its exact path with your current best numbers, run ple_check_deliverables on " +
  "those paths, fix what it flags, then keep improving the contents only while time remains.";

const CONTINUE_PROMPT =
  "Continue the task from where it stopped. The container still holds everything you wrote; " +
  "re-read the instruction, check the files that exist, then finish the deliverables.";

function parseTaskMessage(raw: string): TaskMessage {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object") throw new Error("task message is not an object");
  const record = parsed as Record<string, unknown>;
  if (record.type !== "task") throw new Error(`expected a task message, received ${String(record.type)}`);
  const instruction = record.instruction;
  const workdir = record.workdir;
  if (typeof instruction !== "string" || instruction.trim().length === 0) {
    throw new Error("task message has no instruction");
  }
  if (typeof workdir !== "string" || workdir.length === 0) throw new Error("task message has no workdir");
  const limits = record.limits;
  const mcpServers = Array.isArray(record.mcp_servers)
    ? record.mcp_servers.filter((entry): entry is { name: string; url: string; transport?: string } => {
        if (entry === null || typeof entry !== "object") return false;
        const candidate = entry as Record<string, unknown>;
        return typeof candidate.name === "string" && typeof candidate.url === "string";
      })
    : [];
  return {
    step: { type: "task" },
    protocol: typeof record.protocol === "number" ? record.protocol : 1,
    session: typeof record.session === "string" ? record.session : "unknown",
    instruction,
    workdir,
    limits: {
      agent_timeout_sec:
        limits !== null && typeof limits === "object" && typeof (limits as Record<string, unknown>).agent_timeout_sec === "number"
          ? ((limits as Record<string, unknown>).agent_timeout_sec as number)
          : null,
      exec_timeout_sec:
        limits !== null && typeof limits === "object" && typeof (limits as Record<string, unknown>).exec_timeout_sec === "number"
          ? ((limits as Record<string, unknown>).exec_timeout_sec as number)
          : 600,
      max_output_bytes: 100_000,
      max_write_bytes: 10_000_000,
    },
    mcp_servers: mcpServers,
  };
}

/** Runs one task and always finishes the trial with a one-way frame. */
async function runTask(
  connection: Connection,
  bridge: EvaluatorBridge,
  task: TaskMessage,
  log: (text: string) => void,
): Promise<void> {
  let lastAssistantText = "";
  // Two ways a run can stop mid-work: the model's last output was a tool call
  // with no closing text, or automatic compaction ran and the session ended
  // before doing any work with the compacted context.
  let endedWithToolCall = false;
  let compactedWithoutWork = false;
  let session: Awaited<ReturnType<typeof createPleSession>> | null = null;
  let unsubscribe: (() => void) | null = null;

  const finish = (frame: "done" | "error", text: string) => {
    if (connection.finished) return;
    connection.finished = true;
    if (connection.deadline) clearTimeout(connection.deadline);
    const message = text.trim().length > 0 ? text : "(no summary produced)";
    if (frame === "done") bridge.done(message);
    else bridge.error(message);
  };

  try {
    log(`task ${task.session}: workdir=${task.workdir} timeout=${String(task.limits.agent_timeout_sec)}s`);
    const secondsLeft = bridge.secondsLeft();

    const deadlineMs = secondsLeft === null ? null : Math.max(5, secondsLeft - WRAP_UP_MARGIN_SEC) * 1000;
    if (deadlineMs !== null) {
      connection.deadline = setTimeout(() => {
        log("deadline reached: wrapping up");
        connection.abortRequested?.();
      }, deadlineMs);
    }
    // Two bounded checkpoints while real time remains, so a slow task still
    // produces deliverables instead of being stopped with nothing written.
    const checkpoints = secondsLeft === null ? [] : [0.75, 0.9];
    for (const fraction of checkpoints) {
      const delayMs = Math.max(5, secondsLeft * fraction - WRAP_UP_MARGIN_SEC) * 1000;
      if (delayMs >= deadlineMs!) continue;
      setTimeout(() => {
        if (connection.finished || bridge.cancelled || !session) return;
        log(`time checkpoint at ${Math.round(fraction * 100)}% of the budget: steering to deliverables`);
        void session.session.steer(TIME_CHECKPOINT_PROMPT).catch(() => undefined);
      }, delayMs);
    }

    session = await createPleSession({
      bridge,
      instruction: task.instruction,
      workdir: task.workdir,
      secondsLeft,
    });
    log(`session ready: model=${session.model} tools=${session.toolNames.join(",")}`);

    connection.abortRequested = () => {
      void session?.session.abort().catch(() => undefined);
      // If the agent cannot settle quickly, finish with what we have.
      setTimeout(() => {
        finish("done", lastAssistantText || "Cancelled by the evaluator; the deliverables already written are the result.");
      }, SHUTDOWN_GRACE_SEC * 1000);
    };

    // Usage comes from the settled assistant message only; reporting from both
    // `message_end` and `turn_end` would double-count every model call.
    unsubscribe = session.session.subscribe((event: { type: string; [key: string]: unknown }) => {
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent as Record<string, unknown> | undefined;
        if (!update) return;
        if (update.type === "text_delta" && typeof update.delta === "string") {
          lastAssistantText += update.delta;
          endedWithToolCall = false;
          return;
        }
        if (update.type === "toolcall_start" || update.type === "toolcall_end") {
          endedWithToolCall = true;
          compactedWithoutWork = false; // real work resumed after any compaction
        }
        return;
      }
      if (event.type === "message_end") {
        const message = event.message;
        if (message === null || typeof message !== "object") return;
        const record = message as Record<string, unknown>;
        if (record.role !== "assistant") return;
        const usage = record.usage;
        if (usage === null || typeof usage !== "object") return;
        const usageRecord = usage as Record<string, unknown>;
        const asCount = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);
        bridge.usage({
          model: typeof record.model === "string" ? record.model : session?.model ?? null,
          input: asCount(usageRecord.input),
          output: asCount(usageRecord.output),
          cacheRead: asCount(usageRecord.cacheRead),
        });
        return;
      }
      if (event.type === "auto_compaction_start") {
        log(`compaction started (${String(event.method ?? "unknown method")})`);
        return;
      }
      if (event.type === "auto_compaction_end") {
        log(`compaction ended (${String(event.method ?? "unknown method")})`);
        compactedWithoutWork = true;
        return;
      }
      if (event.type === "agent_end" && event.isTerminal !== false) {
        log("agent run settled");
      }
    });

    const prompt = renderTaskPrompt({
      instruction: task.instruction,
      workdir: task.workdir,
      mcpServers: bridge.mcpServers.map((server) => server.name),
    });

    // A gateway outage must not zero the whole task: retry the turn a bounded
    // number of times while real task time remains, then report honestly.
    const MAX_TURN_ATTEMPTS = 4;
    const MIN_REMAINING_SEC = 300;
    for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt += 1) {
      lastAssistantText = "";
      const attemptPrompt =
        attempt === 1
          ? prompt
          : `${prompt}\n\n(A previous attempt at this task failed before it finished. Files already written are still in ` +
            `place: re-read the instruction, inspect what exists, then finish the deliverables.)`;
      try {
        await session.session.prompt(attemptPrompt, {
          runCommands: false,
          expandPromptTemplates: false,
          throwOnDrop: true,
        });
        break;
      } catch (error) {
        if (bridge.cancelled) throw error;
        const remaining = bridge.secondsLeft();
        const hasTime = remaining === null || remaining > MIN_REMAINING_SEC;
        if (attempt >= MAX_TURN_ATTEMPTS || !hasTime) throw error;
        const waitSec = Math.min(240, 30 * 2 ** (attempt - 1));
        log(`turn attempt ${attempt} failed (${error instanceof Error ? error.message : String(error)}); retrying in ${waitSec}s`);
        await Bun.sleep(waitSec * 1000);
      }
    }

    // An ended run whose last output was a tool call has unfinished work: ask
    // the same session to continue, a bounded number of times.
    const MAX_CONTINUATIONS = 3;
    for (
      let extra = 1;
      (endedWithToolCall || compactedWithoutWork) && extra <= MAX_CONTINUATIONS;
      extra += 1
    ) {
      const remaining = bridge.secondsLeft();
      if (remaining !== null && remaining <= MIN_REMAINING_SEC) break;
      if (bridge.cancelled) break;
      log(
        `run ended mid-work (${endedWithToolCall ? "last output was a tool call" : "compaction ran, then the session stopped"}); ` +
          `continuation ${extra}/${MAX_CONTINUATIONS}`,
      );
      endedWithToolCall = false;
      compactedWithoutWork = false;
      lastAssistantText = "";
      await session.session.prompt(CONTINUE_PROMPT, {
        runCommands: false,
        expandPromptTemplates: false,
        throwOnDrop: true,
      });
    }

    const summary = lastAssistantText.trim().length > 0 ? lastAssistantText : "Task finished.";
    const stats = bridge.stats;
    log(`finished: requests=${stats.requests} execs=${stats.execs} model_calls=${stats.modelCalls}`);
    finish("done", summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`task failed: ${message}`);
    if (bridge.cancelled && lastAssistantText.trim().length > 0) finish("done", lastAssistantText);
    else if (bridge.cancelled) finish("done", "The evaluator cancelled the task before the agent produced a summary.");
    else finish("error", `harness error: ${message}`);
  } finally {
    unsubscribe?.();
    try {
      await session?.dispose();
    } catch {
      // Disposal failures must not change the trial outcome.
    }
  }
}

export function startServer(): { port: number; stop: () => void } {
  const port = Number(process.env.PORT ?? "0");
  const connections = new Map<unknown, Connection>();

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch(request, bunServer) {
      if (bunServer.upgrade(request)) return undefined;
      return new Response("ple-omp2 harness: WebSocket endpoint\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    },
    websocket: {
      idleTimeout: 0,
      maxPayloadLength: 16 * 1024 * 1024,
      open(ws) {
        connections.set(ws, {
          bridge: null,
          summary: "",
          finished: false,
          finishing: false,
          deadline: null,
          abortRequested: null,
        });
      },
      message(ws, raw) {
        const connection = connections.get(ws);
        if (!connection) return;
        const text = typeof raw === "string" ? raw : Buffer.from(raw as Uint8Array).toString("utf8");
        if (connection.bridge) {
          connection.bridge.handleFrame(text);
          return;
        }
        let task: TaskMessage;
        try {
          task = parseTaskMessage(text);
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: `harness error: ${String(error)}` }));
          ws.close();
          return;
        }
        const bridge = new EvaluatorBridge(
          {
            send: (data) => ws.send(data),
            close: () => ws.close(),
          },
          task,
        );
        connection.bridge = bridge;
        const log = (line: string) => {
          bridge.log(line);
          if (process.env.PLE_LOG_LEVEL !== "silent") process.stderr.write(`[ple-omp2] ${line}\n`);
        };
        void runTask(connection, bridge, task, log);
      },
      close(ws) {
        const connection = connections.get(ws);
        connections.delete(ws);
        connection?.bridge?.close();
      },
    },
  });

  process.stderr.write(`[ple-omp2] listening on 0.0.0.0:${server.port}\n`);
  return { port: server.port, stop: () => server.stop(true) };
}

/** Exposed for tests that drive the parser directly. */
export { parseTaskMessage };
