import { toast } from "@heroui/react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import type { ReadyAgentBrain, StartRoundtableInput } from "../api";
import { getRoundtableChatLink } from "../chat/chatLinksStore";
import { participant, readyBrain } from "./roundtable.testFixtures";
import { RoundtableSetupDialog } from "./RoundtableSetupDialog";
import { useRoundtableViewStore } from "./roundtableViewStore";

const api = vi.hoisted(() => ({
  ready: [] as ReadyAgentBrain[],
  startRoundtable: vi.fn<(input: StartRoundtableInput) => Promise<string>>(),
  postToRoundtable:
    vi.fn<(id: string, text: string, options?: { mentions?: string[] }) => Promise<void>>(),
}));
const xai = vi.hoisted(() => ({ configured: false }));

vi.mock("../api", () => ({
  useReadyAgentBrains: () => api.ready,
  startRoundtable: api.startRoundtable,
  postToRoundtable: api.postToRoundtable,
}));

vi.mock("@/renderer/viscosity/xai/useXaiKeyStatus", () => ({
  useXaiKeyStatus: () => ({
    available: xai.configured,
    status: xai.configured ? { configured: true, source: "stored", hint: "abcd" } : undefined,
    loading: false,
    error: undefined,
  }),
}));

// The real picker is covered by its own tests; here it only has to report a choice.
vi.mock("@/renderer/components/common/ProviderModelMenu", () => ({
  ProviderModelMenu: (props: {
    menuLabel?: string;
    currentAgentKind: string;
    currentModel: string;
    onChange: (next: { agentKind: string; model: string }) => void;
  }) => (
    <button
      type="button"
      aria-label={props.menuLabel}
      onClick={() => props.onChange({ agentKind: "beta", model: "beta-m2" })}
    >
      {props.currentAgentKind}/{props.currentModel}
    </button>
  ),
}));

let releaseShell: (() => void) | undefined;

function renderDialog(request = {}) {
  return render(<RoundtableSetupDialog request={request} />);
}

function startButton(): HTMLElement {
  return screen.getByRole("button", { name: "Start" });
}

function typeTask(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /Task|First message/ }), {
    target: { value: text },
  });
}

beforeEach(() => {
  api.ready = [readyBrain("alpha"), readyBrain("beta")];
  api.startRoundtable.mockReset().mockResolvedValue("rt-new");
  api.postToRoundtable.mockReset().mockResolvedValue(undefined);
  xai.configured = false;
  useAppStore.setState({
    projects: [{ id: "p1", name: "Web app", location: { kind: "local" } } as unknown as Project],
    threads: [],
    view: { kind: "thread", panes: ["t1"] },
  });
  useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  // Agent detection on this host has reported.
  useAgentStatusesStore.setState({ windowsLoaded: true, wslLoaded: true });
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  releaseShell?.();
});

