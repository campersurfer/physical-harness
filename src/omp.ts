/**
 * OMP2 session construction for one PLE task.
 *
 * The session owns the agent loop, retries, and compaction. This host owns the
 * prompt, the tool surface, and the accounting, and confines the session to a
 * single OpenAI-compatible gateway injected by the evaluator.
 */

import {
  AgentRegistry,
  createAgentSession,
  discoverAuthStorage,
  ModelRegistry,
  SessionManager,
  Settings,
  type CustomTool,
} from "@oh-my-pi/pi-coding-agent";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { EvaluatorBridge } from "./protocol";
import { createTools } from "./tools";
import { openMcpSessions } from "./mcp";

export const PROVIDER = "ple-gateway";
const SYSTEM_PROMPT_PATH = new URL("../prompts/system.md", import.meta.url);

type ThinkingConfig = {
  mode: "effort";
  efforts: string[];
  defaultLevel: string;
};

type ModelLimits = {
  contextWindow: number;
  maxTokens: number;
  thinking: ThinkingConfig;
  /** Where the numbers came from; unverified entries must not be treated as measured. */
  source: string;
};

/**
 * Per-model limits. Entries marked "conservative" are not documented by the
 * competition; they are deliberately under-stated so the session compacts early
 * rather than sending a request the gateway rejects with HTTP 400.
 */
const MODEL_LIMITS: Record<string, ModelLimits> = {
  "gemini-4-argon": {
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "high" },
    source: "~/ple/docs/models.md (documented)",
  },
  "claude-opus-5-5": {
    contextWindow: 200_000,
    maxTokens: 32_000,
    thinking: { mode: "effort", efforts: ["low", "medium", "high", "max"], defaultLevel: "max" },
    source: "conservative: max_tokens 32000 documented, context window not documented",
  },
  "glm-5.2": {
    contextWindow: 200_000,
    maxTokens: 32_000,
    thinking: { mode: "effort", efforts: ["low", "medium", "high", "max"], defaultLevel: "max" },
    source: "conservative: not documented in ~/ple/docs/models.md",
  },
  "gemini-3.8-flash": {
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    thinking: { mode: "effort", efforts: ["low", "medium", "high"], defaultLevel: "high" },
    source: "conservative: not documented in ~/ple/docs/models.md",
  },
};

export type PleSession = {
  session: AgentSession;
  toolNames: string[];
  model: string;
  provider: string;
  dispose: () => Promise<void>;
};

export type SessionOptions = {
  bridge: EvaluatorBridge;
  instruction: string;
  workdir: string;
  secondsLeft: number | null;
};

function describeBudget(secondsLeft: number | null): string {
  if (secondsLeft === null) return "There is no fixed time limit for this task.";
  const minutes = Math.floor(secondsLeft / 60);
  return `You have about ${minutes} minutes of task time; the harness wraps up automatically before it expires.`;
}

/**
 * Test-only model seam. When PLE_TEST_MODEL_MODULE names a module, that module's
 * `createModel()` supplies the model instead of the evaluator's gateway. Any
 * failure here is fatal: the harness never silently falls back to another model.
 */
async function loadTestModel(): Promise<{ model: unknown; providerId: string; apiKey: string } | null> {
  const modulePath = process.env.PLE_TEST_MODEL_MODULE;
  if (!modulePath || modulePath.length === 0) return null;
  // Runtime-selected module path: a static import cannot name it.
  const imported: unknown = await import(modulePath);
  if (imported === null || typeof imported !== "object" || !("createModel" in imported)) {
    throw new Error(`PLE_TEST_MODEL_MODULE ${modulePath} does not export createModel()`);
  }
  const factory: unknown = imported.createModel;
  if (typeof factory !== "function") {
    throw new Error(`PLE_TEST_MODEL_MODULE ${modulePath} createModel is not callable`);
  }
  const created: unknown = await factory();
  if (created === null || typeof created !== "object") {
    throw new Error(`PLE_TEST_MODEL_MODULE ${modulePath} createModel() returned nothing usable`);
  }
  const record = created as Record<string, unknown>;
  if (!record.model || typeof record.providerId !== "string" || typeof record.apiKey !== "string") {
    throw new Error(`PLE_TEST_MODEL_MODULE ${modulePath} createModel() must return {model, providerId, apiKey}`);
  }
  return { model: record.model, providerId: record.providerId, apiKey: record.apiKey };
}

