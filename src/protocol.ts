/**
 * Competition protocol v1 client.
 *
 * One instance owns one WebSocket connection to the evaluator for one task.
 * The evaluator is the only party that touches the task container; every action
 * this harness takes inside that container is a request frame sent from here.
 *
 * Frame budget: 16 MiB per frame, at most 8 unanswered requests. File bodies are
 * base64 and capped at 10 MB each way, so writes are chunked.
 */

import type { Timer } from "bun";

export const MAX_INFLIGHT = 8;
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const B64_CHUNK_BYTES = 9 * 1024 * 1024; // keeps a write frame under the 16 MiB limit

export type McpServer = { name: string; url: string; transport?: string };

export type TaskLimits = {
  agent_timeout_sec: number | null;
  exec_timeout_sec: number;
  max_output_bytes: number;
  max_write_bytes: number;
};

export type TaskMessage = {
  step: { type: "task" };
  protocol: number;
  session: string;
  instruction: string;
  workdir: string;
  limits: TaskLimits;
  mcp_servers: McpServer[];
};

/** One `{"type":"result", ...}` frame, narrowed field by field at the boundary. */
export type ResultFrame = {
  id: string;
  exit_code: number | null;
  output: string;
  truncated: boolean;
  timed_out: boolean;
  ok: boolean | null;
  error: string | null;
  size: number | null;
  content_b64: string | null;
  status: number | null;
  headers: Record<string, string>;
  body_b64: string | null;
};

export type ExecResult = {
  exit_code: number | null;
  output: string;
  truncated: boolean;
  timed_out: boolean;
  error: string | null;
};

export type WriteResult = { ok: boolean; size: number; error: string | null };

export type HttpResult = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  error: string | null;
};

/** Raised when the evaluator cancels the task (time limit reached or trial aborted). */
export class CancelledError extends Error {
  constructor(message = "the evaluator cancelled this task") {
    super(message);
    this.name = "CancelledError";
  }
}

/** Raised when a request cannot be delivered, or its reply reports a failure. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

type Pending = {
  resolve: (value: ResultFrame) => void;
  reject: (error: Error) => void;
  timer: Timer | null;
  settle: () => void;
};

export type SocketLike = {
  send(data: string): void;
  close(): void;
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Narrows an untrusted frame into a ResultFrame; unknown fields become null. */
export function parseResultFrame(raw: Record<string, unknown>): ResultFrame {
  return {
    id: asString(raw.id) ?? "",
    exit_code: asNumber(raw.exit_code),
    output: asString(raw.output) ?? "",
    truncated: asBoolean(raw.truncated),
    timed_out: asBoolean(raw.timed_out),
    ok: typeof raw.ok === "boolean" ? raw.ok : null,
    error: asString(raw.error),
    size: asNumber(raw.size),
    content_b64: asString(raw.content_b64),
    status: asNumber(raw.status),
    headers: asStringRecord(raw.headers),
    body_b64: asString(raw.body_b64),
  };
}

export class EvaluatorBridge {
  readonly session: string;
  readonly workdir: string;
  readonly limits: TaskLimits;
  readonly mcpServers: McpServer[];

  #socket: SocketLike;
  #pending = new Map<string, Pending>();
  #queue: Array<() => void> = [];
  #ids = 0;
  #inflight = 0;
  #cancelled = false;
  #closed = false;
  #startedAt = Date.now();
  #sentOneWay: Record<string, unknown>[] = [];
  /** Facts worth keeping for the closing summary even after cancellation. */
  readonly stats = { requests: 0, execs: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0 };

