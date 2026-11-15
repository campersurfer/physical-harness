/**
 * Unit tests for the protocol client's own invariants: the 8-request window,
 * write chunking, timeout clamping, cancellation, and hostile-frame parsing.
 *
 * These drive the bridge directly against a fake socket and wait on the socket's
 * own send signal, so nothing depends on wall-clock sleeps.
 */

import { describe, expect, test } from "bun:test";
import { CancelledError, EvaluatorBridge, parseResultFrame, type SocketLike, type TaskMessage } from "../src/protocol";

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
