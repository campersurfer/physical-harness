/**
 * Local evaluator fixture: the other end of protocol v1.
 *
 * It plays the evaluator's role over a real WebSocket against a real harness
 * process, executing requests against a real temporary workdir. Two entry
 * points:
 *
 *   runScenario()    - starts serve.ts itself (fast local iteration)
 *   runAgainstUrl()  - drives a harness that is already running, e.g. the real
 *                      serve container started by `kit up`
 *
 * Neither is a substitute for `kit check`, which is the authority for the
 * container contract and the score.
 */

import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const MAX_OUTPUT_BYTES = 100_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type Frame = Record<string, unknown>;

export type ScenarioResult = {
  frames: Frame[];
  oneWay: Frame[];
  workdir: string;
  stderr: string;
  doneReceived: boolean;
  finalFrame: Frame;
  errorFrames: Frame[];
  usageFrames: Frame[];
  logs: string[];
  cleanup: () => Promise<void>;
};

export type ScenarioOptions = {
  scenario?: "basic" | "slow" | "mcp" | "deliverables" | "long" | "checkpoint";
  instruction?: string;
  limits?: { agent_timeout_sec: number | null; exec_timeout_sec: number };
  cancelAfterFirstRequest?: boolean;
  doneTimeoutMs?: number;
  /** Keep the temporary workdir instead of removing it during cleanup. */
  keepWorkdir?: boolean;
};

function resolveTaskPath(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workdir, path);
}

async function runShell(workdir: string, command: string, timeoutSec: number) {
  const proc = Bun.spawn(["bash", "-c", command], {
    cwd: workdir,
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: workdir },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutSec * 1000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  const combined = `${stdout}${stderr}`;
  let output = combined;
  let truncated = false;
  if (Buffer.byteLength(combined, "utf8") > MAX_OUTPUT_BYTES) {
    const bytes = Buffer.from(combined, "utf8");
    const head = bytes.subarray(0, MAX_OUTPUT_BYTES / 2).toString("utf8");
    const tail = bytes.subarray(bytes.byteLength - MAX_OUTPUT_BYTES / 2).toString("utf8");
    output = `${head}\n[... truncated ...]\n${tail}`;
    truncated = true;
  }
  return { exit_code: timedOut ? 124 : exitCode, output, truncated, timed_out: timedOut };
}

/** Minimal Streamable-HTTP MCP server used by the `mcp` scenario. */
export function startMcpFixture(): { url: string; stop: () => void; calls: Frame[] } {
  const calls: Frame[] = [];
  let sessionIssued = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.text();
      if (body.trim().length === 0) return new Response(null, { status: 202 });
      const message = JSON.parse(body) as Frame;
      const id = message.id;
      if (id === undefined) return new Response(null, { status: 202 });
      const method = String(message.method ?? "");
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      };
      if (method === "initialize") {
        sessionIssued += 1;
        headers["mcp-session-id"] = `fixture-session-${sessionIssued}`;
        return Response.json(
          {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture-apps", version: "0.0.1" },
            },
          },
          { headers },
        );
      }
      if (method === "tools/list") {
        return Response.json(
          {
            jsonrpc: "2.0",
            id,
            result: {
              tools: [
                {
                  name: "lookup_section",
                  description: "Return the recorded subtotal for one estimate section",
                  inputSchema: { type: "object", properties: { section: { type: "string" } }, required: ["section"] },
                },
              ],
            },
          },
          { headers },
        );
      }
      if (method === "tools/call") {
        calls.push(message);
        const params = (message.params ?? {}) as Frame;
        const args = (params.arguments ?? {}) as Frame;
        return Response.json(
          {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ section: args.section ?? null, subtotal: 1303717.7, currency: "USD" }),
                },
              ],
            },
          },
          { headers },
        );
      }
      return Response.json(
        { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } },
        { headers },
      );
    },
  });
  return { url: `http://127.0.0.1:${server.port}/mcp/`, stop: () => server.stop(true), calls };
}

function waitForOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  const deferred = Promise.withResolvers<void>();
  const timer = setTimeout(() => deferred.reject(new Error("WebSocket to the harness never opened")), timeoutMs);
  socket.addEventListener("open", () => {
    clearTimeout(timer);
    deferred.resolve();
  });
  socket.addEventListener("error", () => {
    clearTimeout(timer);
    deferred.reject(new Error("WebSocket to the harness failed"));
  });
  return deferred.promise;
}

/**
 * Drives a running harness: sends one task and answers its requests by executing
 * them in a temporary workdir on this machine.
 */
