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
    throw new ProtocolError(`MCP ${session.name} error: ${typeof message === "string" ? message : JSON.stringify(error)}`);
  }
  return parsed;
}

/** Initializes every declared task MCP server and returns its session state. */
export async function openMcpSessions(bridge: EvaluatorBridge): Promise<Map<string, McpSession>> {
  const sessions = new Map<string, McpSession>();
  for (const server of bridge.mcpServers) {
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
  const response = await rpc(bridge, session, { id: session.nextId++, method: "tools/list", params: {} });
  const result = response.result;
  if (result === null || typeof result !== "object") return [];
  const tools = (result as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) return [];
  const out: McpTool[] = [];
  for (const entry of tools) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== "string") continue;
    const description = record.description;
    out.push({
      name,
      description: typeof description === "string" ? description : undefined,
      inputSchema: record.inputSchema,
    });
  }
  return out;
}

export async function callMcpTool(
  bridge: EvaluatorBridge,
  session: McpSession,
  tool: string,
  args: Record<string, unknown>,
  timeoutSec = 300,
): Promise<string> {
  const response = await rpc(
    bridge,
    session,
    { id: session.nextId++, method: "tools/call", params: { name: tool, arguments: args } },
    timeoutSec,
  );
  const result = response.result;
  if (result === null || typeof result !== "object") return JSON.stringify(response);
  const content = (result as Record<string, unknown>).content;
  if (!Array.isArray(content)) return JSON.stringify(result);
  const parts: string[] = [];
  for (const item of content) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.text === "string") parts.push(record.text);
    else if (record.type === "image") parts.push(`[image ${String(record.mimeType ?? "unknown")}]`);
    else parts.push(JSON.stringify(record));
  }
  return parts.join("\n");
}
