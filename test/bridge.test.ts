/**
 * Unit tests for the protocol client's own invariants: the 8-request window,
 * write chunking, timeout clamping, cancellation, and hostile-frame parsing.
 *
 * These drive the bridge directly against a fake socket and wait on the socket's
 * own send signal, so nothing depends on wall-clock sleeps.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { CancelledError, EvaluatorBridge, parseResultFrame, type SocketLike, type TaskMessage } from "../src/protocol";
import { runTask } from "../src/server";
import { createPleSession, type PleSession } from "../src/omp";
import { createTools } from "../src/tools";
import { openMcpSessions, type McpSession } from "../src/mcp";
import type { Timer } from "bun";

function task(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return {
    step: { type: "task" },
    protocol: 1,
    session: "unit",
    instruction: "unit test",
    workdir: "/app",
    limits: { agent_timeout_sec: 600, exec_timeout_sec: 600, max_output_bytes: 100_000, max_write_bytes: 10_000_000 },
    mcp_servers: [],
    ...overrides,
  };
}

class FakeSocket implements SocketLike {
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  #waiters: Array<{ count: number; resolve: () => void }> = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
    for (const waiter of [...this.#waiters]) {
      if (this.sent.length >= waiter.count) {
        this.#waiters = this.#waiters.filter((entry) => entry !== waiter);
        waiter.resolve();
      }
    }
  }

  close(): void {
    this.closed = true;
  }

  /** Resolves once at least `count` frames have been written. */
  waitForSent(count: number): Promise<void> {
    if (this.sent.length >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#waiters.push({ count, resolve });
    return promise;
  }

  reply(bridge: EvaluatorBridge, result: Record<string, unknown>, index: number): void {
    const frame = this.sent[index];
    bridge.handleFrame(JSON.stringify({ type: "result", id: frame.id, ...result }));
  }
}

const EXEC_OK = { exit_code: 0, output: "ok", truncated: false, timed_out: false };

describe("request window", () => {
  test("holds the ninth request until one of the first eight is answered", async () => {
    const socket = new FakeSocket();
    const bridge = new EvaluatorBridge(socket, task());
    const pending = Array.from({ length: 12 }, (_, index) =>
      bridge.exec(`echo ${index}`).catch((error: unknown) => error),
    );

    await socket.waitForSent(8);
    await Promise.resolve();
    expect(socket.sent.length).toBe(8);

    socket.reply(bridge, EXEC_OK, 0);
    await socket.waitForSent(9);
    expect(socket.sent.length).toBe(9);

    for (let index = 1; index < 12; index += 1) {
      socket.reply(bridge, EXEC_OK, index);
      await socket.waitForSent(index + 1).catch(() => undefined);
    }
    await socket.waitForSent(12);
    for (let index = 9; index < 12; index += 1) socket.reply(bridge, EXEC_OK, index);

    const results = await Promise.all(pending);
    expect(results.every((entry) => !(entry instanceof Error))).toBe(true);
  });
});

