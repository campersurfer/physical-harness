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
  const mock = createMockModel({ responses: scriptFor(scenario) });
  return { model: mock.model, providerId: "mock", apiKey: "test-key" };
}
