/**
 * Test-only model. Never used by a real run: src/omp.ts loads it only when
 * PLE_TEST_MODEL_MODULE names this file, and refuses to start if loading fails.
 *
 * The scripts below drive the real harness path (real session, real tools, real
 * protocol frames) without a network model call, so protocol behavior is
 * reproducible.
 */

import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";

type MockResponse = {
  content: Array<
    | string
    | { type: "toolCall"; name: string; arguments: Record<string, unknown> }
  >;
};

const DELIVERABLE = "results/deliverable.md";

function basicScript(): MockResponse[] {
  return [
    { content: [{ type: "toolCall", name: "ple_exec", arguments: { command: "mkdir -p results && printf 'seed\\n' > results/input.txt && cat results/input.txt" } }] },
    { content: [{ type: "toolCall", name: "ple_read_file", arguments: { path: "results/input.txt" } }] },
    {
      content: [
        {
          type: "toolCall",
          name: "ple_write_file",
          arguments: { path: DELIVERABLE, content: "# Deliverable\n\nComputed total: 42 kN\n" },
        },
      ],
    },
    { content: [{ type: "toolCall", name: "ple_read_file", arguments: { path: DELIVERABLE } }] },
    { content: [`Wrote ${DELIVERABLE} with the computed total.`] },
  ];
}

function slowScript(): MockResponse[] {
  return [
    { content: [{ type: "toolCall", name: "ple_exec", arguments: { command: "sleep 45", timeout_sec: 60 } }] },
    { content: ["Should not reach this turn."] },
  ];
}

function mcpScript(): MockResponse[] {
  return [
    { content: [{ type: "toolCall", name: "ple_mcp", arguments: { action: "servers" } }] },
    { content: [{ type: "toolCall", name: "ple_mcp", arguments: { action: "list", server: "apps" } }] },
    {
      content: [
        {
          type: "toolCall",
          name: "ple_mcp",
          arguments: {
            action: "call",
            server: "apps",
            tool: "lookup_section",
            arguments: JSON.stringify({ section: "2" }),
          },
        },
      ],
    },
    {
      content: [
        {
          type: "toolCall",
          name: "ple_write_file",
          arguments: { path: DELIVERABLE, content: "# Deliverable\n\nSection 2 subtotal: 1303717.70\n" },
        },
      ],
    },
    { content: ["Read the Section 2 subtotal from the task app and wrote the deliverable."] },
  ];
}

/** Pulls the text of the most recent tool result out of the conversation. */
function lastToolResultText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === null || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    const role = String(record.role ?? "");
    if (role !== "toolResult" && role !== "tool") continue;
    const content = record.content;
    if (!Array.isArray(content)) return JSON.stringify(record);
    const parts: string[] = [];
    for (const block of content) {
      if (block === null || typeof block !== "object") continue;
      const entry = block as Record<string, unknown>;
      if (typeof entry.text === "string") parts.push(entry.text);
    }
    return parts.length > 0 ? parts.join("\n") : JSON.stringify(record);
  }
  return "(no tool result found)";
}

/**
 * Reactive script that exercises ple_check_deliverables against a good file, a
 * malformed file and a missing path, then writes the verdict out so the test can
 * read it from the workdir.
 */
function deliverableCheckHandler() {
  return async (context: { messages: unknown[] }): Promise<MockResponse> => {
    const assistantTurns = context.messages.filter((message) => {
      if (message === null || typeof message !== "object") return false;
      return (message as Record<string, unknown>).role === "assistant";
    }).length;
    if (assistantTurns === 0) {
      return {
        content: [
          {
            type: "toolCall",
            name: "ple_exec",
            arguments: {
              command:
                "mkdir -p results && printf '# Deliverable\\n\\nTotal: 42 kN\\n' > results/good.md && printf '{not json' > results/bad.json && ls -la results",
            },
          },
        ],
      };
    }
    if (assistantTurns === 1) {
      return {
        content: [
          {
            type: "toolCall",
            name: "ple_check_deliverables",
            arguments: { paths: ["results/good.md", "results/bad.json", "results/missing.csv"] },
          },
        ],
      };
    }
    if (assistantTurns === 2) {
      return {
        content: [
          {
            type: "toolCall",
            name: "ple_write_file",
            arguments: { path: "results/verdict.txt", content: lastToolResultText(context.messages) },
          },
        ],
      };
    }
    return { content: ["Checked the deliverables and recorded the verdict."] };
  };
}

function scriptFor(name: string): MockResponse[] {
  switch (name) {
    case "slow":
      return slowScript();
    case "mcp":
      return mcpScript();
    default:
      return basicScript();
  }
}

export async function createModel(): Promise<{ model: unknown; providerId: string; apiKey: string }> {
  registerMockApi();
  const scenario = process.env.PLE_TEST_SCRIPT ?? "basic";
  const mock = createMockModel(
    scenario === "deliverables"
      ? { handler: deliverableCheckHandler() as never }
      : { responses: scriptFor(scenario) },
  );
  return { model: mock.model, providerId: "mock", apiKey: "test-key" };
}
