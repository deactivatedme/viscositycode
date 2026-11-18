import type { ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCapability, AgentStatus, UsageSnapshot } from "@/shared/contracts";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { I18nTestWrapper } from "@/renderer/testUtils/i18n";
import { DEFAULT_SMART_START_DOCUMENT, useSmartStartStore } from "./smartStartStore";
import {
  SMART_START_CONTROL_LABEL,
  useSmartStartDraft,
  withSmartStartControls,
  type SmartStartDraftInput,
} from "./useSmartStartDraft";

const shell = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/renderer/viscosity/layout/tabs/shellGate", () => ({
  useViscosityShellEnabled: () => shell.enabled,
}));

const PROJECT = "project-1";

const capabilities = {
  models: [{ id: "m-1", label: "Model One" }],
  efforts: [],
  modelEfforts: {},
  contextSizes: [],
  modes: ["agent"],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  presentationModes: ["gui", "terminal"],
  settingDefs: [],
} as unknown as AgentCapability;

function agent(kind: string, overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind,
    label: `${kind} label`,
    installed: true,
    authState: "authenticated",
    capabilities,
    ...overrides,
  } as AgentStatus;
}

function snapshot(providerId: string, usedPercent: number): UsageSnapshot {
  return {
    providerId,
    status: "ok",
    windows: [{ id: "5h", label: "5h", usedPercent }],
  } as unknown as UsageSnapshot;
}

const picker: ComposerControl = {
  kind: "provider-model",
  providers: [],
  currentAgentKind: "second",
  currentModel: "m-1",
  onChange: vi.fn<(next: { agentKind: string; model: string }) => void>(),
};

function wrapper({ children }: { children: ReactNode }) {
  return <I18nTestWrapper>{children}</I18nTestWrapper>;
}

function setup(overrides: Partial<SmartStartDraftInput> = {}) {
  const selectAgent = vi.fn<(agentKind: string) => void>();
  const initial: SmartStartDraftInput = {
    projectId: PROJECT,
    enabled: true,
    agents: [agent("first"), agent("second")],
    disabledAgents: [],
    presentationMode: "gui",
    lastDraftConfig: undefined,
    currentAgentKind: "second",
    selectAgent,
    ...overrides,
  };
  const hook = renderHook((props: SmartStartDraftInput) => useSmartStartDraft(props), {
    initialProps: initial,
    wrapper,
  });
  return { ...hook, selectAgent, initial };
}

function setAuto(enabled: boolean) {
  useSmartStartStore.setState({ autoByProject: { [PROJECT]: enabled } });
}

describe("withSmartStartControls", () => {
  const toggle: ComposerControl = { kind: "toggle", label: "Auto", isSelected: false };
  const effort: ComposerControl = { kind: "static", value: "effort" };

  it("puts the toggle right before the model picker, or first without one", () => {
    expect(withSmartStartControls([effort, picker], toggle, undefined)).toEqual([
      effort,
      toggle,
      picker,
    ]);
    expect(withSmartStartControls([effort], toggle, undefined)).toEqual([toggle, effort]);
  });

  it("reports picker choices before applying them", () => {
    const calls: string[] = [];
    const onChange = vi.fn<(next: { agentKind: string; model: string }) => void>(() => {
      calls.push("picker");
    });
    const [, wrapped] = withSmartStartControls([{ ...picker, onChange }], toggle, (agentKind) =>
      calls.push(`choice:${agentKind}`),
    );
    if (wrapped?.kind !== "provider-model") throw new Error("expected the picker");
    wrapped.onChange({ agentKind: "first", model: "m-1" });
    expect(calls).toEqual(["choice:first", "picker"]);
  });
});

