#!/usr/bin/env python3
"""Scripted OpenAI-compatible model for LOCAL checks only.

The competition entry never uses this. It is an external stand-in for a real
model so that `kit up` / `kit check` can run the entry's *real provider path*
(HTTP through the kit's egress proxy to MODEL_PROXY_URL) without a model key.
The harness still performs real protocol requests, which the local evaluator
answers.

The script reacts to the conversation it receives, the way a model would:

* a task that asks for ``/app/hello.txt`` writes that file (the kit smoke task);
* a task whose app servers are reachable lists and calls one of their tools
  (the kit MCP task);
* anything else writes ``results/deliverable.md`` and verifies it.

Usage:
    python3 test/stub-model.py [port]
"""

from __future__ import annotations

import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DELIVERABLE = "results/deliverable.md"
SMOKE_FILE = "/app/hello.txt"

state = {"turn": 0}


def tool_call(name: str, arguments: dict) -> dict:
    state["turn"] += 1
    return {
        "id": f"call_{state['turn']}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


def latest_tool_result(messages: list[dict]) -> tuple[str, str]:
    """Returns (tool_name, text) for the most recent tool result in the conversation."""
    for message in reversed(messages):
        role = str(message.get("role", ""))
        if role not in {"tool", "toolResult", "function"}:
            continue
        name = str(message.get("name") or message.get("toolName") or "")
        content = message.get("content")
        text = ""
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = "\n".join(str(block.get("text", "")) for block in content if isinstance(block, dict))
        return name, text
    return "", ""


def instruction_text(messages: list[dict]) -> str:
    for message in messages:
        if str(message.get("role")) == "user":
            content = message.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return "\n".join(str(block.get("text", "")) for block in content if isinstance(block, dict))
    return ""


def next_message(messages: list[dict]) -> dict:
    """Decides the next assistant turn from the conversation so far."""
    instruction = instruction_text(messages)
    _, tool_text = latest_tool_result(messages)
    calls_for = sum(1 for message in messages if message.get("role") == "assistant")

    # The kit's smoke task: one file with exactly the requested content.
    if "hello.txt" in instruction:
        if calls_for == 0:
            return {
                "tool_calls": [
                    tool_call(
                        "ple_exec",
                        {"command": "printf 'HELLO\\n' > /app/hello.txt && cat /app/hello.txt"},
                    )
                ]
            }
        return {"content": "done"}

    # The kit's MCP task: the word comes from a tool on the task's app server.
    if "mcp.txt" in instruction or "secret_word" in instruction:
        if calls_for == 0:
            return {
                "tool_calls": [
                    tool_call("ple_mcp", {"action": "call", "server": "apps", "tool": "secret_word", "arguments": "{}"})
                ]
            }
        word = tool_text.strip().splitlines()[0].strip() if tool_text.strip() else ""
        if calls_for == 1:
            return {
                "tool_calls": [
                    tool_call("ple_write_file", {"path": "/app/mcp.txt", "content": f"{word}\n"})
                ]
            }
        return {"content": "done"}

    # Anything else: write and verify a deliverable, as a dev-set task would.
    if calls_for == 0:
        return {"tool_calls": [tool_call("ple_exec", {"command": "mkdir -p results && ls -la"})]}
    if calls_for == 1:
        return {
            "tool_calls": [
                tool_call(
                    "ple_write_file",
                    {
                        "path": DELIVERABLE,
                        "content": "# Deliverable\n\nComputed total: 42 kN\nSource: stub-model script\n",
                    },
                )
            ]
        }
    if calls_for == 2:
        return {"tool_calls": [tool_call("ple_check_deliverables", {"paths": [DELIVERABLE]})]}
    return {"content": f"Wrote {DELIVERABLE} and checked it with ple_check_deliverables."}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # /v1/models and anything else
        self._json({"object": "list", "data": [{"id": "stub-model", "object": "model"}]})

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            request = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            request = {}
        messages = request.get("messages") if isinstance(request.get("messages"), list) else []
        step = next_message([m for m in messages if isinstance(m, dict)])
        call_id = f"chatcmpl-stub-{state['turn']}"
        with open("/tmp/stub-requests.log", "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "stream": bool(request.get("stream")),
                        "messages": len(messages),
                        "roles": [str(m.get("role")) for m in messages if isinstance(m, dict)][:6],
                        "choice": "tool_calls" if step.get("tool_calls") else "text",
                    }
                )
                + "\n"
            )
        if request.get("stream"):
            self._stream(call_id, request.get("model", "stub-model"), step)
            return
        message = {"role": "assistant", "content": step.get("content"), "tool_calls": step.get("tool_calls")}
        self._json(
            {
                "id": call_id,
                "object": "chat.completion",
                "created": 0,
                "model": request.get("model", "stub-model"),
                "choices": [
                    {"index": 0, "message": message, "finish_reason": "tool_calls" if step.get("tool_calls") else "stop"}
                ],
                "usage": {"prompt_tokens": 1200, "completion_tokens": 40, "total_tokens": 1240},
            }
        )

    def _stream(self, call_id: str, model: str, step: dict) -> None:
        """Emits the same content as SSE deltas, which is what streamed clients expect."""
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("connection", "keep-alive")
        self.end_headers()

        def chunk(delta: dict, finish: str | None = None) -> None:
            payload = {
                "id": call_id,
                "object": "chat.completion.chunk",
                "created": 0,
                "model": model,
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())
            self.wfile.flush()

        chunk({"role": "assistant", "content": ""})
        usage = {"prompt_tokens": 1200, "completion_tokens": 40, "total_tokens": 1240}
        if step.get("tool_calls"):
            for index, call in enumerate(step["tool_calls"]):
                chunk(
                    {
                        "tool_calls": [
                            {
                                "index": index,
                                "id": call["id"],
                                "type": "function",
                                "function": {"name": call["function"]["name"], "arguments": ""},
                            }
                        ]
                    }
                )
                chunk({"tool_calls": [{"index": index, "function": {"arguments": call["function"]["arguments"]}}]})
            chunk({}, "tool_calls")
        else:
            for piece in [str(step.get("content") or "")]:
                chunk({"content": piece})
            chunk({}, "stop")
        # Clients that ask for usage in the stream get their own final chunk, the
        # way OpenAI-compatible gateways send it; without this the harness has
        # nothing to report and cost accounting cannot be rehearsed.
        usage_chunk = {
            "id": call_id,
            "object": "chat.completion.chunk",
            "created": 0,
            "model": model,
            "choices": [],
            "usage": usage,
        }
        self.wfile.write(f"data: {json.dumps(usage_chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, *args: object) -> None:  # keep the kit logs readable
        return


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4123
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"stub model listening on 0.0.0.0:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
