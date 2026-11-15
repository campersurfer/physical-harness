#!/usr/bin/env python3
"""Scripted OpenAI-compatible model for LOCAL container checks only.

The competition entry never uses this: it is an external stand-in for a real
model so that `kit up` can run the *real provider path* (HTTP through the kit's
egress proxy to MODEL_PROXY_URL) without a model key. The harness still performs
real protocol requests, which the container check answers.

Usage:
    python3 test/stub-model.py 4123
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DELIVERABLE = "results/deliverable.md"

# One assistant message per call; tool arguments are JSON strings, as the OpenAI
# Chat Completions API returns them.
SCRIPT: list[dict] = [
    {
        "tool_calls": [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "ple_exec", "arguments": json.dumps({"command": "mkdir -p results && ls -la"})},
            }
        ]
    },
    {
        "tool_calls": [
            {
                "id": "call_2",
                "type": "function",
                "function": {
                    "name": "ple_write_file",
                    "arguments": json.dumps(
                        {
                            "path": DELIVERABLE,
                            "content": "# Deliverable\n\nComputed total: 42 kN\nSource: stub-model script\n",
                        }
                    ),
                },
            }
        ]
    },
    {
        "tool_calls": [
            {
                "id": "call_3",
                "type": "function",
                "function": {
                    "name": "ple_check_deliverables",
                    "arguments": json.dumps({"paths": [DELIVERABLE]}),
                },
            }
        ]
    },
    {"content": f"Wrote {DELIVERABLE} and checked it with ple_check_deliverables."},
]

state = {"turn": 0}


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
        turn = state["turn"]
        state["turn"] += 1
        step = SCRIPT[min(turn, len(SCRIPT) - 1)]
        message = {
            "role": "assistant",
            "content": step.get("content"),
            "tool_calls": step.get("tool_calls"),
        }
        self._json(
            {
                "id": f"chatcmpl-stub-{turn}",
                "object": "chat.completion",
                "created": 0,
                "model": request.get("model", "stub-model"),
                "choices": [
                    {
                        "index": 0,
                        "message": message,
                        "finish_reason": "tool_calls" if step.get("tool_calls") else "stop",
                    }
                ],
                "usage": {"prompt_tokens": 1200, "completion_tokens": 40, "total_tokens": 1240},
            }
        )

    def log_message(self, *args: object) -> None:  # keep the kit logs readable
        return


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4123
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"stub model listening on 0.0.0.0:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
