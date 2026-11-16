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
import { callMcpTool, listMcpTools, McpApplicationError, type McpSession } from "./mcp";

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

function describeFailure(error: unknown) {
  if (error instanceof CancelledError) {
    return {
      text: "The evaluator cancelled this task; stop and summarize what exists now.",
      isError: true, details: { outcome: "cancelled", transport: "cancelled" },
    };
  }
  if (error instanceof McpApplicationError) {
    return {
      text: error.message, isError: true,
      details: { outcome: "application_error", transport: "ok", source: "mcp_rpc", code: error.code },
    };
  }
  return {
    text: `${error instanceof ProtocolError ? "Protocol error" : "Tool failure"}: ${String(error)}`,
    isError: true,
    details: { outcome: error instanceof ProtocolError ? "transport_error" : "harness_error", transport: "failed" },
  };
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
        return {
          content: [{ type: "text", text: `${parts.join(" | ")}\n${clipText(output)}` }],
          isError: result.error !== null || result.timed_out,
          details: {
            transport: result.error ? "failed" : "ok",
            outcome: result.error ? "transport_error" : result.timed_out ? "process_timeout" : "process_exit",
            exit_code: result.exit_code,
            timed_out: result.timed_out,
            truncated: result.truncated,
            error: result.error,
            user_goal_outcome: "not_adjudicated",
          },
        };
      } catch (error) {
        const failure = describeFailure(error);
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError, details: failure.details };
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
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError, details: failure.details };
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
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError, details: failure.details };
      }
    },
  };

  const checkDeliverables: CustomTool = {
    name: "ple_check_deliverables",
    label: "Check the deliverable contract",
    description:
      "Before you finish: verify every deliverable the task asked for exists, is non-empty, and looks like the format it claims to be. Reports one verdict per path; fix anything it flags.",
    parameters: z.object({
      paths: z.array(z.string()).describe("Deliverable paths (files or folders) named in the instruction"),
    }),
    async execute(_toolCallId, { paths }, _onUpdate, _context, signal) {
      try {
        if (signal?.aborted) throw new CancelledError("tool call aborted");
        if (paths.length === 0) return { content: [{ type: "text", text: "no paths given" }], isError: true };

        // One round trip gathers existence, kind and size for every path.
        const quoted = paths.map((path) => `'${path.replaceAll("'", `'\\''`)}'`).join(" ");
        const listing = await bridge.exec(
          `for p in ${quoted}; do if [ -d "$p" ]; then n=$(find "$p" -type f 2>/dev/null | wc -l); printf 'DIR\\t%s\\t%s\\n' "$p" "$n"; elif [ -f "$p" ]; then printf 'FILE\\t%s\\t%s\\n' "$p" "$(wc -c < "$p" | tr -d ' ')"; else printf 'MISSING\\t%s\\t0\\n' "$p"; fi; done`,
          60,
        );
        if (listing.error) throw new ProtocolError(listing.error);

        const rows = listing.output
          .split("\n")
          .map((line) => line.split("\t"))
          .filter((fields) => fields.length >= 3 && (fields[0] === "FILE" || fields[0] === "DIR" || fields[0] === "MISSING"));
        if (rows.length === 0) {
          // A checker that cannot parse its own listing must say so, never report success.
          return {
            content: [
              {
                type: "text",
                text: `Could not read the deliverable listing (exit_code=${String(listing.exit_code)}). Output was:\n${listing.output.slice(0, 500)}`,
              },
            ],
            isError: true,
          };
        }

        const verdicts: string[] = [];
        let problems = 0;
        for (const [kind, path, rawSize] of rows) {
          const size = Number(rawSize ?? "0");
          if (kind === "MISSING") {
            problems += 1;
            verdicts.push(`MISSING  ${path} — the task asked for this; create it`);
            continue;
          }
          if (kind === "DIR") {
            const isEmpty = size === 0;
            if (isEmpty) problems += 1;
            verdicts.push(`${isEmpty ? "EMPTY   " : "ok      "} ${path} — directory with ${size} file(s)`);
            continue;
          }
          const extension = (path.split(".").pop() ?? "").toLowerCase();
          const head = await bridge.readFile(path).catch(() => null);
          const bytes = head?.bytes ?? new Uint8Array();
          const text = Buffer.from(bytes.subarray(0, 4096)).toString("utf8");
          const detail: string[] = [];
          if (size === 0) {
            problems += 1;
            detail.push("empty file");
          }
          if (extension === "json") {
            try {
              JSON.parse(Buffer.from(bytes).toString("utf8"));
            } catch {
              problems += 1;
              detail.push("does not parse as JSON");
            }
          } else if (extension === "csv") {
            const lines = Buffer.from(bytes).toString("utf8").split(/\r?\n/).filter((row) => row.trim().length > 0);
            if (lines.length < 2) {
              problems += 1;
              detail.push("fewer than two rows");
            } else {
              const expected = lines[0].split(",").length;
              const ragged = lines.filter((row) => row.split(",").length !== expected).length;
              if (ragged > 0) detail.push(`${ragged} row(s) with a different column count`);
            }
          } else if (extension === "pdf") {
            if (!text.startsWith("%PDF")) {
              problems += 1;
              detail.push("does not start with %PDF");
            }
          } else if (extension === "docx" || extension === "xlsx" || extension === "pptx") {
            if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
              problems += 1;
              detail.push(`not a zip container, so not a real .${extension}`);
            }
          } else if (text.trim().length === 0) {
            problems += 1;
            detail.push("no readable text");
          }
          const preview = text.replaceAll("\n", " ").slice(0, 120);
          verdicts.push(
            `${detail.length > 0 ? "FAIL    " : "ok      "} ${path} — ${size} bytes${detail.length > 0 ? ` | ${detail.join("; ")}` : ""}\n          first bytes: ${preview}`,
          );
        }
        const header = problems === 0 ? "all deliverables look present" : `${problems} problem(s) to fix`;
        return { content: [{ type: "text", text: `${header}\n${verdicts.join("\n")}` }] };
      } catch (error) {
        const failure = describeFailure(error);
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError, details: failure.details };
      }
    },
  };

  const mcp: CustomTool = {
    name: "ple_mcp",
    label: "Call a task MCP application",
    description:
      "Use the task's application servers. action=list gives a compact paginated index (query searches names/descriptions); action=schema returns one tool's complete input schema; action=call invokes it.",
    parameters: z.object({
      action: z.enum(["list", "schema", "call", "servers"]).describe("Discover tools, retrieve a selected schema, or invoke a tool"),
      server: z.string().optional().describe("Server name from the task message"),
      tool: z.string().optional().describe("Tool name for action=schema or action=call"),
      arguments: z.string().optional().describe("JSON object string of tool arguments"),
      offset: z.number().int().nonnegative().optional().describe("Index into matching tools (default 0)"),
      limit: z.number().int().min(1).max(25).optional().describe("Index page size (default 20, max 25)"),
      query: z.string().optional().describe("Case-insensitive substring to search tool names and descriptions"),
    }),
    async execute(_toolCallId, { action, server, tool, arguments: rawArguments, offset, limit, query }, _onUpdate, _context, signal) {
      try {
        if (signal?.aborted) throw new CancelledError("tool call aborted");
        if (action === "servers") {
          const listing = bridge.mcpServers.map((entry) => ({ name: entry.name, url: entry.url }));
          return { content: [{ type: "text", text: JSON.stringify(listing) }] };
        }
        if (!server) return { content: [{ type: "text", text: "server is required" }], isError: true };
        const session = mcpSessions.get(server);
        if (!session) return { content: [{ type: "text", text: `unknown server: ${server}` }], isError: true };
        if (action === "list" || action === "schema") {
          const tools = await listMcpTools(bridge, session);
          if (action === "schema") {
            const selected = tools.find((entry) => entry.name === tool);
            if (!selected) return { content: [{ type: "text", text: `unknown tool: ${String(tool)}` }], isError: true };
            // Selected schemas are intentionally complete, never middle-clipped.
            return { content: [{ type: "text", text: JSON.stringify(selected) }] };
          }
          const search = query?.toLowerCase() ?? "";
          const matches = search ? tools.filter((entry) =>
            entry.name.toLowerCase().includes(search) || entry.description?.toLowerCase().includes(search)) : tools;
          const start = offset ?? 0;
          const page = matches.slice(start, start + (limit ?? 20));
          const next = start + page.length;
          const rendered = {
            total: matches.length,
            offset: start,
            next_offset: next < matches.length ? next : null,
            tools: page.map((entry) => ({ name: entry.name, description: (entry.description ?? "").slice(0, 240) })),
          };
          return { content: [{ type: "text", text: JSON.stringify(rendered) }] };
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
        return {
          content: [{ type: "text", text: clipText(result.text) }],
          isError: result.isError,
          details: result.details,
        };
      } catch (error) {
        const failure = describeFailure(error);
        return { content: [{ type: "text", text: failure.text }], isError: failure.isError, details: failure.details };
      }
    },
  };

  return [exec, readFile, writeFile, checkDeliverables, mcp];
}
