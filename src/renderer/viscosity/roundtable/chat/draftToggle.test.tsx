import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerAddMenu } from "@/renderer/components/composer/ComposerAddMenu";
import { I18nTestWrapper, renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { ReadyAgentBrain } from "../api";
import { modelSeatCandidates } from "./participants";
import { startDraftRoundtable, useRoundtableDraft } from "./useRoundtableDraft";

const api = vi.hoisted(() => ({
  startRoundtable: vi.fn<(input: unknown) => Promise<string>>(),
  postToRoundtable: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));
vi.mock("@/renderer/viscosity/roundtable/api", () => api);
vi.mock("@/renderer/bridge", () => ({ isRemoteSession: () => false }));

const brains: ReadyAgentBrain[] = [
  {
    agentKind: "alpha",
    label: "Alpha",
    models: [
      { id: "a1", label: "One" },
      { id: "a2", label: "Two" },
      { id: "a3", label: "Three" },
      { id: "a4", label: "Four" },
      { id: "a5", label: "Five" },
    ],
    defaultModel: "a1",
    presentationModes: ["gui"],
  },
];
const candidates = modelSeatCandidates(brains);

function renderDraft(canHost = true) {
  return renderHook(() => useRoundtableDraft({ canHost }), { wrapper: I18nTestWrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.startRoundtable.mockResolvedValue("rt-1");
  api.postToRoundtable.mockResolvedValue(undefined);
  document.documentElement.dataset.windowKind = "main";
});

afterEach(() => {
  delete document.documentElement.dataset.windowKind;
});

describe("useRoundtableDraft (new-thread composer toggle)", () => {
  it("starts off and needs one more participant before it can start", () => {
    const { result } = renderDraft();
    expect(result.current).toMatchObject({ available: true, enabled: false, canStart: false });
    act(() => result.current.setEnabled(true));
    expect(result.current).toMatchObject({ enabled: true, canStart: false });
    act(() => result.current.addSeat(candidates[1]!));
    expect(result.current.canStart).toBe(true);
    expect(result.current.submitLabel).toBe("Start Roundtable");
  });

  it("caps the table at five seats and ignores duplicates", () => {
    const { result } = renderDraft();
    act(() => result.current.setEnabled(true));
    act(() => {
      for (const candidate of candidates) result.current.addSeat(candidate);
      result.current.addSeat(candidates[0]!);
    });
    expect(result.current.seats.map((seat) => seat.id)).toEqual(
      candidates.slice(0, 4).map((candidate) => candidate.id),
    );
    expect(result.current.isFull).toBe(true);
    act(() => result.current.removeSeat(candidates[0]!.id));
    expect(result.current.seats).toHaveLength(3);
  });

  it("clears seats when turned off and on reset", () => {
    const { result } = renderDraft();
    act(() => result.current.setEnabled(true));
    act(() => result.current.addSeat(candidates[1]!));
    act(() => result.current.setEnabled(false));
    expect(result.current).toMatchObject({ enabled: false, seats: [] });
    act(() => {
      result.current.setEnabled(true);
      result.current.setPattern("debate");
      result.current.addSeat(candidates[2]!);
    });
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ enabled: false, seats: [], pattern: "build-review" });
  });

  it("is not offered outside the desktop shell or where the composer cannot host it", () => {
    const { result: isolated } = renderDraft(false);
    act(() => isolated.current.setEnabled(true));
    expect(isolated.current).toMatchObject({ available: false, enabled: false });
    delete document.documentElement.dataset.windowKind;
    const { result: secondary } = renderDraft();
    expect(secondary.current.available).toBe(false);
  });
});

describe("Roundtable toggle in the composer add menu", () => {
  it("shows the toggle beside Experiment and flips it", () => {
    const onToggle = vi.fn<(next: boolean) => void>();
    render(
      <ComposerAddMenu
        mcpServers={[]}
        onPickFiles={vi.fn<() => void>()}
        roundtable={{ enabled: false, disabled: false, onToggle }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add attachment or capability" }));
    const item = screen.getByRole("menuitem", { name: /Roundtable/ });
    expect(item).toHaveAttribute("data-key", "roundtable");
    fireEvent.click(item);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("is absent when the composer does not offer it", () => {
    render(<ComposerAddMenu mcpServers={[]} onPickFiles={vi.fn<() => void>()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add attachment or capability" }));
    expect(screen.queryByRole("menuitem", { name: /Roundtable/ })).not.toBeInTheDocument();
  });
});

describe("startDraftRoundtable", () => {
  it("seats the composer's model first and the picked participants after it", async () => {
    await startDraftRoundtable({
      projectId: "project-1",
      task: "Speed up CI",
      pattern: "build-review",
      primary: {
        agentKind: "alpha",
        agentLabel: "Alpha",
        model: "a1",
        modelLabel: "One",
        presentationMode: "gui",
      },
      // The composer's own model is never seated twice.
      seats: [candidates[0]!, candidates[1]!],
      newWorktree: true,
    });
    expect(api.startRoundtable).toHaveBeenCalledWith({
      task: "Speed up CI",
      pattern: "build-review",
      projectId: "project-1",
      worktree: { mode: "new-branch" },
      participants: [
        expect.objectContaining({ id: "model:alpha:a1", role: "builder", label: "Alpha · One" }),
        expect.objectContaining({ id: "model:alpha:a2", role: "reviewer" }),
      ],
    });
  });

  it("posts the task as the first message of an open group chat", async () => {
    const primary = {
      agentKind: "alpha",
      agentLabel: "Alpha",
      model: "a1",
      modelLabel: "One",
      presentationMode: "gui" as const,
    };
    await startDraftRoundtable({
      projectId: "project-1",
      task: " What should we name it? ",
      pattern: "open",
      primary,
      seats: [candidates[1]!],
      newWorktree: false,
    });
    expect(api.startRoundtable).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "open", worktree: { mode: "current" } }),
    );
    expect(api.postToRoundtable).toHaveBeenCalledWith("rt-1", "What should we name it?");
    api.postToRoundtable.mockClear();
    await startDraftRoundtable({
      projectId: "project-1",
      task: "Ship it",
      pattern: "relay",
      primary,
      seats: [candidates[1]!],
      newWorktree: false,
    });
    expect(api.postToRoundtable).not.toHaveBeenCalled();
  });
});
