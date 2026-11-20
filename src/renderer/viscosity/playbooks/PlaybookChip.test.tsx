import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { ProjectLocation, ThreadConfig } from "@/shared/contracts";
import { playbookBindingFromSaved } from "@/shared/viscosity/playbook";

const shell = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/renderer/viscosity/layout/tabs/shellGate", () => ({
  useViscosityShellEnabled: () => shell.enabled,
}));

import { PlaybookChip } from "./PlaybookChip";
import { activePlaybookTarget } from "./playbookTargets";

const base: ThreadConfig = { model: "m", mode: "plan" };

function renderChip(
  config: ThreadConfig,
  extra: { restartNote?: string; projectLocation?: ProjectLocation } = {},
) {
  const onConfigChange = vi.fn<(patch: Partial<ThreadConfig>) => void>();
  const view = render(
    <PlaybookChip
      targetKey="thread-1"
      config={config}
      onConfigChange={onConfigChange}
      projectMcpServers={[]}
      browserAvailable
      projectLocation={undefined}
      terminal={false}
      {...extra}
    />,
  );
  return { onConfigChange, ...view };
}

beforeEach(() => {
  shell.enabled = true;
  useSharedSettings.setState({
    mcpServers: [
      {
        id: "srv-ghidra",
        name: "ghidra",
        description: "",
        enabled: false,
        timeoutMs: 1000,
        transport: { type: "stdio", command: "ghidra-mcp", args: [] },
      },
    ],
    playbooks: [],
  } as never);
});
afterEach(() => {
  useSharedSettings.setState({ mcpServers: [], playbooks: [] } as never);
  Reflect.deleteProperty(window, "viscosityHost");
});

function installLiveRe(reply: unknown) {
  const checkEnvironment = vi.fn<() => Promise<unknown>>(async () => reply);
  Object.assign(window, {
    viscosityHost: { liveRe: { available: true, checkEnvironment } },
  });
  return checkEnvironment;
}

function openPicker() {
  fireEvent.click(
    screen.getByRole("button", { name: "Playbook: standing instructions and tools for this chat" }),
  );
}