export async function runAgainstUrl(url: string, options: ScenarioOptions = {}): Promise<ScenarioResult> {
  const scenario = options.scenario ?? "basic";
  const instruction =
    options.instruction ??
    "Review the estimate folder and produce results/deliverable.md with the corrected subtotal. Cite the sheet each number comes from.";
  const workdir = await mkdtemp(join(tmpdir(), "ple-fixture-"));
  const mcp = scenario === "mcp" ? startMcpFixture() : null;

  const frames: Frame[] = [];
  const oneWay: Frame[] = [];
  const doneDeferred = Promise.withResolvers<Frame>();
  let cancelled = false;

  const socket = new WebSocket(url);
  socket.addEventListener("message", (event) => {
    void (async () => {
      const frame = JSON.parse(String(event.data)) as Frame;
      if (frame.type === "done" || frame.type === "error") {
        oneWay.push(frame);
        doneDeferred.resolve(frame);
        return;
      }
      if (frame.type === "log" || frame.type === "usage") {
        oneWay.push(frame);
        return;
      }
      if (frame.type !== "exec" && frame.type !== "read_file" && frame.type !== "write_file" && frame.type !== "http") {
        return;
      }
      frames.push(frame);
      if (options.cancelAfterFirstRequest && !cancelled) {
        cancelled = true;
        socket.send(JSON.stringify({ type: "cancel", reason: "timeout" }));
      }
      const id = frame.id;
      const reply = (result: Frame) => socket.send(JSON.stringify({ type: "result", id, ...result }));
      const path = typeof frame.path === "string" ? frame.path : "";
      try {
        if (frame.type === "exec") {
          const result = await runShell(workdir, String(frame.command ?? ""), Number(frame.timeout_sec ?? 120));
          reply(result);
          return;
        }
        if (frame.type === "read_file") {
          const target = resolveTaskPath(workdir, path);
          const info = await stat(target).catch(() => null);
          if (!info || !info.isFile()) {
            reply({ ok: false, error: `not a regular file: ${path}` });
            return;
          }
          const bytes = await readFile(target);
          reply({
            ok: true,
            content_b64: Buffer.from(bytes.subarray(0, MAX_FILE_BYTES)).toString("base64"),
            size: bytes.byteLength,
            truncated: bytes.byteLength > MAX_FILE_BYTES,
          });
          return;
        }
        if (frame.type === "write_file") {
          const target = resolveTaskPath(workdir, path);
          await mkdir(dirname(target), { recursive: true });
          const data = Buffer.from(String(frame.content_b64 ?? ""), "base64");
          if (frame.append === true) {
            const existing = await readFile(target).catch(() => Buffer.alloc(0));
            await Bun.write(target, Buffer.concat([existing, data]));
          } else {
            await Bun.write(target, data);
          }
          const info = await stat(target);
          reply({ ok: true, size: info.size });
          return;
        }
        const requestUrl = String(frame.url ?? "");
        if (!mcp || !requestUrl.startsWith(new URL(mcp.url).origin)) {
          reply({ ok: false, error: `url is not one of the task's MCP servers: ${requestUrl}` });
          return;
        }
        const body = frame.body_b64 ? Buffer.from(String(frame.body_b64), "base64") : undefined;
        const response = await fetch(requestUrl, {
          method: String(frame.method ?? "POST"),
          headers: (frame.headers ?? {}) as Record<string, string>,
          body,
        });
        const responseBody = Buffer.from(await response.arrayBuffer());
        const headerRecord: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headerRecord[key] = value;
        });
        reply({
          ok: true,
          status: response.status,
          headers: headerRecord,
          body_b64: responseBody.toString("base64"),
          truncated: false,
        });
      } catch (error) {
        reply({ ok: false, error: String(error) });
      }
    })();
  });

  await waitForOpen(socket, 20_000);
  socket.send(
    JSON.stringify({
      type: "task",
      protocol: 1,
      session: "fixture-session",
      instruction,
      workdir,
      limits: {
        agent_timeout_sec: options.limits?.agent_timeout_sec ?? 900,
        exec_timeout_sec: options.limits?.exec_timeout_sec ?? 600,
        max_output_bytes: MAX_OUTPUT_BYTES,
        max_write_bytes: MAX_FILE_BYTES,
      },
      mcp_servers: mcp ? [{ name: "apps", url: mcp.url, transport: "streamable-http" }] : [],
    }),
  );

  const doneBounded = Promise.withResolvers<Frame>();
  const timer = setTimeout(
    () => doneBounded.reject(new Error(`the harness never sent done/error within ${options.doneTimeoutMs ?? 90_000} ms`)),
    options.doneTimeoutMs ?? 90_000,
  );
  let finalFrame: Frame;
  try {
    finalFrame = await Promise.race([doneDeferred.promise, doneBounded.promise]);
  } finally {
    clearTimeout(timer);
  }

  const cleanup = async () => {
    socket.close();
    mcp?.stop();
    if (!options.keepWorkdir) await rm(workdir, { recursive: true, force: true });
  };

  return {
    frames,
    oneWay,
    workdir,
    stderr: "",
    doneReceived: finalFrame.type === "done",
    finalFrame,
    errorFrames: oneWay.filter((frame) => frame.type === "error"),
    usageFrames: oneWay.filter((frame) => frame.type === "usage"),
    logs: oneWay.filter((frame) => frame.type === "log").map((frame) => String(frame.text ?? "")),
    cleanup,
  };
}

/** Starts the repository's own serve.ts and drives it. */
export async function runScenario(options: ScenarioOptions = {}): Promise<ScenarioResult> {
  const scenario = options.scenario ?? "basic";
  const stderrChunks: string[] = [];
  const port = 21_000 + Math.floor(Math.random() * 8_000);
  const repoRoot = new URL("..", import.meta.url).pathname;

  const proc = Bun.spawn([process.execPath, join(repoRoot, "serve.ts")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      PLE_LOG_LEVEL: "silent",
      PLE_TEST_MODEL_MODULE: new URL("./mock-model.ts", import.meta.url).href,
      PLE_TEST_SCRIPT: scenario,
      MODEL_NAME: "claude-opus-5-5",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  void (async () => {
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      stderrChunks.push(Buffer.from(chunk).toString("utf8"));
    }
  })();

  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: { data() {}, open() {}, error() {}, close() {} },
      });
      socket.end();
      ready = true;
      break;
    } catch {
      await Bun.sleep(120);
    }
  }
  if (!ready) {
    proc.kill();
    throw new Error(`harness did not accept a connection on port ${port}\n--- stderr ---\n${stderrChunks.join("")}`);
  }

  const result = await runAgainstUrl(`ws://127.0.0.1:${port}/`, options);
  return {
    ...result,
    stderr: stderrChunks.join(""),
    cleanup: async () => {
      proc.kill();
      await result.cleanup();
    },
  };
}
