import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import type { AgentStatus } from "@/shared/contracts";
import { AGENT_PROFILE_DRIVERS } from "@/shared/contracts/agentProfiles";
import { useAgentColors } from "./agentColorsStore";
import { AGENT_KIND_ATTRIBUTE } from "./api";
import { assignDefaultAgentColors, knownAgentKinds } from "./assignment";
import { AgentColorsSettings } from "./AgentColorsSettings";
import { findAgentColor } from "./palette";
import { buildAgentColorRows } from "./settingsModel";

const DRIVER = AGENT_PROFILE_DRIVERS[0]!.driver;
const PROFILE = `${DRIVER}:work`;

const status = (kind: string, label: string, installed = true) =>
  ({ kind, label, installed }) as unknown as AgentStatus;

const NATIVE = [
  status("agent-a", "Agent A"),
  status(DRIVER, "Driver Agent"),
  status(PROFILE, "Driver Work"),
  status("agent-off", "Not Installed", false),
];
const WSL = [status("agent-wsl", "WSL Agent"), status("agent-a", "Agent A (WSL)")];

/** Flip a switch through its visible track, as a pointer user would. */
function toggle(name: string) {
  const input = screen.getByRole("switch", { name });
  const track = input.closest(".switch")?.querySelector(".switch__control");
  fireEvent.click(track ?? input);
}

function colorName(kind: string): string {
  const row = buildAgentColorRows(NATIVE, WSL, useAgentColors.getState().colors).find(
    (entry) => entry.kind === kind,
  );
  return findAgentColor(row!.color).label.message!;
}

describe("buildAgentColorRows", () => {
  it("lists installed agents with the colours the stylesheet uses", () => {
    const defaults = assignDefaultAgentColors(knownAgentKinds(NATIVE, WSL));
    const rows = buildAgentColorRows(NATIVE, WSL, { "agent-wsl": "lime" });
    expect(rows.map((row) => row.kind)).toEqual(["agent-a", DRIVER, PROFILE, "agent-wsl"]);
    expect(rows[0]).toMatchObject({ color: defaults["agent-a"], source: "automatic" });
    expect(rows[2]).toMatchObject({
      color: defaults[DRIVER],
      source: "inherited",
      inheritedFromLabel: "Driver Agent",
    });
    expect(rows[3]).toMatchObject({ color: "lime", source: "custom" });
  });
});

describe("AgentColorsSettings", () => {
  let initialStatuses: ReturnType<typeof useAgentStatusesStore.getState>;

  beforeEach(() => {
    localStorage.clear();
    useAgentColors.getState().reset();
    initialStatuses = useAgentStatusesStore.getState();
    useAgentStatusesStore.setState({ agentStatuses: NATIVE, wslAgentStatuses: WSL });
  });

  afterEach(() => {
    useAgentStatusesStore.setState(initialStatuses, true);
    useAgentColors.getState().reset();
  });

  it("lists each installed agent once with where its colour comes from", () => {
    render(<AgentColorsSettings />);
    const list = screen.getByRole("list", { name: "Installed agents" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute(AGENT_KIND_ATTRIBUTE))).toEqual([
      "agent-a",
      DRIVER,
      PROFILE,
      "agent-wsl",
    ]);
    expect(within(items[0]!).getByText("Automatic")).toBeTruthy();
    expect(within(items[2]!).getByText("Same as Driver Agent")).toBeTruthy();
    expect(screen.queryByText("Not Installed")).toBeNull();
  });

  it("turns the pane and tab markers off and on", () => {
    render(<AgentColorsSettings />);
    const name = "Colour panes and tabs by agent";
    expect(screen.getByRole("switch", { name })).toBeChecked();
    toggle(name);
    expect(useAgentColors.getState().enabled).toBe(false);
    toggle(name);
    expect(useAgentColors.getState().enabled).toBe(true);
  });

  it("picks a colour from the palette and resets it", async () => {
    render(<AgentColorsSettings />);
    const reset = screen.getByRole("button", { name: "Reset colour for Agent A" });
    expect(reset).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: `Colour for Agent A: ${colorName("agent-a")}` }),
    );
    const palette = await screen.findByRole("group", { name: "Colour for Agent A" });
    const current = within(palette).getByRole("button", { pressed: true });
    expect(current.getAttribute("aria-label")).toBe(colorName("agent-a"));

    fireEvent.click(within(palette).getByRole("button", { name: "Fuchsia" }));
    expect(useAgentColors.getState().colors).toEqual({ "agent-a": "fuchsia" });
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Colour for Agent A" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Colour for Agent A: Fuchsia" })).toBeTruthy();
    expect(screen.getByText("Your colour")).toBeTruthy();

    const enabledReset = screen.getByRole("button", { name: "Reset colour for Agent A" });
    expect(enabledReset).not.toBeDisabled();
    fireEvent.click(enabledReset);
    expect(useAgentColors.getState().colors).toEqual({});
  });

  it("shows a profile following its driver's pick", () => {
    render(<AgentColorsSettings />);
    act(() => useAgentColors.getState().setColor(DRIVER, "teal"));
    expect(screen.getByRole("button", { name: "Colour for Driver Work: Teal" })).toBeTruthy();
  });

  it("says when no agent is installed", () => {
    useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
    render(<AgentColorsSettings />);
    expect(screen.getByText("No agents are installed yet.")).toBeTruthy();
  });
});
