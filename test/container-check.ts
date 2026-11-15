/**
 * Drives a harness that is already running — typically the real serve container
 * started by `kit up` — through the same scenarios as the local suite, and
 * prints a verdict each. Usage:
 *
 *   bun test/container-check.ts ws://127.0.0.1:PORT/
 *
 * The harness under test must be running with the test model seam enabled
 * (PLE_TEST_MODEL_MODULE), because this checks the container contract, not the
 * model.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runAgainstUrl } from "./fixture";

const url = process.argv[2];
if (!url) {
  process.stderr.write("usage: bun test/container-check.ts ws://host:port/\n");
  process.exit(2);
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function check(name: string, body: () => Promise<string>): Promise<void> {
  try {
    const detail = await body();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

await check("accepts the connection and runs a task through to done", async () => {
  const result = await runAgainstUrl(url, { scenario: "basic", doneTimeoutMs: 120_000 });
  try {
    if (result.errorFrames.length > 0) throw new Error(`harness error frame: ${JSON.stringify(result.errorFrames[0])}`);
    if (!result.doneReceived) throw new Error(`final frame was ${String(result.finalFrame.type)}`);
    const deliverable = join(result.workdir, "results", "deliverable.md");
    const info = await stat(deliverable);
    if (!info.isFile()) throw new Error("deliverable was not written");
    const content = await readFile(deliverable, "utf8");
    if (!content.includes("Computed total: 42 kN")) throw new Error("deliverable content is wrong");
    const kinds = new Set(result.frames.map((frame) => frame.type));
    if (!kinds.has("exec") || !kinds.has("write_file") || !kinds.has("read_file")) {
      throw new Error(`missing request kinds: ${[...kinds].join(",")}`);
    }
    const confinement = result.logs.find((line) => line.includes("tools="));
    if (!confinement || !confinement.includes("tools=ple_exec,ple_read_file,ple_write_file,ple_check_deliverables,ple_mcp")) {
      throw new Error(`tool confinement line missing or unexpected: ${confinement ?? "(none)"}`);
    }
    if (result.usageFrames.length === 0) throw new Error("no usage frames were reported");
    return `${result.frames.length} requests, ${result.usageFrames.length} usage frames`;
  } finally {
    await result.cleanup();
  }
});

await check("still finishes with done when cancelled", async () => {
  const result = await runAgainstUrl(url, {
    scenario: "slow",
    cancelAfterFirstRequest: true,
    doneTimeoutMs: 60_000,
  });
  try {
    if (result.errorFrames.length > 0) throw new Error(`harness error frame: ${JSON.stringify(result.errorFrames[0])}`);
    if (!result.doneReceived) throw new Error(`final frame was ${String(result.finalFrame.type)}`);
    return "done received after cancel";
  } finally {
    await result.cleanup();
  }
});

let failures = 0;
for (const entry of results) {
  if (!entry.ok) failures += 1;
  process.stdout.write(`${entry.ok ? "PASS" : "FAIL"} ${entry.name}: ${entry.detail}\n`);
}
process.exit(failures === 0 ? 0 : 1);