describe("RoundtableSetupDialog", () => {
  it("starts on Work together: no roles or rounds, and the first message is optional", () => {
    renderDialog({ projectId: "p1" });
    const radios = within(
      screen.getByRole("radiogroup", { name: "How should they work?" }),
    ).getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual(["open", "compare"]);
    expect(screen.getByRole("radio", { name: /Work together/ })).toHaveProperty("checked", true);
    expect(screen.queryAllByLabelText(/Role of participant/)).toHaveLength(0);
    expect(screen.queryByText("Max rounds")).toBeNull();
    expect(screen.getByRole("textbox", { name: "First message (optional)" })).toBeTruthy();
    expect(screen.getByText(/They answer in this order/)).toBeTruthy();
    expect(startButton().hasAttribute("disabled")).toBe(false);

    // The competitive patterns are kept, one click away.
    const more = screen.getByRole("button", { name: /More ways to work/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("radio", { name: /Debate → decide/ }));
    expect(screen.queryAllByLabelText(/Role of participant/)).toHaveLength(2);
    expect(screen.getByText("Describe the task.")).toBeTruthy();
    // The chosen card cannot be folded away.
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(more.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("radio", { name: /Debate → decide/ })).toHaveProperty("checked", true);
  });

  it("sends instructions for everyone and per participant", async () => {
    api.ready = [readyBrain("kind-alpha"), readyBrain("kind-beta")];
    renderDialog({
      projectId: "p1",
      participants: [
        participant("alpha", { instructions: "You are the tester." }),
        participant("beta"),
      ],
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Instructions for everyone" }), {
      target: { value: " Keep it short. " },
    });
    // A bot's instructions are shown prefilled; the other seat opens its own.
    expect(screen.getByRole("textbox", { name: "Instructions for participant 1" })).toHaveProperty(
      "value",
      "You are the tester.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit instructions for participant 2" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Instructions for participant 2" }), {
      target: { value: "Backend only" },
    });
    await act(async () => {
      fireEvent.click(startButton());
    });
    const input = api.startRoundtable.mock.calls[0]![0];
    expect(input).toMatchObject({ pattern: "open", task: "", instructions: "Keep it short." });
    expect(input.participants.map((entry) => entry.instructions)).toEqual([
      "You are the tester.",
      "Backend only",
    ]);
    // Nothing to post: the chat waits for the first message.
    expect(api.postToRoundtable).not.toHaveBeenCalled();
  });

  it("sends the table's playbook and a seat's own choice", async () => {
    api.ready = [readyBrain("kind-alpha"), readyBrain("kind-beta")];
    renderDialog({
      projectId: "p1",
      participants: [participant("alpha", { playbookId: "review" }), participant("beta")],
    });
    // A seat that arrives with its own playbook shows it.
    expect(screen.getByRole("button", { name: /Playbook for participant 1/ })).toHaveTextContent(
      "Review",
    );
    fireEvent.click(screen.getByRole("button", { name: "No playbook Playbook" }));
    fireEvent.click(screen.getByRole("option", { name: "Reversing" }));
    await act(async () => {
      fireEvent.click(startButton());
    });
    const input = api.startRoundtable.mock.calls[0]![0];
    expect(input.playbookId).toBe("reversing");
    expect(input.participants.map((entry) => entry.playbookId)).toEqual(["review", undefined]);
  });

  it("starts with Cmd/Ctrl+Enter and offers to open the new Roundtable", async () => {
    const success = vi.spyOn(toast, "success");
    useRoundtableViewStore.setState({ setup: { nonce: 9, request: {} } });
    renderDialog({ projectId: "p1" });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "First message (optional)" }), {
        key: "Enter",
        metaKey: true,
      });
    });
    expect(api.startRoundtable).toHaveBeenCalledTimes(1);
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: "rt-new",
      shown: false,
    });
    const options = success.mock.calls.at(-1)![1] as { actionProps: { onPress: () => void } };
    act(() => options.actionProps.onPress());
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: "rt-new",
      shown: true,
    });
    success.mockRestore();
  });

  it("reports a failed start after the dialog was dismissed", async () => {
    const danger = vi.spyOn(toast, "danger");
    let reject: (error: Error) => void = () => undefined;
    api.startRoundtable.mockReturnValueOnce(
      new Promise<string>((_, fail) => {
        reject = fail;
      }),
    );
    useRoundtableViewStore.setState({ setup: { nonce: 8, request: {} } });
    renderDialog({ projectId: "p1" });
    await act(async () => {
      fireEvent.click(startButton());
    });
    act(() => {
      useRoundtableViewStore.setState({ setup: null });
    });
    await act(async () => {
      reject(new Error("Branch already exists"));
    });
    expect(danger).toHaveBeenCalledWith("Branch already exists");
    danger.mockRestore();
  });

  it("seats two ready agents and keeps Start disabled until the task is described", () => {
    renderDialog({ projectId: "p1", pattern: "build-review" });
    const seats = within(screen.getByRole("list", { name: "Participants" })).getAllByRole(
      "listitem",
    );
    expect(seats).toHaveLength(2);
    expect(within(seats[0]!).getByText("alpha/alpha-m1")).toBeTruthy();
    expect(within(seats[1]!).getByText("beta/beta-m1")).toBeTruthy();
    expect(startButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Describe the task.")).toBeTruthy();

    typeTask("Fix the flaky test");
    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it("needs at least two participants", () => {
    renderDialog({ projectId: "p1", task: "Fix it" });
    fireEvent.click(screen.getByRole("button", { name: "Remove participant 2" }));
    expect(screen.getByText("Seat at least two participants.")).toBeTruthy();
    expect(startButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it("caps the table at five participants", () => {
    renderDialog({ projectId: "p1", task: "Fix it" });
    const add = screen.getByRole("button", { name: "Add participant" });
    for (let index = 0; index < 3; index += 1) fireEvent.click(add);
    expect(
      within(screen.getByRole("list", { name: "Participants" })).getAllByRole("listitem"),
    ).toHaveLength(5);
    expect(add.hasAttribute("disabled")).toBe(true);
  });

  it("says when agents are still being detected", () => {
    api.ready = [];
    useAgentStatusesStore.setState({ windowsLoaded: false });
    renderDialog({ projectId: "p1", task: "Fix it" });
    expect(screen.getByText("Looking for installed agents…")).toBeTruthy();
  });

  it("explains the empty state and links to Settings → Agents", () => {
    api.ready = [];
    useRoundtableViewStore.setState({ setup: { nonce: 1, request: {} } });
    const openSettingsSection = vi.spyOn(usePanelStore.getState(), "openSettingsSection");
    renderDialog({ projectId: "p1", task: "Fix it" });
    expect(screen.getByText(/No signed-in agents for this project/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add participant" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Add Grok (xAI API)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open Settings → Agents/ }));
    expect(openSettingsSection).toHaveBeenCalledWith("agentsGeneral");
    expect(useRoundtableViewStore.getState().setup).toBeNull();
    openSettingsSection.mockRestore();
  });

  it("offers Grok over the xAI API only with a configured key", () => {
    xai.configured = true;
    api.ready = [];
    renderDialog({ projectId: "p1", task: "Discuss it", pattern: "open" });
    const addGrok = screen.getByRole("button", { name: "Add Grok (xAI API)" });
    fireEvent.click(addGrok);
    fireEvent.click(addGrok);
    expect(screen.getAllByText("Grok (xAI API)")).toHaveLength(2);
    // A team chat has no rounds.
    expect(screen.queryByText("Max rounds")).toBeNull();
    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it("applies the pattern's round default and lets a seat change provider and model", () => {
    renderDialog({ projectId: "p1", task: "Fix it", pattern: "build-review" });
    const rounds = () => screen.getByRole("textbox", { name: "Max rounds" }) as HTMLInputElement;
    expect(rounds().value).toBe("4");
    fireEvent.click(screen.getByRole("radio", { name: /Debate → decide/ }));
    expect(rounds().value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Provider and model for participant 1" }));
    expect(screen.getAllByText("beta/beta-m2")).toHaveLength(1);
  });

  it("starts the Roundtable and adds its tab without switching to it", async () => {
    renderDialog({ projectId: "p1", originThreadId: "t1", pattern: "build-review" });
    typeTask("Make the build green");
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Green build" },
    });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(api.startRoundtable).toHaveBeenCalledTimes(1);
    const input = api.startRoundtable.mock.calls[0]![0];
    expect(input).toMatchObject({
      title: "Green build",
      task: "Make the build green",
      pattern: "build-review",
      projectId: "p1",
      maxRounds: 4,
      worktree: { mode: "current" },
      originThreadId: "t1",
    });
    expect(input.participants.map((entry) => entry.role)).toEqual(["builder", "reviewer"]);
    expect(input.participants.map((entry) => entry.brain)).toEqual([
      { kind: "agent", agentKind: "alpha", model: "alpha-m1", presentationMode: "gui" },
      { kind: "agent", agentKind: "beta", model: "beta-m1", presentationMode: "gui" },
    ]);
    // The user asked the app to stop switching to the tab: the panel stays hidden.
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: "rt-new",
      shown: false,
      setup: null,
    });
  });

  it("posts an open chat's task as its first message so the participants answer", async () => {
    useRoundtableViewStore.setState({ setup: { nonce: 2, request: {} } });
    renderDialog({ projectId: "p1", pattern: "open" });
    typeTask("  What should we name the release?  ");
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(api.startRoundtable).toHaveBeenCalledTimes(1);
    expect(api.postToRoundtable).toHaveBeenCalledTimes(1);
    expect(api.postToRoundtable).toHaveBeenCalledWith(
      "rt-new",
      "What should we name the release?",
      undefined,
    );
    // Posted after the start resolved, then the dialog closed as usual.
    expect(api.startRoundtable.mock.invocationCallOrder[0]).toBeLessThan(
      api.postToRoundtable.mock.invocationCallOrder[0]!,
    );
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: "rt-new",
      shown: false,
      setup: null,
    });
  });

  it("links an open Roundtable started from a chat to that chat", async () => {
    renderDialog({ projectId: "p1", pattern: "open", originThreadId: "t1" });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(getRoundtableChatLink("t1")?.sessionId).toBe("rt-new");
  });

  it("routes an @mention in an open chat's task to that participant", async () => {
    renderDialog({ projectId: "p1", pattern: "open" });
    typeTask("@provider-beta-beta-one start with a plan");
    await act(async () => {
      fireEvent.click(startButton());
    });
    const seats = api.startRoundtable.mock.calls[0]![0].participants;
    expect(seats.map((seat) => seat.label)).toEqual([
      "Provider alpha · alpha One",
      "Provider beta · beta One",
    ]);
    expect(api.postToRoundtable).toHaveBeenCalledWith(
      "rt-new",
      "@provider-beta-beta-one start with a plan",
      { mentions: [seats[1]!.id] },
    );
  });

  it("does not post the task of a pattern that runs on its own", async () => {
    renderDialog({ projectId: "p1", task: "Fix it", pattern: "relay" });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(api.startRoundtable).toHaveBeenCalledTimes(1);
    expect(api.postToRoundtable).not.toHaveBeenCalled();
  });

  it("still closes after an open chat started but its first message was refused", async () => {
    api.postToRoundtable.mockRejectedValueOnce(new Error("This Roundtable has ended."));
    useRoundtableViewStore.setState({ setup: { nonce: 4, request: {} } });
    renderDialog({ projectId: "p1", task: "Say hello", pattern: "open" });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(api.postToRoundtable).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("This Roundtable has ended.")).toBeNull();
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: "rt-new",
      setup: null,
    });
  });

  it("leaves a Roundtable the user is reading in front after starting another", async () => {
    useRoundtableViewStore.setState({
      openSessionId: "rt-reading",
      shown: true,
      setup: { nonce: 3, request: {} },
    });
    renderDialog({ projectId: "p1", task: "Fix it" });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(api.startRoundtable).toHaveBeenCalledTimes(1);
    expect(useRoundtableViewStore.getState()).toMatchObject({
      openSessionId: "rt-reading",
      shown: true,
      setup: null,
    });
  });

  it("does not jump to a session whose setup was dismissed while it started", async () => {
    let resolve: (id: string) => void = () => undefined;
    api.startRoundtable.mockReturnValueOnce(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    useRoundtableViewStore.setState({ setup: { nonce: 7, request: {} } });
    renderDialog({ projectId: "p1", task: "Fix it" });
    await act(async () => {
      fireEvent.click(startButton());
    });
    act(() => {
      useRoundtableViewStore.setState({ setup: null });
    });
    await act(async () => {
      resolve("rt-late");
    });
    expect(useRoundtableViewStore.getState().openSessionId).toBeNull();
  });

  it("keeps the dialog open and shows why a start failed", async () => {
    api.startRoundtable.mockRejectedValueOnce(new Error("Project is busy"));
    useRoundtableViewStore.setState({ setup: { nonce: 1, request: {} } });
    renderDialog({ projectId: "p1", task: "Fix it" });
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByText("Project is busy")).toBeTruthy();
    expect(useRoundtableViewStore.getState().setup).not.toBeNull();
    expect(useRoundtableViewStore.getState().openSessionId).toBeNull();
  });

  it("keeps prefilled participants from the request", () => {
    renderDialog({
      projectId: "p1",
      task: "Fix it",
      participants: [
        participant("x", { label: "Reviewer bot", brain: { ...participant("x").brain } }),
        participant("y"),
      ],
    });
    const seats = within(screen.getByRole("list", { name: "Participants" })).getAllByRole(
      "listitem",
    );
    expect(seats).toHaveLength(2);
    expect(within(seats[0]!).getByText("kind-x/model-x")).toBeTruthy();
    // A prefilled seat whose agent is not ready for this project cannot start.
    expect(
      screen.getByText("A participant's agent is not signed in for this project."),
    ).toBeTruthy();
  });
  it("opens preselected to compare with every ready agent and no roles, rounds or checkout", async () => {
    api.ready = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map((kind) =>
      readyBrain(kind),
    );
    renderDialog({ projectId: "p1", pattern: "compare", task: "Which cache?" });
    expect(screen.getByRole("radio", { name: /Ask all \(compare\)/ })).toHaveProperty(
      "checked",
      true,
    );
    const seats = within(screen.getByRole("list", { name: "Participants" })).getAllByRole(
      "listitem",
    );
    // Every ready agent, up to the five-seat limit.
    expect(seats).toHaveLength(5);
    expect(screen.queryAllByLabelText(/Role of participant/)).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "Max rounds" })).toBeNull();
    expect(screen.getByText("One answer from each participant.")).toBeTruthy();
    expect(
      screen.getByText("Everyone reads the current checkout and changes no files."),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(startButton());
    });
    const input = api.startRoundtable.mock.calls[0]![0];
    expect(input).toMatchObject({ pattern: "compare", task: "Which cache?", projectId: "p1" });
    expect("maxRounds" in input).toBe(false);
    expect("worktree" in input).toBe(false);
    expect(input.participants.map((entry) => entry.role)).toEqual(Array(5).fill("member"));
    // Nothing to post: every participant answers the task on its own.
    expect(api.postToRoundtable).not.toHaveBeenCalled();
  });

  it("keeps seating providers that report late for Ask all, until the user edits the seats", () => {
    const request = { projectId: "p1", pattern: "compare" as const, task: "Which cache?" };
    const seatLabels = () =>
      within(screen.getByRole("list", { name: "Participants" }))
        .getAllByRole("listitem")
        .map(
          (seat) => within(seat).getByRole("button", { name: /Provider and model/ }).textContent,
        );
    // Statuses arrive one by one: only one agent has reported so far.
    api.ready = [readyBrain("alpha")];
    const view = renderDialog(request);
    expect(seatLabels()).toEqual(["alpha/alpha-m1"]);

    api.ready = [readyBrain("alpha"), readyBrain("beta"), readyBrain("gamma")];
    view.rerender(<RoundtableSetupDialog request={request} />);
    expect(seatLabels()).toEqual(["alpha/alpha-m1", "beta/beta-m1", "gamma/gamma-m1"]);

    // A provider that drops out of the ready list loses its seat while following.
    api.ready = [readyBrain("alpha"), readyBrain("gamma")];
    view.rerender(<RoundtableSetupDialog request={request} />);
    expect(seatLabels()).toEqual(["alpha/alpha-m1", "gamma/gamma-m1"]);

    // The same list again (a new array) does not reseat.
    const before = screen.getAllByRole("listitem").map((seat) => seat.dataset.vcRtSeat);
    api.ready = [readyBrain("alpha"), readyBrain("gamma")];
    view.rerender(<RoundtableSetupDialog request={request} />);
    expect(screen.getAllByRole("listitem").map((seat) => seat.dataset.vcRtSeat)).toEqual(before);

    // Once the user edits the seats, late statuses no longer change them.
    api.ready = [readyBrain("alpha"), readyBrain("gamma"), readyBrain("delta")];
    view.rerender(<RoundtableSetupDialog request={request} />);
    expect(seatLabels()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove participant 3" }));
    api.ready = ["alpha", "gamma", "delta", "epsilon"].map((kind) => readyBrain(kind));
    view.rerender(<RoundtableSetupDialog request={request} />);
    expect(seatLabels()).toEqual(["alpha/alpha-m1", "gamma/gamma-m1"]);
  });

  it("seats other patterns once, from the first ready list", () => {
    const request = { projectId: "p1", task: "Fix it" };
    api.ready = [readyBrain("alpha")];
    const view = renderDialog(request);
    const seats = () =>
      within(screen.getByRole("list", { name: "Participants" })).getAllByRole("listitem");
    expect(seats().map((seat) => seat.textContent)).toEqual([
      expect.stringContaining("alpha/alpha-m1"),
      expect.stringContaining("alpha/alpha-m1"),
    ]);
    api.ready = [readyBrain("alpha"), readyBrain("beta"), readyBrain("gamma")];
    view.rerender(<RoundtableSetupDialog request={request} />);
    expect(seats()).toHaveLength(2);
    expect(screen.queryByText("beta/beta-m1")).toBeNull();
  });

  it("seats the ready agents not seated yet when the compare card is picked", () => {
    api.ready = [readyBrain("alpha"), readyBrain("beta"), readyBrain("gamma")];
    renderDialog({ projectId: "p1", task: "Fix it", pattern: "build-review" });
    const list = () =>
      within(screen.getByRole("list", { name: "Participants" })).getAllByRole("listitem");
    expect(list()).toHaveLength(2);
    expect(screen.queryAllByLabelText(/Role of participant/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("radio", { name: /Ask all \(compare\)/ }));
    expect(list()).toHaveLength(3);
    expect(screen.queryAllByLabelText(/Role of participant/)).toHaveLength(0);
    expect(within(list()[2]!).getByText("gamma/gamma-m1")).toBeTruthy();
  });
});