  constructor(socket: SocketLike, task: TaskMessage) {
    this.#socket = socket;
    this.session = task.session;
    this.workdir = task.workdir;
    this.limits = {
      agent_timeout_sec: task.limits?.agent_timeout_sec ?? null,
      exec_timeout_sec: task.limits?.exec_timeout_sec ?? 600,
      max_output_bytes: task.limits?.max_output_bytes ?? 100_000,
      max_write_bytes: task.limits?.max_write_bytes ?? 10_000_000,
    };
    this.mcpServers = task.mcp_servers ?? [];
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  /** Seconds left before the evaluator cancels the task; null when untimed. */
  secondsLeft(): number | null {
    if (this.limits.agent_timeout_sec === null) return null;
    const elapsed = (Date.now() - this.#startedAt) / 1000;
    return Math.max(0, this.limits.agent_timeout_sec - elapsed);
  }

  /** Handles one inbound frame. Unknown frames are ignored rather than fatal. */
  handleFrame(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== "object") return;
    const message = parsed as Record<string, unknown>;
    const type = message.type;
    if (type === "result") {
      const frame = parseResultFrame(message);
      const pending = this.#pending.get(frame.id);
      if (!pending) return;
      this.#pending.delete(frame.id);
      pending.settle();
      pending.resolve(frame);
      return;
    }
    if (type === "cancel") {
      this.cancel(asString(message.reason) ?? "timeout");
    }
  }

  /** Cancels outstanding work; later requests fail fast. */
  cancel(reason = "timeout"): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    const error = new CancelledError(`the evaluator cancelled this task (${reason})`);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.settle();
      pending.reject(error);
    }
    this.#pending.clear();
    this.#queue.length = 0;
  }

  /** Marks the socket as gone so senders stop waiting on it. */
  close(): void {
    this.#closed = true;
    this.cancel("socket closed");
  }

  #send(message: Record<string, unknown>, timeoutMs: number | null): Promise<ResultFrame> {
    if (this.#cancelled) return Promise.reject(new CancelledError());
    if (this.#closed) return Promise.reject(new ProtocolError("the WebSocket to the evaluator is closed"));

    const frame = JSON.stringify(message);
    if (Buffer.byteLength(frame, "utf8") > MAX_FRAME_BYTES) {
      return Promise.reject(new ProtocolError("refusing to send a frame larger than 16 MiB"));
    }

    const deferred = Promise.withResolvers<ResultFrame>();
    const id = String(message.id);
    const start = () => {
      this.#inflight += 1;
      const settle = () => {
        this.#inflight -= 1;
        const next = this.#queue.shift();
        if (next) next();
      };
      let timer: Timer | null = null;
      if (timeoutMs !== null) {
        timer = setTimeout(() => {
          const pending = this.#pending.get(id);
          if (!pending) return;
          this.#pending.delete(id);
          pending.settle();
          pending.reject(new ProtocolError(`request ${id} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }
      this.#pending.set(id, { resolve: deferred.resolve, reject: deferred.reject, timer, settle });
      try {
        this.#socket.send(frame);
      } catch (error) {
        const pending = this.#pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.#pending.delete(id);
          pending.settle();
        }
        deferred.reject(new ProtocolError(`send failed: ${String(error)}`));
      }
    };
    if (this.#inflight < MAX_INFLIGHT) start();
    else this.#queue.push(start);
    return deferred.promise;
  }

  #nextId(): string {
    this.#ids += 1;
    return `r${this.#ids}`;
  }

  /** Sends one request frame and waits for its matching result. */
  async request(message: Record<string, unknown>, timeoutMs: number | null): Promise<ResultFrame> {
    this.stats.requests += 1;
    const id = this.#nextId();
    return await this.#send({ ...message, id }, timeoutMs);
  }

  /** Runs `bash -c` inside the task container. */
  async exec(command: string, timeoutSec?: number): Promise<ExecResult> {
    const budget = this.secondsLeft();
    const cap = Math.max(
      1,
      Math.min(this.limits.exec_timeout_sec, budget === null ? this.limits.exec_timeout_sec : budget - 2),
    );
    const requested = timeoutSec === undefined ? Math.min(120, cap) : timeoutSec;
    const effective = Math.max(1, Math.min(requested, cap));
    this.stats.execs += 1;
    const result = await this.request(
      { type: "exec", command, timeout_sec: effective },
      (effective + 30) * 1000,
    );
    return {
      exit_code: result.exit_code,
      output: result.output,
      truncated: result.truncated,
      timed_out: result.timed_out,
      error: result.error,
    };
  }

  /** Reads a file from the task container. */
  async readFile(path: string): Promise<{ ok: boolean; bytes: Uint8Array; size: number; error: string | null }> {
    const result = await this.request({ type: "read_file", path }, 180_000);
    if (result.ok === false) {
      return { ok: false, bytes: new Uint8Array(), size: 0, error: result.error ?? "read failed" };
    }
    const bytes = Buffer.from(result.content_b64 ?? "", "base64");
    return { ok: true, bytes, size: result.size ?? bytes.byteLength, error: null };
  }

  /** Writes bytes to the task container, chunking to respect the 10 MB per-call cap. */
  async writeFile(path: string, data: Uint8Array | string, append = false): Promise<WriteResult> {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (bytes.byteLength === 0) {
      const result = await this.request({ type: "write_file", path, content_b64: "", append }, 180_000);
      return { ok: result.ok !== false, size: result.size ?? 0, error: result.error };
    }
    let offset = 0;
    let last: WriteResult = { ok: true, size: 0, error: null };
    while (offset < bytes.byteLength) {
      const chunk = bytes.subarray(offset, Math.min(offset + B64_CHUNK_BYTES, bytes.byteLength));
      const result = await this.request(
        {
          type: "write_file",
          path,
          content_b64: Buffer.from(chunk).toString("base64"),
          append: append || offset > 0,
        },
        180_000,
      );
      if (result.ok === false) return { ok: false, size: 0, error: result.error ?? "write failed" };
      last = { ok: true, size: result.size ?? 0, error: null };
      offset += chunk.byteLength;
    }
    return last;
  }

  /** Sends an HTTP request from inside the task container to a declared MCP server. */
  async http(request: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array | string;
    timeoutSec?: number;
  }): Promise<HttpResult> {
    const body = request.body === undefined
      ? undefined
      : typeof request.body === "string"
        ? Buffer.from(request.body, "utf8")
        : request.body;
    const timeoutSec = Math.max(1, Math.min(request.timeoutSec ?? 120, 600));
    const result = await this.request(
      {
        type: "http",
        url: request.url,
        method: request.method ?? "POST",
        headers: request.headers ?? {},
        body_b64: body ? Buffer.from(body).toString("base64") : undefined,
      },
      (timeoutSec + 30) * 1000,
    );
    if (result.ok === false) {
      return { ok: false, status: 0, headers: {}, body: new Uint8Array(), error: result.error ?? "http failed" };
    }
    return {
      ok: true,
      status: result.status ?? 0,
      headers: result.headers,
      body: Buffer.from(result.body_b64 ?? "", "base64"),
      error: null,
    };
  }

  // ---- one-way messages ----------------------------------------------------

  log(text: string): void {
    this.#oneWay({ type: "log", text: String(text).slice(0, 4000) });
  }

  usage(usage: { model: string | null; input: number; output: number; cacheRead: number }): void {
    const count = (value: number) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
    this.stats.modelCalls += 1;
    this.stats.inputTokens += count(usage.input);
    this.stats.outputTokens += count(usage.output);
    this.#oneWay({
      type: "usage",
      model: usage.model ?? null,
      input_tokens: count(usage.input),
      output_tokens: count(usage.output),
      cache_read_tokens: count(usage.cacheRead),
    });
  }

  done(finalMessage: string): void {
    this.#oneWay({ type: "done", final_message: finalMessage });
  }

  error(message: string): void {
    this.#oneWay({ type: "error", message: String(message).slice(0, 4000) });
  }

  #oneWay(message: Record<string, unknown>): void {
    if (this.#closed) return;
    this.#sentOneWay.push(message);
    try {
      this.#socket.send(JSON.stringify(message));
    } catch {
      // The socket is gone; the trial is already lost, and the caller still has
      // its own record of what happened.
    }
  }

  get sentOneWay(): readonly Record<string, unknown>[] {
    return this.#sentOneWay;
  }
}