describe("PlaybookChip", () => {
  it("is hidden outside the desktop shell", () => {
    shell.enabled = false;
    const { container } = renderChip(base);
    expect(container).toBeEmptyDOMElement();
  });

  it("applies a picked playbook through onConfigChange without touching the mode", () => {
    const { onConfigChange } = renderChip(base);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Playbook: standing instructions and tools for this chat",
      }),
    );
    expect(screen.getByText(/Plan, Agent and Autopilot are separate/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Reversing/ }));
    const patch = onConfigChange.mock.calls[0]?.[0];
    expect(patch?.playbook).toMatchObject({ id: "reversing", mcpServerIds: ["srv-ghidra"] });
    expect(patch?.mcpServerOverrides).toEqual({ "srv-ghidra": true });
    expect(patch).not.toHaveProperty("mode");
  });

  it("shows the current playbook, clears it with the X and offers Update to latest", () => {
    const stale = playbookBindingFromSaved({
      id: "review",
      label: "Review",
      icon: "scan-eye",
      readOnly: true,
      instructions: "Old review text.",
    });
    const { onConfigChange } = renderChip(
      { ...base, playbook: stale },
      { restartNote: "Restart soon." },
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn off the Review playbook" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({ playbook: null });
    fireEvent.click(
      screen.getByRole("button", { name: "Playbook: Review · Asks the agent not to edit files" }),
    );
    expect(screen.getByText("Restart soon.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Update to latest" }));
    expect(onConfigChange.mock.lastCall?.[0].playbook).toMatchObject({ id: "review" });
    expect(onConfigChange.mock.lastCall?.[0].playbook).not.toMatchObject({
      instructions: "Old review text.",
    });
  });

  it("serves the palette: apply by id and off for the focused pane's picker", () => {
    const { onConfigChange, unmount } = renderChip(base);
    act(() => activePlaybookTarget()?.apply("debug"));
    expect(onConfigChange.mock.lastCall?.[0].playbook).toMatchObject({ id: "debug" });
    unmount();
    expect(activePlaybookTarget()).toBeUndefined();
  });

  it("shows live_re as unavailable for a WSL project and never switches it on", () => {
    const { onConfigChange } = renderChip(base, {
      projectLocation: {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/u/p",
        uncPath: "\\\\wsl$\\Ubuntu\\home\\u\\p",
      },
    });
    openPicker();
    const live = screen.getByRole("menuitemradio", { name: /Live reversing/ });
    expect(within(live).getByText(/live_re: not available here/)).toBeInTheDocument();
    expect(within(live).getByText(/ghidra: on/)).toBeInTheDocument();
    fireEvent.click(live);
    expect(onConfigChange.mock.lastCall?.[0].mcpServerOverrides).toEqual({ "srv-ghidra": true });
  });

  it("shows live_re as unavailable when the desktop build has no helper", async () => {
    installLiveRe({ status: "missing" });
    const { onConfigChange } = renderChip(base);
    openPicker();
    const live = screen.getByRole("menuitemradio", { name: /Live reversing/ });
    await waitFor(() =>
      expect(within(live).getByText(/live_re: not available here/)).toBeInTheDocument(),
    );
    fireEvent.click(live);
    expect(onConfigChange.mock.lastCall?.[0].playbook).toMatchObject({
      mcpServerIds: ["srv-ghidra"],
    });
  });

  it("leaves a remote server's project to that host, whatever this build has", async () => {
    installLiveRe({ status: "missing" });
    renderChip(base, { projectLocation: { kind: "posix", path: "/p", remoteServerId: "r1" } });
    openPicker();
    const live = screen.getByRole("menuitemradio", { name: /Live reversing/ });
    await act(async () => {});
    expect(within(live).getByText(/live_re, ghidra: on/)).toBeInTheDocument();
  });

  it("probes the helper only when the picker opens", async () => {
    const checkEnvironment = installLiveRe({ status: "missing" });
    renderChip(base);
    await act(async () => {});
    expect(checkEnvironment).not.toHaveBeenCalled();
    openPicker();
    await waitFor(() => expect(checkEnvironment).toHaveBeenCalledTimes(1));
  });

  it("waits for the probe before the palette applies a live_re playbook", async () => {
    let answer: (reply: unknown) => void = () => {};
    const checkEnvironment = vi.fn<() => Promise<unknown>>(
      () =>
        new Promise<unknown>((resolve) => {
          answer = resolve;
        }),
    );
    Object.assign(window, { viscosityHost: { liveRe: { available: true, checkEnvironment } } });
    const { onConfigChange } = renderChip(base);
    act(() => activePlaybookTarget()?.apply("live-reversing"));
    expect(checkEnvironment).toHaveBeenCalledTimes(1);
    expect(onConfigChange).not.toHaveBeenCalled();
    await act(async () => answer({ status: "missing" }));
    expect(onConfigChange.mock.lastCall?.[0].mcpServerOverrides).toEqual({ "srv-ghidra": true });
  });

  it("switches live_re on from the palette when the helper is staged", async () => {
    installLiveRe({ status: "error", code: "timeout" });
    const { onConfigChange } = renderChip(base);
    act(() => activePlaybookTarget()?.apply("live-reversing"));
    await waitFor(() =>
      expect(onConfigChange.mock.lastCall?.[0].mcpServerOverrides).toEqual({
        "srv-ghidra": true,
        "viscosity.live-re": true,
      }),
    );
  });

  it("keeps live_re on when the helper answers", async () => {
    installLiveRe({ status: "error", code: "timeout" });
    renderChip(base);
    openPicker();
    const live = screen.getByRole("menuitemradio", { name: /Live reversing/ });
    await waitFor(() => expect(within(live).getByText(/live_re, ghidra: on/)).toBeInTheDocument());
  });
});
