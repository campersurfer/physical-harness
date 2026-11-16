/**
 * Streamable-HTTP MCP client that reaches task application servers through the
 * evaluator's `http` request. Task servers are only reachable from inside the
 * task container, so this never opens a socket of its own.
 */

import { EvaluatorBridge, ProtocolError } from "./protocol";

export type McpTool = { name: string; description?: string; inputSchema?: unknown };

export type McpSession = {
  name: string;
  url: string;
  /** Header value the server returned from `initialize`, echoed on later calls. */
  sessionId: string | null;
  protocolVersion: string;
  nextId: number;
};

export class McpApplicationError extends Error {
  constructor(message: string, readonly code: unknown) {
    super(message);
    this.name = "McpApplicationError";
  }
}

const ACCEPT = "application/json, text/event-stream";

function parseSseOrJson(body: string, contentType: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;
  if (contentType.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload.length === 0 || payload === "[DONE]") continue;
      try {
        const parsed: unknown = JSON.parse(payload);
        if (parsed !== null && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return null;
}

async function rpc(
  bridge: EvaluatorBridge,
  session: McpSession,
  message: Record<string, unknown>,
  timeoutSec = 120,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: ACCEPT,
  };
  if (session.sessionId) headers["mcp-session-id"] = session.sessionId;
  if (session.protocolVersion) headers["mcp-protocol-version"] = session.protocolVersion;

  const response = await bridge.http({
    url: session.url,
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
    timeoutSec,
  });
  if (!response.ok) {
    throw new ProtocolError(`MCP ${session.name} request failed: ${response.error ?? "unknown error"}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ProtocolError(`MCP ${session.name} HTTP status ${response.status}`);
  }
  const returnedSession = headerValue(response.headers, "mcp-session-id");
  if (returnedSession) session.sessionId = returnedSession;
  const body = Buffer.from(response.body).toString("utf8");
  const parsed = parseSseOrJson(body, headerValue(response.headers, "content-type") ?? "");
  if (!parsed) {
    throw new ProtocolError(`MCP ${session.name} returned no JSON-RPC payload (status ${response.status})`);
  }
  const error = parsed.error;
  if (error !== null && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    throw new McpApplicationError(
      `MCP ${session.name} error: ${typeof message === "string" ? message : JSON.stringify(error)}`,
      (error as Record<string, unknown>).code,
    );
  }
  return parsed;
}

/** Initializes every declared task MCP server and returns its session state. */
export async function openMcpSessions(bridge: EvaluatorBridge): Promise<Map<string, McpSession>> {
  const sessions = new Map<string, McpSession>();
  for (const server of bridge.mcpServers) {
    bridge.signal.throwIfAborted();
    const session: McpSession = {
      name: server.name,
      url: server.url,
      sessionId: null,
      protocolVersion: "2025-06-18",
      nextId: 1,
    };
    const initialized = await rpc(bridge, session, {
      id: session.nextId++,
      method: "initialize",
      params: {
        protocolVersion: session.protocolVersion,
        capabilities: {},
        clientInfo: { name: "ple-omp2-harness", version: "0.1.0" },
      },
    });
    const result = initialized.result;
    if (result !== null && typeof result === "object") {
      const version = (result as Record<string, unknown>).protocolVersion;
      if (typeof version === "string") session.protocolVersion = version;
    }
    await bridge.http({
      url: session.url,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: ACCEPT,
        ...(session.sessionId ? { "mcp-session-id": session.sessionId } : {}),
        "mcp-protocol-version": session.protocolVersion,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      timeoutSec: 60,
    });
    sessions.set(server.name, session);
  }
  return sessions;
}

export async function listMcpTools(bridge: EvaluatorBridge, session: McpSession): Promise<McpTool[]> {
  const out: McpTool[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const response = await rpc(bridge, session, {
      id: session.nextId++, method: "tools/list", params: cursor ? { cursor } : {},
    });
    const result = response.result;
    if (result === null || typeof result !== "object") break;
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.tools)) {
      for (const entry of record.tools) {
        if (entry === null || typeof entry !== "object") continue;
        const tool = entry as Record<string, unknown>;
        if (typeof tool.name !== "string") continue;
        out.push({
          name: tool.name,
          description: typeof tool.description === "string" ? tool.description : undefined,
          inputSchema: tool.inputSchema,
        });
      }
    }
    cursor = typeof record.nextCursor === "string" && record.nextCursor.length > 0 ? record.nextCursor : undefined;
    if (cursor && cursors.has(cursor)) throw new ProtocolError(`MCP ${session.name} repeated tools/list cursor`);
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return out;
}

export async function callMcpTool(
  bridge: EvaluatorBridge,
  session: McpSession,
  tool: string,
  args: Record<string, unknown>,
  timeoutSec = 300,
): Promise<{ text: string; isError: boolean; details: Record<string, unknown> }> {
  const response = await rpc(
    bridge,
    session,
    { id: session.nextId++, method: "tools/call", params: { name: tool, arguments: args } },
    timeoutSec,
  );
  const result = response.result;
  const record = result !== null && typeof result === "object" ? result as Record<string, unknown> : {};
  const isError = record.isError === true;
  const parts: string[] = [];
  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      if (item === null || typeof item !== "object") continue;
      const content = item as Record<string, unknown>;
      if (typeof content.text === "string") parts.push(content.text);
      else if (content.type === "image") parts.push(`[image ${String(content.mimeType ?? "unknown")}]`);
      else parts.push(JSON.stringify(content));
    }
  } else {
    parts.push(JSON.stringify(result ?? response));
  }
  return {
    text: parts.join("\n"),
    isError,
    details: { transport: "ok", outcome: isError ? "application_error" : "success", mcp_is_error: isError },
  };
}
