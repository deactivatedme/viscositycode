import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentCapability, Thread, ThreadConfig } from "@/shared/contracts";
import { playbookBindingFromSaved } from "@/shared/viscosity/playbook";
import { I18nTestWrapper } from "@/renderer/testUtils/i18n";

const unload = vi.hoisted(() =>
  vi.fn<(threadId: string, options: { keepSidePanels: true }) => Promise<void>>(),
);
vi.mock("@/renderer/actions/threadActions", () => ({ unloadStoredThread: unload }));

import { usePlaybookSessionRelaunch } from "./usePlaybookSessionRelaunch";

const reversing = playbookBindingFromSaved(
  { id: "reversing", label: "Reversing", instructions: "Reverse." },
  ["srv-ghidra"],
);
const thread = {
  id: "thread-1",
  projectId: "project-1",
  agentKind: "agent-a",
  title: "RE",
  config: { model: "m", playbook: reversing, mcpServerOverrides: { "srv-ghidra": true } },
  status: "idle",
  presentationMode: "gui",
  sessionRef: { providerSessionId: "session-1", discoveredAt: "2026-11-01T00:00:00.000Z" },
} as unknown as Thread;
const capabilities = {
  mcpScope: { gui: "launch", terminal: "none" },
} as unknown as AgentCapability;
const launchConfig: ThreadConfig = { model: "m" };
const gates = {
  thread,
  capabilities,
  runtimeLaunchConfig: launchConfig,
  pendingSteer: null,
  queuedFollowUp: null,
  openRuntimeRequest: false,
  activeSubAgent: false,
};

describe("usePlaybookSessionRelaunch", () => {
  afterEach(() => unload.mockClear());

  it("unloads an idle chat once when its playbook switched on servers the session lacks", async () => {
    const { rerender } = renderHook((input) => usePlaybookSessionRelaunch(input), {
      initialProps: gates,
      wrapper: I18nTestWrapper,
    });
    await waitFor(() => expect(unload).toHaveBeenCalledWith("thread-1", { keepSidePanels: true }));
    rerender({ ...gates });
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it("never restarts busy chats, pending work, launches that already have the servers, or other scopes", () => {
    for (const input of [
      { ...gates, thread: { ...thread, status: "working" } as Thread },
      { ...gates, pendingSteer: { text: "x" } },
      { ...gates, queuedFollowUp: [{ id: "f" }] },
      { ...gates, openRuntimeRequest: true },
      { ...gates, activeSubAgent: true },
      { ...gates, runtimeLaunchConfig: { model: "m", mcpServerOverrides: { "srv-ghidra": true } } },
      { ...gates, capabilities: { mcpScope: { gui: "none" } } as unknown as AgentCapability },
      { ...gates, capabilities: undefined },
      { ...gates, thread: { ...thread, presentationMode: "terminal" } as Thread },
    ]) {
      renderHook(() => usePlaybookSessionRelaunch(input), { wrapper: I18nTestWrapper });
    }
    expect(unload).not.toHaveBeenCalled();
  });

  it('restarts per-turn ("always") providers too: custom and host servers are fixed at launch', async () => {
    const always = { mcpScope: { gui: "always" } } as unknown as AgentCapability;
    renderHook(() => usePlaybookSessionRelaunch({ ...gates, capabilities: always }), {
      wrapper: I18nTestWrapper,
    });
    await waitFor(() => expect(unload).toHaveBeenCalledTimes(1));
  });

  it("restarts when a playbook switch turned off servers the session launched with", async () => {
    const off = {
      ...thread,
      config: { model: "m", playbook: null, mcpServerOverrides: {} },
    } as unknown as Thread;
    renderHook(
      () =>
        usePlaybookSessionRelaunch({
          ...gates,
          thread: off,
          runtimeLaunchConfig: { model: "m", mcpServerOverrides: { "viscosity.live-re": true } },
        }),
      { wrapper: I18nTestWrapper },
    );
    await waitFor(() => expect(unload).toHaveBeenCalledTimes(1));
  });

  it('restarts for the browser only under "launch": on with a playbook, or explicitly off', async () => {
    const browserOnly = playbookBindingFromSaved(
      { id: "web-qa", label: "Web QA", instructions: "QA." },
      ["viscosity.browser"],
    );
    const on = {
      ...thread,
      config: { model: "m", playbook: browserOnly, browserMcp: true },
    } as unknown as Thread;
    const always = { mcpScope: { gui: "always" } } as unknown as AgentCapability;
    renderHook(() => usePlaybookSessionRelaunch({ ...gates, thread: on, capabilities: always }), {
      wrapper: I18nTestWrapper,
    });
    expect(unload).not.toHaveBeenCalled();
    renderHook(() => usePlaybookSessionRelaunch({ ...gates, thread: on }), {
      wrapper: I18nTestWrapper,
    });
    await waitFor(() => expect(unload).toHaveBeenCalledTimes(1));
    const left = {
      ...thread,
      config: { model: "m", playbook: null, browserMcp: false },
    } as unknown as Thread;
    renderHook(
      () =>
        usePlaybookSessionRelaunch({
          ...gates,
          thread: left,
          runtimeLaunchConfig: { model: "m", browserMcp: true },
        }),
      { wrapper: I18nTestWrapper },
    );
    await waitFor(() => expect(unload).toHaveBeenCalledTimes(2));
  });

  it("returns a restart note instead when the chat has no session yet", () => {
    const { result } = renderHook(
      () =>
        usePlaybookSessionRelaunch({
          ...gates,
          thread: { ...thread, sessionRef: undefined } as unknown as Thread,
        }),
      { wrapper: I18nTestWrapper },
    );
    expect(result.current).toBe("The playbook's tools join when this chat restarts.");
    expect(unload).not.toHaveBeenCalled();
  });
});