describe("cancellation", () => {
  test("rejects in-flight and later requests with CancelledError", async () => {
    const socket = new FakeSocket();
    const bridge = new EvaluatorBridge(socket, task());
    const inflight = bridge.exec("sleep 30");
    await socket.waitForSent(1);
    bridge.handleFrame(JSON.stringify({ type: "cancel", reason: "timeout" }));
    const rejection = await inflight.catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(CancelledError);
    await expect(bridge.exec("echo later")).rejects.toBeInstanceOf(CancelledError);
  });

  for (const closeSocket of [false, true]) {
    test(`settles all 20 requests without pumping the queue on ${closeSocket ? "close" : "cancel"}`, async () => {
      const socket = new FakeSocket();
      const bridge = new EvaluatorBridge(socket, task());
      const requests = Array.from({ length: 20 }, (_, index) =>
        bridge.exec(`echo ${index}`).catch((error: unknown) => error));
      await socket.waitForSent(8);
      if (closeSocket) bridge.close();
      else bridge.handleFrame(JSON.stringify({ type: "cancel", reason: "fixture" }));
      const results = await Promise.all(requests);
      expect(results).toHaveLength(20);
      expect(results.every((entry) => entry instanceof CancelledError)).toBe(true);
      expect(bridge.signal.aborted).toBe(true);
      for (let index = 0; index < 8; index += 1) socket.reply(bridge, EXEC_OK, index);
      await expect(bridge.exec("must not dispatch")).rejects.toBeInstanceOf(CancelledError);
      expect(socket.sent).toHaveLength(8);
    });
  }

  test("sends one terminal and disallows requests or telemetry afterward", async () => {
    const socket = new FakeSocket();
    const bridge = new EvaluatorBridge(socket, task());
    bridge.done("best summary");
    bridge.done("duplicate");
    bridge.error("late failure");
    bridge.log("late log");
    bridge.usage({ model: "late", input: 1, output: 1, cacheRead: 0 });
    await expect(bridge.exec("late")).rejects.toBeInstanceOf(CancelledError);
    expect(socket.sent).toEqual([{ type: "done", final_message: "best summary" }]);
  });

  test("clamps exec timeouts to the task's remaining budget", async () => {
    const socket = new FakeSocket();
    const bridge = new EvaluatorBridge(
      socket,
      task({ limits: { agent_timeout_sec: 30, exec_timeout_sec: 600, max_output_bytes: 100_000, max_write_bytes: 10_000_000 } }),
    );
    const pending = bridge.exec("echo hi", 500);
    await socket.waitForSent(1);
    expect(Number(socket.sent[0].timeout_sec)).toBeLessThanOrEqual(29);
    socket.reply(bridge, { exit_code: 0, output: "hi", truncated: false, timed_out: false }, 0);
    await pending;
  });
});

describe("write chunking", () => {
  test("splits an 11 MB payload into bounded appends", async () => {
    const socket = new FakeSocket();
    const bridge = new EvaluatorBridge(socket, task());
    const payload = "x".repeat(11 * 1024 * 1024);
    const writing = bridge.writeFile("/app/big.txt", payload);

    // Chunks are sent one at a time: each waits for its own result.
    await socket.waitForSent(1);
    expect(socket.sent[0].append).toBe(false);
    socket.reply(bridge, { ok: true, size: 0 }, 0);
    await socket.waitForSent(2);
    expect(socket.sent[1].append).toBe(true);
    socket.reply(bridge, { ok: true, size: 0 }, 1);

    expect((await writing).ok).toBe(true);
    expect(socket.sent.length).toBe(2);
    for (const frame of socket.sent) {
      const bytes = Buffer.from(String(frame.content_b64 ?? ""), "base64").byteLength;
      expect(bytes).toBeLessThanOrEqual(10 * 1024 * 1024);
    }
  });
});

describe("result parsing", () => {
  test("narrows a frame with missing or hostile fields instead of trusting it", () => {
    const frame = parseResultFrame({ id: 7, ok: "yes", size: "big", headers: { a: "b", bad: 3 } });
    expect(frame.id).toBe("");
    expect(frame.ok).toBeNull();
    expect(frame.size).toBeNull();
    expect(frame.headers).toEqual({ a: "b" });
  });
});

function sessionFixture(work: (text: string) => Promise<void>) {
  let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
  const counts = { prompts: 0, aborts: 0, disposals: 0, unsubscribes: 0, steers: 0, queueClears: 0 };
  const ple: PleSession = {
    model: "fixture",
    provider: "fixture",
    toolNames: [],
    session: {
      subscribe(callback: typeof listener) {
        listener = callback;
        return () => { counts.unsubscribes += 1; };
      },
      prompt(text: string) {
        counts.prompts += 1;
        return work(text);
      },
      abort() {
        counts.aborts += 1;
        return new Promise<void>(() => {});
      },
      async steer() { counts.steers += 1; },
      clearQueue() { counts.queueClears += 1; },
    } as unknown as PleSession["session"],
    async dispose() { counts.disposals += 1; },
  };
  return {
    ple,
    counts,
    emit(event: { type: string; [key: string]: unknown }) { listener?.(event); },
  };
}

