/**
 * Host-owned tools exposed to the agent.
 *
 * Every tool acts inside the task container through the evaluator; nothing here
 * touches the harness container's own filesystem, because that filesystem is not
 * the task's. Names are prefixed so they can never collide with OMP built-ins,
 * and the session is restricted to exactly this list (see src/omp.ts).
 */

import { z, type CustomTool } from "@oh-my-pi/pi-coding-agent";
import { CancelledError, EvaluatorBridge, ProtocolError } from "./protocol";
import { callMcpTool, listMcpTools, type McpSession } from "./mcp";

const TEXT_HEAD = 24_000;
const TEXT_TAIL = 6_000;

function isBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 4096));
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

function clipText(text: string): string {
  if (text.length <= TEXT_HEAD + TEXT_TAIL) return text;
  const cut = text.length - TEXT_HEAD - TEXT_TAIL;
  return `${text.slice(0, TEXT_HEAD)}\n[... ${cut} characters cut by the harness ...]\n${text.slice(-TEXT_TAIL)}`;
}

function describeFailure(error: unknown): { text: string; isError: boolean } {
  if (error instanceof CancelledError) {
    return { text: "The evaluator cancelled this task; stop and summarize what exists now.", isError: true };
  }
  if (error instanceof ProtocolError) {
    return { text: `Protocol error: ${error.message}`, isError: true };
  }
  return { text: `Tool failure: ${String(error)}`, isError: true };
}

export function createTools(bridge: EvaluatorBridge, mcpSessions: Map<string, McpSession>): CustomTool[] {
  const exec: CustomTool = {
    name: "ple_exec",
    label: "Run a shell command in the task container",
    description:
      "Run `bash -c <command>` inside the task project container. File changes persist; `cd` and exported variables do not. Returns the exit code and combined stdout/stderr.",
    parameters: z.object({
      command: z.string().describe("Shell command to run"),
      timeout_sec: z.number().optional().describe("Seconds to allow (default 120, capped by the task)"),
    }),
    async execute(_toolCallId, { command, timeout_sec }, _onUpdate, _context, signal) {
      try {
        if (signal?.aborted) throw new CancelledError("tool call aborted");
        const result = await bridge.exec(command, timeout_sec ?? undefined);
        const parts = [`exit_code: ${result.exit_code ?? "null"}`];
        if (result.timed_out) parts.push("timed_out: true");
        if (result.truncated) parts.push("output truncated by the evaluator");
        if (result.error) parts.push(`error: ${result.error}`);
        const output = result.output.length > 0 ? result.output : "(no output)";
        return { content: [{ type: "text", text: `${parts.join(" | ")}\n${clipText(output)}` }] };
      } catch (error) {
        const failure = describeFailure(error);
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError };
      }
    },
  };

  const readFile: CustomTool = {
    name: "ple_read_file",
    label: "Read a file from the task container",
    description:
      "Read a text file from the task container. Large files are clipped in the middle; use ple_exec (head/sed/grep) for exact slices or binary formats.",
    parameters: z.object({
      path: z.string().describe("Absolute path, or a path relative to the task workdir"),
      offset: z.number().optional().describe("Character offset to start from"),
      limit: z.number().optional().describe("Maximum characters to return"),
    }),
    async execute(_toolCallId, { path, offset, limit }, _onUpdate, _context, signal) {
      try {
        if (signal?.aborted) throw new CancelledError("tool call aborted");
        const result = await bridge.readFile(path);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Could not read ${path}: ${result.error}` }], isError: true };
        }
        if (isBinary(result.bytes)) {
          return {
            content: [
              {
                type: "text",
                text: `${path} is binary (${result.size} bytes). Use ple_exec with a converter (e.g. pdftotext, python) instead.`,
              },
            ],
          };
        }
        const text = Buffer.from(result.bytes).toString("utf8");
        const start = offset === undefined ? 0 : Math.max(0, Math.min(offset, text.length));
        const end = limit === undefined ? text.length : Math.min(text.length, start + Math.max(0, limit));
        const slice = text.slice(start, end);
        const header = `bytes: ${result.size} | showing characters ${start}..${end}`;
        return { content: [{ type: "text", text: `${header}\n${clipText(slice)}` }] };
      } catch (error) {
        const failure = describeFailure(error);
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError };
      }
    },
  };

  const writeFile: CustomTool = {
    name: "ple_write_file",
    label: "Write a file into the task container",
    description:
      "Create or overwrite a deliverable file in the task container. Parent directories are created. Large content is chunked automatically.",
    parameters: z.object({
      path: z.string().describe("Absolute path, or a path relative to the task workdir"),
      content: z.string().describe("File content (UTF-8)"),
      append: z.boolean().optional().describe("Append instead of overwriting"),
    }),
    async execute(_toolCallId, { path, content, append }, _onUpdate, _context, signal) {
      try {
        if (signal?.aborted) throw new CancelledError("tool call aborted");
        const result = await bridge.writeFile(path, content, append === true);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Could not write ${path}: ${result.error}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Wrote ${content.length} characters to ${path}` }] };
      } catch (error) {
        const failure = describeFailure(error);
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError };
      }
    },
  };

  const mcp: CustomTool = {
    name: "ple_mcp",
    label: "Call a task MCP application",
    description:
      "Use the task's application servers (documents, spreadsheets, mail, calendar, CAD). action=list returns the available tools for a server; action=call invokes one with JSON arguments.",
    parameters: z.object({
      action: z.enum(["list", "call", "servers"]).describe("servers: list available servers; list: enumerate a server's tools; call: invoke one"),
      server: z.string().optional().describe("Server name from the task message"),
      tool: z.string().optional().describe("Tool name for action=call"),
      arguments: z.string().optional().describe("JSON object string of tool arguments"),
    }),
    async execute(_toolCallId, { action, server, tool, arguments: rawArguments }, _onUpdate, _context, signal) {
      try {
        if (signal?.aborted) throw new CancelledError("tool call aborted");
        if (action === "servers") {
          const listing = bridge.mcpServers.map((entry) => ({ name: entry.name, url: entry.url }));
          return { content: [{ type: "text", text: JSON.stringify(listing) }] };
        }
        if (!server) return { content: [{ type: "text", text: "server is required" }], isError: true };
        const session = mcpSessions.get(server);
        if (!session) return { content: [{ type: "text", text: `unknown server: ${server}` }], isError: true };
        if (action === "list") {
          const tools = await listMcpTools(bridge, session);
          const rendered = tools.map((entry) => ({ name: entry.name, description: entry.description ?? "" }));
          return { content: [{ type: "text", text: clipText(JSON.stringify(rendered)) }] };
        }
        if (!tool) return { content: [{ type: "text", text: "tool is required" }], isError: true };
        let parsedArguments: Record<string, unknown> = {};
        if (rawArguments && rawArguments.trim().length > 0) {
          const parsed: unknown = JSON.parse(rawArguments);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { content: [{ type: "text", text: "arguments must be a JSON object" }], isError: true };
          }
          parsedArguments = parsed as Record<string, unknown>;
        }
        const result = await callMcpTool(bridge, session, tool, parsedArguments);
        return { content: [{ type: "text", text: clipText(result) }], isError: false };
      } catch (error) {
        const failure = describeFailure(error);
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError };
      }
    },
  };

  return [exec, readFile, writeFile, mcp];
}
