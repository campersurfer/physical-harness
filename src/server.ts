/**
 * Protocol v1 WebSocket server: one connection, one task.
 *
 * Lifecycle: accept -> task message -> build session -> prompt -> summarize ->
 * `done`. Every path that can end a trial (normal end, agent error, evaluator
 * cancellation, deadline) ends in exactly one `done` or `error` frame, because a
 * socket closed without one is scored as a harness failure.
 */

import { EvaluatorBridge, type TaskMessage } from "./protocol";
import { createPleSession, renderTaskPrompt, type PleSession } from "./omp";
import type { Timer } from "bun";

const WRAP_UP_MARGIN_SEC = 45;

type Connection = {
  bridge: null | EvaluatorBridge;
  finished: boolean;
  deadline: Timer | null;
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

const REQUIREMENT_AUDIT_CHECKPOINT =
  " Before you conclude, produce the requirement audit: every explicit requirement, the document it comes from, " +
  "the value you used, and where the deliverable satisfies it.";

const CONTINUE_PROMPT =
  "Continue the task from where it stopped. The container still holds everything you wrote; " +
  "re-read the instruction, check the files that exist, then finish the deliverables";

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
export async function runTask(
  connection: Connection,
  bridge: EvaluatorBridge,
  task: TaskMessage,
  log: (text: string) => void,
  createSession: typeof createPleSession = createPleSession,
): Promise<void> {
  const requirementAudit = process.env.PLE_REQUIREMENT_AUDIT !== "off";
  const checkpointPrompt = TIME_CHECKPOINT_PROMPT + (requirementAudit ? REQUIREMENT_AUDIT_CHECKPOINT : "");
  const continuePrompt = CONTINUE_PROMPT + (requirementAudit ? " and the requirement audit." : ".");
  let lastAssistantText = "";
  let bestAssistantText = "";
  const timers = new Set<Timer>();
  let missingAssistantUsage = 0;
  // Two ways a run can stop mid-work: the model's last output was a tool call
  // with no closing text, or automatic compaction ran and the session ended
  // before doing any work with the compacted context.
  let endedWithToolCall = false;
  let compactedWithoutWork = false;
  // Tool telemetry: which tools ran, how long they took, and whether they failed.
  // Arguments are never logged in full — only a short, bounded summary.
  const toolStarted = new Map<string, { name: string; at: number }>();
  let session: PleSession | null = null;
  let unsubscribe: (() => void) | null = null;

  const finish = (frame: "done" | "error", text: string) => {
    if (connection.finished) return;
    connection.finished = true;
    clearTimeout(connection.deadline);
    connection.deadline = null;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    connection.abortRequested = null;
    bridge.signal.removeEventListener("abort", cancel);
    unsubscribe?.();
    unsubscribe = null;
    log(JSON.stringify({
      event: "usage_accounting",
      completeness: "lower_bound",
      included: "settled assistant message_end usage only",
      excluded: ["off-transcript maintenance/compaction calls", "unsettled or missing-usage model calls"],
      missing_assistant_usage: missingAssistantUsage,
      money: null,
    }));
    const message = text.trim().length > 0 ? text : "(no summary produced)";
    if (frame === "done") bridge.done(message);
    else bridge.error(message);
  };

  const abortSession = () => {
    if (!session) return;
    try {
      session.session.clearQueue();
    } catch {
      // Still abort and deliver the terminal if queue cleanup fails.
    }
    try {
      void session.session.abort().catch(() => undefined);
    } catch {
      // Terminal delivery must not depend on abort succeeding.
    }
  };
  const cancel = () => {
    if (connection.finished) return;
    abortSession();
    finish("done", lastAssistantText.trim() || bestAssistantText ||
      "Cancelled; the deliverables already written are the result.");
  };
  connection.abortRequested = () => bridge.cancel("task deadline");
  bridge.signal.addEventListener("abort", cancel, { once: true });
  if (bridge.cancelled) cancel();

  // Do not hold terminal delivery or cleanup hostage to an unresponsive model.
  const untilCancelled = async <T>(work: Promise<T>): Promise<T> => {
    bridge.signal.throwIfAborted();
    const stopped = Promise.withResolvers<never>();
    const onAbort = () => stopped.reject(bridge.signal.reason);
    bridge.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([work, stopped.promise]);
    } finally {
      bridge.signal.removeEventListener("abort", onAbort);
    }
  };

  try {
    if (connection.finished) return;
    log(`task ${task.session}: workdir=${task.workdir} timeout=${String(task.limits.agent_timeout_sec)}s`);
    const secondsLeft = bridge.secondsLeft();
    log(JSON.stringify({
      event: "task_configuration",
      official_timeout_sec: task.limits.agent_timeout_sec,
      work_budget_sec: bridge.taskBudgetSec,
      requirement_audit: requirementAudit,
    }));
    if (secondsLeft !== null && secondsLeft <= 0) {
      bridge.cancel("task work budget exhausted");
      return;
    }

    const deadlineMs = secondsLeft === null ? null :
      Math.max(0, Math.min(secondsLeft, Math.max(5, secondsLeft - WRAP_UP_MARGIN_SEC))) * 1000;
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
      const timer = setTimeout(() => {
        if (connection.finished || bridge.cancelled || !session) return;
        log(`time checkpoint at ${Math.round(fraction * 100)}% of the budget: steering to deliverables`);
        void session.session.steer(checkpointPrompt).catch(() => undefined);
      }, delayMs);
      timers.add(timer);
    }

    session = await createSession({
      bridge,
      instruction: task.instruction,
      workdir: task.workdir,
      secondsLeft,
    });
    if (connection.finished || bridge.cancelled) {
      abortSession();
      return;
    }
    log(`session ready: model=${session.model} tools=${session.toolNames.join(",")}`);

    // Usage comes from the settled assistant message only; reporting from both
    // `message_end` and `turn_end` would double-count every model call.
    unsubscribe = session.session.subscribe((event: { type: string; [key: string]: unknown }) => {
      if (connection.finished || bridge.cancelled) return;
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent as Record<string, unknown> | undefined;
        if (!update) return;
        if (update.type === "text_delta" && typeof update.delta === "string") {
          lastAssistantText += update.delta;
          bestAssistantText = lastAssistantText;
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
        if (usage === null || typeof usage !== "object") {
          missingAssistantUsage += 1;
          return;
        }
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
      if (event.type === "tool_execution_start") {
        const id = String(event.toolCallId ?? "");
        const name = String(event.toolName ?? "tool");
        toolStarted.set(id, { name, at: Date.now() });
        return;
      }
      if (event.type === "tool_execution_end") {
        const id = String(event.toolCallId ?? "");
        const started = toolStarted.get(id);
        toolStarted.delete(id);
        const name = started?.name ?? String(event.toolName ?? "tool");
        const ms = started ? Date.now() - started.at : -1;
        const result = event.result as { details?: unknown; isError?: boolean } | undefined;
        log(JSON.stringify({
          event: "tool_outcome",
          tool: name,
          ms,
          is_error: event.isError === true || result?.isError === true,
          details: result?.details ?? null,
          user_goal_outcome: "not_adjudicated",
        }));
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
      if (connection.finished || bridge.cancelled) break;
      lastAssistantText = "";
      const attemptPrompt =
        attempt === 1
          ? prompt
          : `${prompt}\n\n(A previous attempt at this task failed before it finished. Files already written are still in ` +
            `place: re-read the instruction, inspect what exists, then finish the deliverables.)`;
      try {
        await untilCancelled(session.session.prompt(attemptPrompt, {
          runCommands: false,
          expandPromptTemplates: false,
          throwOnDrop: true,
        }));
        break;
      } catch (error) {
        if (connection.finished || bridge.cancelled) throw error;
        const remaining = bridge.secondsLeft();
        const hasTime = remaining === null || remaining > MIN_REMAINING_SEC;
        if (attempt >= MAX_TURN_ATTEMPTS || !hasTime) throw error;
        const waitSec = Math.min(240, 30 * 2 ** (attempt - 1));
        log(`turn attempt ${attempt} failed (${error instanceof Error ? error.message : String(error)}); retrying in ${waitSec}s`);
        const retry = Promise.withResolvers<void>();
        const timer = setTimeout(retry.resolve, waitSec * 1000);
        timers.add(timer);
        try {
          await untilCancelled(retry.promise);
        } finally {
          clearTimeout(timer);
          timers.delete(timer);
        }
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
      if (connection.finished || bridge.cancelled) break;
      log(
        `run ended mid-work (${endedWithToolCall ? "last output was a tool call" : "compaction ran, then the session stopped"}); ` +
          `continuation ${extra}/${MAX_CONTINUATIONS}`,
      );
      endedWithToolCall = false;
      compactedWithoutWork = false;
      lastAssistantText = "";
      await untilCancelled(session.session.prompt(continuePrompt, {
        runCommands: false,
        expandPromptTemplates: false,
        throwOnDrop: true,
      }));
    }

    if (connection.finished) return;
    const summary = lastAssistantText.trim().length > 0 ? lastAssistantText : "Task finished.";
    const stats = bridge.stats;
    log(`finished: requests=${stats.requests} execs=${stats.execs} model_calls=${stats.modelCalls}`);
    finish("done", summary);
  } catch (error) {
    if (connection.finished) return;
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
      return new Response("physical-harness harness: WebSocket endpoint\n", {
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
          finished: false,
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
          if (process.env.PLE_LOG_LEVEL !== "silent") process.stderr.write(`[physical-harness] ${line}\n`);
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

  process.stderr.write(`[physical-harness] listening on 0.0.0.0:${server.port}\n`);
  return { port: server.port, stop: () => server.stop(true) };
}

/** Exposed for tests that drive the parser directly. */
export { parseTaskMessage };