function connectionFor(bridge: EvaluatorBridge) {
  return {
    bridge,
    finished: false,
    deadline: null as Timer | null,
    abortRequested: null as (() => void) | null,
  };
}

describe("task cancellation ownership", () => {
  test("finishes during session setup and disposes a late session without prompting", async () => {
    const socket = new FakeSocket();
    const taskMessage = task();
    const bridge = new EvaluatorBridge(socket, taskMessage);
    const connection = connectionFor(bridge);
    const setup = Promise.withResolvers<PleSession>();
    const fixture = sessionFixture(async () => {});
    const running = runTask(connection, bridge, taskMessage, (line) => bridge.log(line), () => setup.promise);
    bridge.cancel("during setup");
    expect(socket.sent.filter((frame) => frame.type === "done")).toHaveLength(1);
    expect(connection.deadline).toBeNull();
    expect(connection.abortRequested).toBeNull();
    setup.resolve(fixture.ple);
    await running;
    expect(fixture.counts).toMatchObject({ prompts: 0, aborts: 1, disposals: 1 });
    expect(socket.sent.filter((frame) => frame.type === "done")).toHaveLength(1);
  });

  test("does not start adapter setup when already cancelled", async () => {
    const bridge = new EvaluatorBridge(new FakeSocket(), task());
    bridge.cancel();
    await expect(createPleSession({
      bridge, instruction: "fixture", workdir: "/app", secondsLeft: 600,
    })).rejects.toBeInstanceOf(CancelledError);
    expect(bridge.stats.requests).toBe(0);
  });

  test("finishes during MCP initialization without notifications or further servers", async () => {
    const socket = new FakeSocket();
    const taskMessage = task({ mcp_servers: [
      { name: "first", url: "http://first/mcp" },
      { name: "second", url: "http://second/mcp" },
    ] });
    const bridge = new EvaluatorBridge(socket, taskMessage);
    const connection = connectionFor(bridge);
    const running = runTask(connection, bridge, taskMessage, () => {}, async () => {
      await openMcpSessions(bridge);
      throw new Error("cancelled setup must not complete");
    });
    await socket.waitForSent(1);
    expect(socket.sent[0].type).toBe("http");
    bridge.cancel("initializing MCP");
    expect(socket.sent.filter((frame) => frame.type === "done")).toHaveLength(1);
    socket.reply(bridge, { ok: true, status: 200, body_b64: Buffer.from('{"result":{}}').toString("base64") }, 0);
    await running;
    expect(socket.sent.filter((frame) => frame.type === "http")).toHaveLength(1);
    expect(socket.sent.filter((frame) => frame.type === "done")).toHaveLength(1);
  });

  test("aborts an outstanding model without awaiting it, retains partial text, ignores late callbacks", async () => {
    const socket = new FakeSocket();
    const taskMessage = task();
    const bridge = new EvaluatorBridge(socket, taskMessage);
    const connection = connectionFor(bridge);
    const started = Promise.withResolvers<void>();
    const model = Promise.withResolvers<void>();
    const fixture = sessionFixture(() => { started.resolve(); return model.promise; });
    const running = runTask(connection, bridge, taskMessage, (line) => bridge.log(line), async () => fixture.ple);
    await started.promise;
    fixture.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Deliverable saved; partial summary." } });
    bridge.handleFrame(JSON.stringify({ type: "cancel", reason: "outstanding model" }));
    expect(socket.sent.filter((frame) => frame.type === "done")).toEqual([
      { type: "done", final_message: "Deliverable saved; partial summary." },
    ]);
    await running;
    const frameCount = socket.sent.length;
    fixture.emit({ type: "auto_compaction_end" });
    fixture.emit({ type: "message_update", assistantMessageEvent: { type: "toolcall_end" } });
    fixture.emit({ type: "message_end", message: { role: "assistant", usage: { input: 100, output: 5 } } });
    model.reject(new Error("late model failure"));
    await Promise.resolve();
    expect(socket.sent).toHaveLength(frameCount);
    expect(fixture.counts).toMatchObject({ prompts: 1, aborts: 1, disposals: 1, unsubscribes: 1, steers: 0 });
    expect(connection.deadline).toBeNull();
    expect(connection.abortRequested).toBeNull();
    const accounting = socket.sent.filter((frame) => frame.type === "log")
      .map((frame) => String(frame.text)).find((line) => line.includes('"event":"usage_accounting"'));
    expect(JSON.parse(accounting!)).toMatchObject({ completeness: "lower_bound", money: null });
  });

  test("cancels retry sleep without a second prompt", async () => {
    const socket = new FakeSocket();
    const taskMessage = task();
    const bridge = new EvaluatorBridge(socket, taskMessage);
    const retrying = Promise.withResolvers<void>();
    const fixture = sessionFixture(async () => { throw new Error("transient fixture failure"); });
    const running = runTask(connectionFor(bridge), bridge, taskMessage, (line) => {
      if (line.includes("retrying in")) retrying.resolve();
    }, async () => fixture.ple);
    await retrying.promise;
    bridge.cancel("retry sleep");
    await running;
    expect(fixture.counts.prompts).toBe(1);
    expect(socket.sent.filter((frame) => frame.type === "done")).toHaveLength(1);
  });
});