export async function createPleSession(options: SessionOptions): Promise<PleSession> {
  const { bridge, instruction, workdir, secondsLeft } = options;
  const configuredModelName = process.env.MODEL_NAME;

  const systemPromptBody = await Bun.file(SYSTEM_PROMPT_PATH).text();
  const systemPrompt = [
    systemPromptBody.trim(),
    "",
    `# This task`,
    `- Project workdir: ${workdir}`,
    `- ${describeBudget(secondsLeft)}`,
    "- Deliverables must exist as real files at the exact paths named in the instruction before you finish.",
  ].join("\n");

  const settings = Settings.isolated({
    includeWorkspaceTree: false,
    "memory.backend": "off",
    "magicKeywords.enabled": false,
    "advisor.enabled": false,
    "autolearn.enabled": false,
    "dev.autoqa": false,
    "telemetry.otlpExportEnabled": false,
    "providers.cacheWarming": "off",
    "startup.checkUpdate": false,
    "update.auto": false,
    "compaction.enabled": true,
    "compaction.idleEnabled": false,
    // Transient gateway failures are retried inside the call, and the task loop
    // in src/server.ts retries the whole turn on top of that; both are bounded so
    // a dead endpoint surfaces instead of silently burning the budget.
    "retry.enabled": true,
    "retry.maxRetries": 3,
    "retry.baseDelayMs": 2000,
    "retry.maxDelayMs": 30_000,
    "retry.modelFallback": false,
  });

  const agentDir = process.env.HOME ? `${process.env.HOME}/.ple-omp` : "/tmp/ple-omp";
  const authStorage = await discoverAuthStorage(undefined, { settings });

  const testModel = await loadTestModel();
  const mcpSessions = await openMcpSessions(bridge);
  const customTools: CustomTool[] = createTools(bridge, mcpSessions);
  const toolNames = customTools.map((tool) => tool.name);

  let session: AgentSession;
  let provider: string;
  let effectiveModelName: string;

  if (testModel) {
    // Test path: a deterministic in-process model, still through the real session.
    authStorage.keys.setRuntime(testModel.providerId, testModel.apiKey);
    const registry = new ModelRegistry(authStorage, undefined, { ignoreLocalModelConfig: true, settings });
    provider = testModel.providerId;
    effectiveModelName = String((testModel.model as { id?: string }).id ?? "test-model");
    const created = await createAgentSession({
      cwd: workdir,
      agentDir,
      systemPrompt: [systemPrompt],
      settings,
      sessionManager: SessionManager.inMemory(workdir),
      agentRegistry: new AgentRegistry(),
      model: testModel.model as never,
      authStorage,
      modelRegistry: registry,
      customTools,
      toolNames,
      restrictToolNames: true,
      allowRestrictedCustomTools: true,
      enableMCP: false,
      enableLsp: false,
      autoApprove: true,
      disableExtensionDiscovery: true,
      extensions: [],
      additionalExtensionPaths: [],
      skills: [],
      rules: [],
      contextFiles: [],
      noContextFiles: true,
      excludeAgentsMd: true,
      promptTemplates: [],
      slashCommands: [],
      cacheWarming: false,
      autoTitle: false,
    });
    session = created.session;
  } else {
    // The real path always receives MODEL_NAME from the evaluator; the test path
    // takes its identity from the injected model instead.
    const modelName = configuredModelName;
    if (!modelName) throw new Error("MODEL_NAME is not set");
    const limits = MODEL_LIMITS[modelName];
    if (!limits) {
      throw new Error(
        `No verified limits for MODEL_NAME=${modelName}. Add a MODEL_LIMITS entry (with its source) before running.`,
      );
    }
    const baseUrl = process.env.MODEL_BASE_URL;
    if (!baseUrl) throw new Error("MODEL_BASE_URL is not set");
    if (!process.env.MODEL_API_KEY) throw new Error("MODEL_API_KEY is not set");

    provider = PROVIDER;
    effectiveModelName = modelName;
    authStorage.keys.setRuntime(PROVIDER, process.env.MODEL_API_KEY);
    const registry = new ModelRegistry(authStorage, undefined, { ignoreLocalModelConfig: true, settings });
    registry.registerProvider(PROVIDER, {
      baseUrl,
      apiKey: "MODEL_API_KEY",
      api: "openai-completions",
      models: [
        {
          id: modelName,
          name: modelName,
          reasoning: true,
          thinking: limits.thinking,
          input: ["text"],
          supportsTools: true,
          contextWindow: limits.contextWindow,
          maxTokens: limits.maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    const model = registry.find(PROVIDER, modelName);
    if (!model) throw new Error(`registered model ${PROVIDER}/${modelName} is unavailable`);

    const created = await createAgentSession({
      cwd: workdir,
      agentDir,
      systemPrompt: [systemPrompt],
      settings,
      sessionManager: SessionManager.inMemory(workdir),
      agentRegistry: new AgentRegistry(),
      model,
      rebindModelAfterDiscovery: false,
      disableModelFallback: true,
      disableServerSideFallback: true,
      assertDispatchModel: (candidate: { provider: string; id: string }) => {
        if (candidate.provider !== PROVIDER || candidate.id !== modelName) {
          throw new Error(`refusing to dispatch to ${candidate.provider}/${candidate.id}`);
        }
      },
      thinkingLevel: limits.thinking.defaultLevel,
      authStorage,
      modelRegistry: registry,
      customTools,
      toolNames,
      restrictToolNames: true,
      allowRestrictedCustomTools: true,
      enableMCP: false,
      enableLsp: false,
      autoApprove: true,
      disableExtensionDiscovery: true,
      extensions: [],
      additionalExtensionPaths: [],
      skills: [],
      rules: [],
      contextFiles: [],
      noContextFiles: true,
      excludeAgentsMd: true,
      promptTemplates: [],
      slashCommands: [],
      cacheWarming: false,
      autoTitle: false,
    });
    session = created.session;
  }

  const activeTools = session.getActiveToolNames();
  const missing = toolNames.filter((name) => !activeTools.includes(name));
  const extra = activeTools.filter((name) => !toolNames.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    await session.dispose();
    throw new Error(`tool confinement failed: missing=[${missing.join(",")}] extra=[${extra.join(",")}]`);
  }

  let disposed = false;
  return {
    session,
    toolNames,
    model: effectiveModelName,
    provider,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await session.dispose();
    },
  };
}

/** Task prompt sent as the first user message; the instruction is verbatim. */
export function renderTaskPrompt(options: { instruction: string; workdir: string; mcpServers: string[] }): string {
  const lines = [options.instruction.trim(), ""];
  if (options.mcpServers.length > 0) {
    lines.push(
      `Task application servers available: ${options.mcpServers.join(", ")}.`,
      "Use ple_mcp with action=list to see a server's tools, then action=call to use one.",
      "",
    );
  }
  lines.push(`Work from the project files under ${options.workdir}.`);
  return lines.join("\n");
}
