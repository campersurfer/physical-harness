/**
 * Protocol-level scenarios for the harness, driven by the local evaluator
 * fixture (test/fixture.ts) and a deterministic model (test/mock-model.ts).
 *
 * These exercise the real serve.ts process, the real OMP2 session, the real
 * tools, and real protocol frames. They are not a substitute for `kit check`,
 * which is the authority for the container contract.
 */

import { expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runScenario } from "./fixture";

test(
  "runs a task, writes the deliverable, and reports usage",
  async () => {
    const result = await runScenario({ scenario: "basic" });
    try {
      expect(result.errorFrames).toEqual([]);
      expect(result.doneReceived).toBe(true);

      const deliverable = join(result.workdir, "results", "deliverable.md");
      const info = await stat(deliverable);
      expect(info.isFile()).toBe(true);
      const content = await readFile(deliverable, "utf8");
      expect(content).toContain("Computed total: 42 kN");

      // exec, read, write, read all reached the evaluator as protocol requests.
      const kinds = result.frames.map((frame) => frame.type);
      expect(kinds).toContain("exec");
      expect(kinds.filter((kind) => kind === "write_file").length).toBeGreaterThanOrEqual(1);
      expect(kinds.filter((kind) => kind === "read_file").length).toBeGreaterThanOrEqual(2);

      // Accounting and confinement are observable facts, not claims.
      expect(result.usageFrames.length).toBeGreaterThanOrEqual(1);
      for (const usage of result.usageFrames) {
        expect(Number.isSafeInteger(usage.input_tokens)).toBe(true);
        expect(Number.isSafeInteger(usage.output_tokens)).toBe(true);
      }
      expect(result.logs.some((line) => line.includes("tools=ple_exec,ple_read_file,ple_write_file,ple_check_deliverables,ple_mcp"))).toBe(true);
    } finally {
      await result.cleanup();
    }
  },
  180_000,
);

test(
  "still sends done when the evaluator cancels mid-task",
  async () => {
    const result = await runScenario({ scenario: "slow", cancelAfterFirstRequest: true, doneTimeoutMs: 60_000 });
    try {
      expect(result.doneReceived).toBe(true);
      expect(result.errorFrames).toEqual([]);
    } finally {
      await result.cleanup();
    }
  },
  180_000,
);

test(
  "flags a malformed and a missing deliverable before finishing",
  async () => {
    const result = await runScenario({ scenario: "deliverables" });
    try {
      expect(result.errorFrames).toEqual([]);
      expect(result.doneReceived).toBe(true);
      const verdict = await readFile(join(result.workdir, "results", "verdict.txt"), "utf8");
      expect(verdict).toContain("problem(s) to fix");
      expect(verdict).toContain("MISSING");
      expect(verdict).toContain("results/missing.csv");
      expect(verdict).toContain("does not parse as JSON");
      expect(verdict).not.toContain("all deliverables look present");
    } finally {
      await result.cleanup();
    }
  },
  180_000,
);

test(
  "reaches task application servers through the protocol's http request",
  async () => {
    const result = await runScenario({ scenario: "mcp" });
    try {
      expect(result.errorFrames).toEqual([]);
      expect(result.doneReceived).toBe(true);
      expect(result.frames.some((frame) => frame.type === "http")).toBe(true);
      const content = await readFile(join(result.workdir, "results", "deliverable.md"), "utf8");
      expect(content).toContain("1303717.70");
    } finally {
      await result.cleanup();
    }
  },
  180_000,
);