const MCP_SESSION: McpSession = {
  name: "apps", url: "http://apps/mcp", sessionId: null, protocolVersion: "2025-06-18", nextId: 1,
};

function replyRpc(socket: FakeSocket, bridge: EvaluatorBridge, index: number, payload: Record<string, unknown>, status = 200) {
  socket.reply(bridge, {
    ok: true, status, headers: { "content-type": "application/json" },
    body_b64: Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...payload })).toString("base64"),
  }, index);
}

describe("tool discovery and outcome details", () => {
  test("discovers a middle tool in a large paginated catalog and retrieves its entire schema", async () => {
    const socket = new FakeSocket();
    const bridge = new EvaluatorBridge(socket, task());
    const session = { ...MCP_SESSION };
    const tool = createTools(bridge, new Map([["apps", session]])).find((entry) => entry.name === "ple_mcp")!;
    const schema = { type: "object", description: "x".repeat(40_000), properties: { sentinel_at_end: { type: "string" } } };
    const catalog = Array.from({ length: 1000 }, (_, index) => ({
      name: `tool_${String(index).padStart(4, "0")}`,
      description: index === 500 ? "unique middle target" : "description ".repeat(60),
      inputSchema: index === 500 ? schema : { type: "object" },
    }));
    let sent = 0;
    const execute = async (args: Record<string, unknown>) => {
      const result = tool.execute("fixture", { server: "apps", ...args }, undefined, {} as never);
      await socket.waitForSent(sent + 1);
      replyRpc(socket, bridge, sent++, { result: { tools: catalog.slice(0, 500), nextCursor: "second" } });
      await socket.waitForSent(sent + 1);
      const request = JSON.parse(Buffer.from(String(socket.sent[sent].body_b64), "base64").toString("utf8"));
      expect(request.params.cursor).toBe("second");
      replyRpc(socket, bridge, sent++, { result: { tools: catalog.slice(500) } });
      return await result;
    };
    const page = await execute({ action: "list", offset: 490, limit: 20 });
    const pageText = page.content[0] as { text: string };
    const index = JSON.parse(pageText.text);
    expect(index).toMatchObject({ total: 1000, offset: 490, next_offset: 510 });
    expect(index.tools.some((entry: { name: string }) => entry.name === "tool_0500")).toBe(true);
    expect(pageText.text.length).toBeLessThan(10_000);
    const search = await execute({ action: "list", query: "UNIQUE MIDDLE" });
    expect(JSON.parse((search.content[0] as { text: string }).text).tools).toEqual([
      { name: "tool_0500", description: "unique middle target" },
    ]);
    const selected = await execute({ action: "schema", tool: "tool_0500" });
    expect(JSON.parse((selected.content[0] as { text: string }).text).inputSchema).toEqual(schema);
    bridge.close();
  });

  test("keeps MCP application errors separate from transport errors", async () => {
    const socket = new FakeSocket();
    const bridge = new EvaluatorBridge(socket, task());
    const tool = createTools(bridge, new Map([["apps", { ...MCP_SESSION }]])).find((entry) => entry.name === "ple_mcp")!;
    const params = { action: "call", server: "apps", tool: "save" };
    const application = tool.execute("app", params, undefined, {} as never);
    await socket.waitForSent(1);
    replyRpc(socket, bridge, 0, { result: { content: [{ type: "text", text: "invalid document" }], isError: true } });
    expect(await application).toMatchObject({
      isError: true, details: { transport: "ok", outcome: "application_error", mcp_is_error: true },
    });
    const rpcError = tool.execute("rpc", params, undefined, {} as never);
    await socket.waitForSent(2);
    replyRpc(socket, bridge, 1, { error: { code: -32602, message: "invalid params" } });
    expect(await rpcError).toMatchObject({
      isError: true, details: { transport: "ok", outcome: "application_error", source: "mcp_rpc", code: -32602 },
    });
    const transport = tool.execute("transport", params, undefined, {} as never);
    await socket.waitForSent(3);
    socket.reply(bridge, { ok: false, error: "connection refused" }, 2);
    expect(await transport).toMatchObject({ isError: true, details: { transport: "failed", outcome: "transport_error" } });
    const success = tool.execute("ok", params, undefined, {} as never);
    await socket.waitForSent(4);
    replyRpc(socket, bridge, 3, { result: { content: [{ type: "text", text: "saved" }] } });
    expect(await success).toMatchObject({ isError: false, details: { transport: "ok", outcome: "success", mcp_is_error: false } });
    bridge.close();
  });

  test("preserves nonzero exit and timeout without adjudicating the user's goal", async () => {
    const socket = new FakeSocket();
    const bridge = new EvaluatorBridge(socket, task());
    const tool = createTools(bridge, new Map()).find((entry) => entry.name === "ple_exec")!;
    const nonzero = tool.execute("nonzero", { command: "grep expected" }, undefined, {} as never);
    await socket.waitForSent(1);
    socket.reply(bridge, { ...EXEC_OK, exit_code: 1 }, 0);
    expect(await nonzero).toMatchObject({
      isError: false,
      details: { transport: "ok", outcome: "process_exit", exit_code: 1, timed_out: false, user_goal_outcome: "not_adjudicated" },
    });
    const timeout = tool.execute("timeout", { command: "sleep 60" }, undefined, {} as never);
    await socket.waitForSent(2);
    socket.reply(bridge, { ...EXEC_OK, exit_code: 124, timed_out: true, truncated: true }, 1);
    expect(await timeout).toMatchObject({
      isError: true,
      details: { transport: "ok", outcome: "process_timeout", exit_code: 124, timed_out: true, truncated: true },
    });
    bridge.close();
  });
});

