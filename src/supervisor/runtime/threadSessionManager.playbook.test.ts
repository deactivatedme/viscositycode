import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentKind, StartThreadPayload, ThreadConfig } from "@/shared/contracts";
import type { AgentAdapter, StructuredSessionHandle } from "../agents/base";

vi.mock("../agents/base", async (importActual) => {
  const actual = await importActual<typeof import("../agents/base")>();
  return {
    ...actual,
    getRefreshedWindowsPath: vi.fn<() => string | undefined>(() => undefined),
    primeProjectShellEnv: vi.fn<(cwd: string) => Promise<Record<string, string> | undefined>>(() =>
      Promise.resolve(undefined),
    ),
  };
});

vi.mock("node:timers/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:timers/promises")>();
  return {
    ...actual,
    setTimeout: vi.fn<(delay?: number) => Promise<void>>(async () => undefined),
  };
});

const ptyWrites = vi.hoisted(() => [] as string[]);
vi.mock("node-pty", () => ({
  spawn: vi.fn<() => unknown>(() => ({
    pid: 123,
    kill: vi.fn<() => void>(),
    onData: vi.fn<() => void>(),
    onExit: vi.fn<() => void>(),
    write: (data: string) => ptyWrites.push(data),
  })),
}));

import { PLAYBOOK_REMOVED_BRIEF_TEXT } from "./playbookBrief";
import { ThreadSessionManager } from "./threadSessionManager";

/** ViscosityCode: playbook delivery through launch and later input, per presentation. */

const AGENT_KIND: AgentKind = "fixture-agent";
const MODEL = `${AGENT_KIND}/model`;
const reversing = {
  version: 1 as const,
  id: "reversing",
  label: "Reversing",
  instructions: "Triage first.",
};
const review = { ...reversing, id: "review", label: "Review", instructions: "Review only." };

const managers: ThreadSessionManager[] = [];
const tempDirs: string[] = [];
let tempDir: string;

beforeEach(() => {
  ptyWrites.length = 0;
  tempDir = mkdtempSync(join(tmpdir(), "poracode-playbook-"));
  tempDirs.push(tempDir);
  // Keeps the instructions files in the scratch profile, never the user's.
  vi.stubEnv("PORACODE_DATA_DIR", tempDir);
});

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.dispose();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function createStructuredSession() {
  const startTurn = vi.fn<NonNullable<StructuredSessionHandle["startTurn"]>>(async () => undefined);
  const handle: StructuredSessionHandle = {
    launchOptions: {},
    activate: vi.fn<NonNullable<StructuredSessionHandle["activate"]>>(async () => undefined),
    openThread: vi.fn<NonNullable<StructuredSessionHandle["openThread"]>>(async () => "ses_1"),
    startTurn,
    setListener: vi.fn<StructuredSessionHandle["setListener"]>(),
    dispose: vi.fn<StructuredSessionHandle["dispose"]>(async () => undefined),
  };
  return { handle, startTurn };
}

function createAdapter(structuredSession: StructuredSessionHandle): AgentAdapter {
  return {
    kind: AGENT_KIND,
    label: AGENT_KIND,
    binary: AGENT_KIND,
    capabilities: {
      models: [],
      efforts: [],
      modelEfforts: {},
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      presentationModes: ["terminal", "gui"],
      settingDefs: [],
    },
    detectInstall: vi.fn<AgentAdapter["detectInstall"]>(),
    buildLaunchArgv: vi.fn<AgentAdapter["buildLaunchArgv"]>(() => ({
      binary: AGENT_KIND,
      args: [],
    })),
    buildResumeArgv: vi.fn<AgentAdapter["buildResumeArgv"]>(() => ({
      binary: AGENT_KIND,
      args: [],
    })),
    createInitialSessionRef: vi.fn<AgentAdapter["createInitialSessionRef"]>(() => undefined),
    createStructuredSession: vi.fn<NonNullable<AgentAdapter["createStructuredSession"]>>(
      async (input) => (input.presentationMode === "gui" ? structuredSession : undefined),
    ),
  };
}

