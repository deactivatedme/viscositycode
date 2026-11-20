// ViscosityCode: the new-thread composer starts a Roundtable with its own playbook.
import "@/renderer/testUtils/clientDraftDatabase";
import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { AgentStatus, Project, ThreadConfig } from "@/shared/contracts";

const roundtableMocks = vi.hoisted(() => ({
  startDraftRoundtable: vi.fn<(input: { playbookId?: string | undefined }) => Promise<string>>(),
}));

vi.mock("@/renderer/components/newsLine/NewsLine", () => ({ NewsLine: () => null }));

// Only the input matters here: it submits a fixed task.
vi.mock("./ThreadComposer", () => ({
  ThreadComposer: (props: { inputContent?: ReactNode }) => <div>{props.inputContent}</div>,
}));

vi.mock("@/renderer/components/composer/MentionInput", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/components/composer/MentionInput")>()),
  MentionInput: (props: { onSubmit: (segments: { kind: "text"; content: string }[]) => void }) => (
    <button type="button" onClick={() => props.onSubmit([{ kind: "text", content: "Map it" }])}>
      submit
    </button>
  ),
}));

vi.mock("@/renderer/viscosity/roundtable/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/viscosity/roundtable/chat")>()),
  RoundtableDraftPanel: () => null,
  startDraftRoundtable: roundtableMocks.startDraftRoundtable,
  useRoundtableDraft: () => ({
    available: true,
    enabled: true,
    pattern: "open",
    seats: [],
    canStart: true,
    isFull: false,
    submitLabel: "Start Roundtable",
    setEnabled: () => {},
    setPattern: () => {},
    addSeat: () => {},
    removeSeat: () => {},
    reset: () => {},
  }),
}));

import "@/renderer/components/providers/bootstrap";
import { ThreadDraftComposerArea } from "./ThreadDraftComposerArea";

const project: Project = {
  id: "project-1",
  name: "Repo",
  location: { kind: "posix", path: "/repo" },
  createdAt: "2026-03-28T00:00:00.000Z",
};

const agent: AgentStatus = {
  kind: "gemini",
  label: "Gemini",
  installed: true,
  authState: "authenticated",
  capabilities: {
    models: [{ id: "auto", label: "Auto" }],
    efforts: [],
    modelEfforts: {},
    modes: ["agent"],
    approvalPolicies: [],
    sandboxModes: [],
    supportsResume: true,
    supportsDirectInput: true,
    liveInputMode: "server",
    presentationMode: "gui",
    settingDefs: [],
  },
};

const binding = {
  version: 1 as const,
  id: "reversing",
  label: "Reversing",
  icon: "binary",
  instructions: "Triage first.",
};

function renderComposer(config: ThreadConfig) {
  return render(
    <ThreadDraftComposerArea
      project={project}
      selectedAgent={agent}
      controls={[]}
      config={config}
      compact={false}
      hideWorkspaceControls={false}
      paneCount={1}
      gitBranch="main"
      worktreeMode={false}
      supportsModePicker={false}
      presentationMode="gui"
      onConfigChange={() => {}}
      onWorktreeModeChange={() => {}}
      onSwitchBranch={() => {}}
      onRememberPresentationMode={() => {}}
      onStart={vi.fn<() => never>()}
    />,
  );
}

async function submittedPlaybookId(config: ThreadConfig) {
  roundtableMocks.startDraftRoundtable.mockClear();
  const { unmount } = renderComposer(config);
  fireEvent.click(await screen.findByRole("button", { name: "submit" }));
  await waitFor(() => expect(roundtableMocks.startDraftRoundtable).toHaveBeenCalledTimes(1));
  unmount();
  return roundtableMocks.startDraftRoundtable.mock.calls[0]?.[0].playbookId;
}

describe("ThreadDraftComposerArea Roundtable start", () => {
  beforeEach(() => {
    roundtableMocks.startDraftRoundtable.mockResolvedValue("session-1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes the composer's playbook to the Roundtable", async () => {
    expect(await submittedPlaybookId({ model: "auto", playbook: binding })).toBe("reversing");
  });

  it("passes no playbook when none, null, or a future version is bound", async () => {
    for (const playbook of [undefined, null, { version: 2, id: "x" }]) {
      expect(
        await submittedPlaybookId({
          model: "auto",
          ...(playbook === undefined ? {} : { playbook }),
        }),
      ).toBeUndefined();
    }
  });
});