describe("bounded experiment seams", () => {
  test("caps work and exec budgets without changing official limits, and rejects invalid caps", async () => {
    const previous = process.env.PLE_TASK_BUDGET_SEC;
    const socket = new FakeSocket();
    let bridge: EvaluatorBridge;
    try {
      delete process.env.PLE_TASK_BUDGET_SEC;
      expect(new EvaluatorBridge(new FakeSocket(), task()).taskBudgetSec).toBe(600);
      process.env.PLE_TASK_BUDGET_SEC = "300";
      bridge = new EvaluatorBridge(socket, task());
      expect(bridge.taskBudgetSec).toBe(300);
      expect(bridge.limits.agent_timeout_sec).toBe(600);
      expect(bridge.secondsLeft()).toBeLessThanOrEqual(300);
      process.env.PLE_TASK_BUDGET_SEC = "900";
      expect(new EvaluatorBridge(new FakeSocket(), task()).taskBudgetSec).toBe(600);
      process.env.PLE_TASK_BUDGET_SEC = "300";
      expect(new EvaluatorBridge(new FakeSocket(), task({
        limits: { ...task().limits, agent_timeout_sec: null },
      })).taskBudgetSec).toBe(300);
      for (const invalid of ["", "0", "-1", "1.5", "NaN", "Infinity"]) {
        process.env.PLE_TASK_BUDGET_SEC = invalid;
        expect(() => new EvaluatorBridge(new FakeSocket(), task())).toThrow("positive finite integer");
      }
    } finally {
      if (previous === undefined) delete process.env.PLE_TASK_BUDGET_SEC;
      else process.env.PLE_TASK_BUDGET_SEC = previous;
    }
    const execution = bridge!.exec("fixture", 600);
    await socket.waitForSent(1);
    expect(Number(socket.sent[0].timeout_sec)).toBeLessThanOrEqual(298);
    socket.reply(bridge!, EXEC_OK, 0);
    await execution;
    bridge!.close();
  });

  test("an exhausted budget cannot start setup or pump queued work", async () => {
    const previous = process.env.PLE_TASK_BUDGET_SEC;
    let bridge: EvaluatorBridge;
    const socket = new FakeSocket();
    try {
      process.env.PLE_TASK_BUDGET_SEC = "1";
      bridge = new EvaluatorBridge(socket, task());
    } finally {
      if (previous === undefined) delete process.env.PLE_TASK_BUDGET_SEC;
      else process.env.PLE_TASK_BUDGET_SEC = previous;
    }
    const requests = Array.from({ length: 9 }, () => bridge!.exec("fixture").catch((error: unknown) => error));
    const future = Date.now() + 2000;
    const clock = spyOn(Date, "now").mockReturnValue(future);
    let running: Promise<void>;
    let setupCalls = 0;
    try {
      socket.reply(bridge!, EXEC_OK, 0);
      running = runTask(connectionFor(bridge!), bridge!, task(), () => {}, async () => {
        setupCalls += 1;
        throw new Error("must not set up");
      });
    } finally {
      clock.mockRestore();
    }
    await running!;
    const outcomes = await Promise.all(requests);
    expect(outcomes[8]).toBeInstanceOf(CancelledError);
    expect(setupCalls).toBe(0);
    expect(socket.sent.filter((frame) => frame.type === "exec")).toHaveLength(8);
    expect(socket.sent.filter((frame) => frame.type === "done")).toHaveLength(1);
  });

  // The audit is opt-in after its measured negative (see STATUS.md): absent or
  // "off" means no audit text, only "on" adds it.
  for (const audit of [undefined, "off", "on"]) {
    test(`continuation requirement audit is ${audit === "on" ? "enabled explicitly" : "off unless PLE_REQUIREMENT_AUDIT=on"}`, async () => {
      const previous = process.env.PLE_REQUIREMENT_AUDIT;
      const socket = new FakeSocket();
      const taskMessage = task();
      const bridge = new EvaluatorBridge(socket, taskMessage);
      const prompts: string[] = [];
      const fixture = sessionFixture(async (text) => {
        prompts.push(text);
        if (prompts.length === 1) {
          fixture.emit({ type: "message_update", assistantMessageEvent: { type: "toolcall_end" } });
        }
      });
      let running: Promise<void>;
      try {
        if (audit === undefined) delete process.env.PLE_REQUIREMENT_AUDIT;
        else process.env.PLE_REQUIREMENT_AUDIT = audit;
        running = runTask(connectionFor(bridge), bridge, taskMessage, () => {}, async () => fixture.ple);
      } finally {
        if (previous === undefined) delete process.env.PLE_REQUIREMENT_AUDIT;
        else process.env.PLE_REQUIREMENT_AUDIT = previous;
      }
      await running!;
      expect(prompts).toHaveLength(2);
      expect(prompts[1].includes("requirement audit")).toBe(audit === "on");
      expect(socket.sent.filter((frame) => frame.type === "done")).toHaveLength(1);
    });
  }
});