function createManager(
  adapter: AgentAdapter,
  options: Partial<ConstructorParameters<typeof ThreadSessionManager>[0]> = {},
): ThreadSessionManager {
  const manager = new ThreadSessionManager({
    emit: () => {},
    isDev: false,
    logsDir: join(tempDir, "logs"),
    settingsPath: join(tempDir, "settings.json"),
    readDisableCliHookPlugin: () => false,
    adapters: new Map([[AGENT_KIND, adapter]]),
    resolveWindowsShell: () => ({ shell: "powershell.exe", kind: "powershell", args: ["-NoLogo"] }),
    ...options,
  });
  managers.push(manager);
  return manager;
}

function payload(overrides: Partial<StartThreadPayload>): StartThreadPayload {
  return {
    threadId: "t1",
    projectLocation: { kind: "posix", path: "/repo" },
    agentKind: AGENT_KIND,
    config: { model: MODEL, playbook: reversing },
    prompt: "find main",
    initialSize: { cols: 80, rows: 24 },
    presentationMode: "terminal",
    ...overrides,
  };
}

async function send(manager: ThreadSessionManager, config: ThreadConfig, prompt: string) {
  ptyWrites.length = 0;
  await manager.sendThreadInput({ threadId: "t1", config, prompt });
  return ptyWrites.join("");
}