describe("useSmartStartDraft", () => {
  beforeEach(() => {
    shell.enabled = true;
    localStorage.clear();
    useSmartStartStore.setState({ ...DEFAULT_SMART_START_DOCUMENT });
    useProviderUsageStore.setState({
      snapshots: { first: snapshot("first", 28), second: snapshot("second", 90) },
    });
  });
  afterEach(() => {
    localStorage.clear();
    useSmartStartStore.setState({ ...DEFAULT_SMART_START_DOCUMENT });
    useProviderUsageStore.setState({ snapshots: {} });
  });

  it("adds nothing outside the desktop shell", () => {
    shell.enabled = false;
    setAuto(true);
    const { result, selectAgent } = setup();
    expect(result.current.decorateControls([picker])).toEqual([picker]);
    expect(result.current.active).toBe(false);
    expect(result.current.panel).toBeNull();
    expect(selectAgent).not.toHaveBeenCalled();
  });

  it("offers an Auto toggle that is remembered per project", () => {
    const { result, rerender, initial } = setup();
    const [toggle] = result.current.decorateControls([picker]);
    expect(toggle).toMatchObject({
      kind: "toggle",
      label: SMART_START_CONTROL_LABEL,
      isSelected: false,
    });
    expect(result.current.panel).toBeNull();
    if (toggle?.kind !== "toggle") throw new Error("expected the toggle");
    toggle.onChange?.(true);
    rerender(initial);
    expect(useSmartStartStore.getState().autoByProject).toEqual({ [PROJECT]: true });
    expect(result.current.active).toBe(true);
  });

  it("switches the draft to the account with the most usage left and names it", () => {
    setAuto(true);
    const { result, selectAgent } = setup();
    expect(selectAgent).toHaveBeenCalledWith("first");
    render(<>{result.current.panel}</>, { wrapper });
    expect(screen.getByText("Will use: first label · Model One")).toBeTruthy();
    expect(screen.getByText("72% left")).toBeTruthy();
  });

  it("falls back to the manual picker with a message when no agent is ready", () => {
    setAuto(true);
    const { result, selectAgent } = setup({
      agents: [agent("first", { authState: "missing" }), agent("second", { installed: false })],
    });
    expect(selectAgent).not.toHaveBeenCalled();
    render(<>{result.current.panel}</>, { wrapper });
    expect(
      screen.getByText("No agent is ready to pick from. Pick one in the model picker."),
    ).toBeTruthy();
  });

  it("falls back with a message when every ready account is out of usage", () => {
    setAuto(true);
    useProviderUsageStore.setState({
      snapshots: { first: snapshot("first", 100), second: snapshot("second", 100) },
    });
    const { result, selectAgent } = setup();
    expect(selectAgent).not.toHaveBeenCalled();
    render(<>{result.current.panel}</>, { wrapper });
    expect(
      screen.getByText("Every ready account is out of usage. Pick one in the model picker."),
    ).toBeTruthy();
  });

  it("keeps the owner's own pick from the model picker", () => {
    setAuto(true);
    const { result, rerender, selectAgent, initial } = setup({ currentAgentKind: "first" });
    expect(selectAgent).not.toHaveBeenCalled();
    const decorated = result.current.decorateControls([picker]);
    const wrappedPicker = decorated.find((control) => control.kind === "provider-model");
    if (wrappedPicker?.kind !== "provider-model") throw new Error("expected the picker");
    wrappedPicker.onChange({ agentKind: "second", model: "m-1" });
    rerender({ ...initial, currentAgentKind: "second" });
    expect(selectAgent).not.toHaveBeenCalled();
    render(<>{result.current.panel}</>, { wrapper });
    expect(screen.getByText("Your pick: second label · Model One")).toBeTruthy();
  });

  it("keeps a picker choice Auto could not have picked, such as one that needs a sign-in", () => {
    setAuto(true);
    const { result, rerender, selectAgent, initial } = setup({
      agents: [agent("first"), agent("second", { authState: "missing" })],
      currentAgentKind: "first",
    });
    const wrappedPicker = result.current
      .decorateControls([picker])
      .find((control) => control.kind === "provider-model");
    if (wrappedPicker?.kind !== "provider-model") throw new Error("expected the picker");
    act(() => wrappedPicker.onChange({ agentKind: "second", model: "m-1" }));
    rerender({ ...initial, currentAgentKind: "second" });
    // Auto never yanks the draft back to its own pick.
    expect(selectAgent).not.toHaveBeenCalled();
    render(<>{result.current.panel}</>, { wrapper });
    expect(screen.getByText("Your pick: second label · Model One")).toBeTruthy();
  });

  it("does not force a picker choice the draft refused", () => {
    setAuto(true);
    const { result, rerender, selectAgent, initial } = setup({ currentAgentKind: "first" });
    const wrappedPicker = result.current
      .decorateControls([picker])
      .find((control) => control.kind === "provider-model");
    if (wrappedPicker?.kind !== "provider-model") throw new Error("expected the picker");
    // The draft keeps "first" (for example a surface switch it could not map).
    act(() => wrappedPicker.onChange({ agentKind: "second", model: "m-1" }));
    rerender({ ...initial, currentAgentKind: "first" });
    expect(selectAgent).not.toHaveBeenCalled();
    render(<>{result.current.panel}</>, { wrapper });
    expect(screen.getByText("Your pick: first label · Model One")).toBeTruthy();
  });

  it("switches the draft at once when another account is chosen with Change", async () => {
    setAuto(true);
    const { result, selectAgent } = setup({ currentAgentKind: "first" });
    render(<>{result.current.panel}</>, { wrapper });
    fireEvent.click(screen.getByLabelText("Change"));
    fireEvent.click(await screen.findByText("second label · Model One"));
    expect(selectAgent).toHaveBeenLastCalledWith("second");
  });

  it("keeps focus in the composer when Auto is turned off from the row", () => {
    setAuto(true);
    const { result } = setup({ currentAgentKind: "first" });
    render(
      <div data-poracode-composer="">
        {result.current.panel}
        <div data-composer-input-anchor="">
          <textarea aria-label="Prompt" />
        </div>
      </div>,
      { wrapper },
    );
    fireEvent.click(screen.getByLabelText("Turn off Auto"));
    expect(useSmartStartStore.getState().autoByProject).toEqual({ [PROJECT]: false });
    expect(document.activeElement).toBe(screen.getByLabelText("Prompt"));
  });

  it("returns to the automatic pick after an override", () => {
    setAuto(true);
    const { result, rerender, selectAgent, initial } = setup({ currentAgentKind: "first" });
    const wrappedPicker = result.current
      .decorateControls([picker])
      .find((control) => control.kind === "provider-model");
    if (wrappedPicker?.kind !== "provider-model") throw new Error("expected the picker");
    act(() => wrappedPicker.onChange({ agentKind: "second", model: "m-1" }));
    rerender({ ...initial, currentAgentKind: "second" });
    render(<>{result.current.panel}</>, { wrapper });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Back to the automatic pick" }));
    });
    expect(selectAgent).toHaveBeenLastCalledWith("first");
  });

  it("remembers hand-picked providers only", () => {
    const onStart = vi.fn<(input: { agentKind: string }) => "accepted">(() => "accepted");
    const manual = setup();
    expect(manual.result.current.wrapStart(onStart)({ agentKind: "second:work" })).toBe("accepted");
    expect(onStart).toHaveBeenCalledWith({ agentKind: "second:work" });
    expect(useSmartStartStore.getState().recentProviders).toEqual(["second"]);
    manual.unmount();

    setAuto(true);
    const auto = setup({ currentAgentKind: "first" });
    auto.result.current.wrapStart(onStart)({ agentKind: "first" });
    expect(useSmartStartStore.getState().recentProviders).toEqual(["second"]);
  });
});