describe("terminal playbook pointer", () => {
  it("leads the launch prompt, then only the first input after each change", async () => {
    const adapter = createAdapter(createStructuredSession().handle);
    const manager = createManager(adapter);
    await manager.startThread(payload({}));

    const launchPrompt = vi.mocked(adapter.buildLaunchArgv).mock.calls[0]?.[2];
    expect(launchPrompt).toMatch(
      new RegExp(
        `^Follow the standing instructions in ${tempDir}/playbooks/[0-9a-f]+\\.md for this chat \\("Reversing" playbook\\)\\. find main$`,
      ),
    );
    // The MCP thread title (browser tab group, thread label) keeps the user's words, not the path.
    expect(vi.mocked(adapter.createStructuredSession!).mock.calls[0]?.[0].mcpIdentity?.title).toBe(
      "find main",
    );

    expect(await send(manager, { model: MODEL, playbook: reversing }, "next")).toBe("next\r");
    // An older writer omits the field: the playbook is retained, nothing re-sent.
    expect(await send(manager, { model: MODEL }, "again")).toBe("again\r");
    expect(await send(manager, { model: MODEL, playbook: review }, "go")).toMatch(
      /^Follow the standing instructions in .+\("Review" playbook\)\. go\r$/,
    );
    expect(await send(manager, { model: MODEL, playbook: null }, "plain")).toBe(
      "This chat's playbook no longer applies; ignore its instructions file. plain\r",
    );
    expect(await send(manager, { model: MODEL, playbook: null }, "plain")).toBe("plain\r");
  });

  it("waits past commands and skills for the next plain prompt", async () => {
    const adapter = createAdapter(createStructuredSession().handle);
    const manager = createManager(adapter);
    await manager.startThread(payload({ prompt: "/compact" }));
    expect(vi.mocked(adapter.buildLaunchArgv).mock.calls[0]?.[2]).toBe("/compact");

    expect(await send(manager, { model: MODEL, playbook: reversing }, "/model")).toBe("/model\r");
    ptyWrites.length = 0;
    await manager.sendThreadInput({
      threadId: "t1",
      config: { model: MODEL, playbook: reversing },
      prompt: "",
      segments: [
        {
          kind: "skill",
          name: "triage",
          invocation: "/triage",
          provider: AGENT_KIND,
          scope: "project",
        },
        { kind: "text", content: " main" },
      ],
    });
    expect(ptyWrites.join("")).not.toContain("Follow the standing instructions");
    expect(await send(manager, { model: MODEL, playbook: reversing }, "go")).toMatch(
      /^Follow the standing instructions in .+\("Reversing" playbook\)\. go\r$/,
    );
  });

  it("skips a launch that leads with a skill, judged before the terminal skill rewrite", async () => {
    const adapter = createAdapter(createStructuredSession().handle);
    const rewriteTerminalSkillSegments = vi.fn<
      NonNullable<
        ConstructorParameters<typeof ThreadSessionManager>[0]["rewriteTerminalSkillSegments"]
      >
    >(async () => [{ kind: "text", content: "Use the triage skill at /skills/triage. main" }]);
    const manager = createManager(adapter, { rewriteTerminalSkillSegments });
    await manager.startThread(
      payload({
        prompt: "",
        segments: [
          {
            kind: "skill",
            name: "triage",
            invocation: "/triage",
            provider: AGENT_KIND,
            scope: "project",
          },
          { kind: "text", content: " main" },
        ],
      }),
    );

    expect(rewriteTerminalSkillSegments).toHaveBeenCalledOnce();
    const launchPrompt = vi.mocked(adapter.buildLaunchArgv).mock.calls[0]?.[2];
    expect(launchPrompt).toBe("Use the triage skill at /skills/triage. main");
    expect(manager.sessions.get("t1")?.playbookBriefDelivered).toBeUndefined();
    expect(await send(manager, { model: MODEL, playbook: reversing }, "go")).toMatch(
      /^Follow the standing instructions in .+\("Reversing" playbook\)\. go\r$/,
    );
  });

  it("is never added to a structured chat's prompt", async () => {
    const structured = createStructuredSession();
    const manager = createManager(createAdapter(structured.handle));
    await manager.startThread(payload({ presentationMode: "gui" }));

    await vi.waitFor(() => expect(structured.startTurn).toHaveBeenCalledOnce());
    const [prompt, , , options] = structured.startTurn.mock.calls[0]!;
    expect(prompt).toBe("find main");
    expect(options?.inlineInstructions).toContain('[playbook] This chat uses the "Reversing"');
    options?.onPromptSubmitted?.();
    expect(manager.sessions.get("t1")?.playbookBriefDelivered).toBeTruthy();
  });

  it("points workspace-sandboxed agents at a copy inside the project", async () => {
    const project = join(tempDir, "project");
    mkdirSync(project);
    const adapter = createAdapter(createStructuredSession().handle);
    adapter.capabilities.requiresWorkspaceLocalAttachments = true;
    const manager = createManager(adapter);
    await manager.startThread(payload({ projectLocation: { kind: "posix", path: project } }));
    expect(vi.mocked(adapter.buildLaunchArgv).mock.calls[0]?.[2]).toContain(
      `Follow the standing instructions in ${join(project, ".poracode", "attachments")}/`,
    );

    expect(await send(manager, { model: MODEL, playbook: review }, "go")).toContain(
      `in ${join(project, ".poracode", "attachments")}/`,
    );
  });

  it("retracts a playbook cleared before a resumed structured chat", async () => {
    const structured = createStructuredSession();
    const manager = createManager(createAdapter(structured.handle));
    await manager.startThread(
      payload({
        presentationMode: "gui",
        config: { model: MODEL, playbook: null },
        sessionRef: { providerSessionId: "ses_1", discoveredAt: "2026-01-01T00:00:00.000Z" },
      }),
    );

    await vi.waitFor(() => expect(structured.startTurn).toHaveBeenCalledOnce());
    const options = structured.startTurn.mock.calls[0]![3];
    expect(options?.inlineInstructions).toBe(PLAYBOOK_REMOVED_BRIEF_TEXT);
    options?.onPromptSubmitted?.();
    expect(manager.sessions.get("t1")?.playbookBriefDelivered).toBe("");
  });
});
