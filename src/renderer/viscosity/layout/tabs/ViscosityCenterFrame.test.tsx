import type { MessageDescriptor } from "@lingui/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { DEFAULT_KEYBINDINGS } from "@/shared/keybindings";
import type { PlatformName } from "@/renderer/commands/keybindingMatcher";
import { buildCommandRegistry } from "@/renderer/commands/registry";
import { buildShortcutRows, SHORTCUT_CONTEXTS } from "@/renderer/commands/shortcutCatalog";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { viscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { OPEN_MISSION_CONTROL_COMMAND_ID } from "@/renderer/viscosity/missionControl/paletteCommands";
import { useMissionControlTabs } from "@/renderer/viscosity/missionControl/tabs";
import { ASK_ALL_MODELS_COMMAND_ID } from "@/renderer/viscosity/roundtable/ui/compareCommands";
import {
  acquireViscosityShellFlag,
  VISCOSITY_SHELL_ATTRIBUTE,
} from "@/renderer/viscosity/shellFlag";
import { OPEN_SUBSCRIPTIONS_COMMAND_ID } from "@/renderer/viscosity/subscriptions/paletteCommands";
import { TOGGLE_ZEN_MODE_COMMAND_ID } from "@/renderer/viscosity/zen/zenCommands";
import {
  exitZenMode,
  isZenModeActive,
  toggleZenMode,
  ZEN_ATTRIBUTE,
} from "@/renderer/viscosity/zen/zenModeStore";
// The real startup import: the main layout imports the center frame, which
// imports every center-hosted fork feature (and through them their commands).
import { ViscosityCenterFrame } from "./ViscosityCenterFrame";

const threadActions = vi.hoisted(() => ({
  openThread: vi.fn<(threadId: string) => void>(),
  openNewThread: vi.fn<(projectId?: string) => void>(),
}));

vi.mock("@/renderer/actions/threadActions", () => threadActions);

const root = document.documentElement;
const PLATFORMS = ["darwin", "win32", "linux"] as const satisfies readonly PlatformName[];

/** Commands registered by the Step 5 features the center frame wires up. */
const FEATURE_COMMAND_IDS = [
  TOGGLE_ZEN_MODE_COMMAND_ID,
  OPEN_MISSION_CONTROL_COMMAND_ID,
  OPEN_SUBSCRIPTIONS_COMMAND_ID,
  ASK_ALL_MODELS_COMMAND_ID,
];

const resolveLabel = (value: string | MessageDescriptor): string =>
  typeof value === "string" ? value : (value.message ?? String(value.id));

let releaseShell: (() => void) | null = null;

beforeEach(() => {
  useAppStore.setState({
    threads: [{ id: "a", projectId: "p1", title: "Thread a", agentKind: "test-agent" } as Thread],
    projects: [{ id: "p1", name: "Project", location: { kind: "local" } } as unknown as Project],
    view: { kind: "thread", panes: ["a"] },
    focusedPaneId: "a",
  });
  root.dataset.windowKind = "main";
});

afterEach(() => {
  act(() => {
    exitZenMode();
  });
  releaseShell?.();
  releaseShell = null;
  root.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
  delete root.dataset.windowKind;
});

describe("ViscosityCenterFrame startup wiring", () => {
  it("registers Zen, Mission Control, Subscriptions and Ask all models commands once each", () => {
    const ids = buildCommandRegistry().map((command) => command.id);
    expect(
      FEATURE_COMMAND_IDS.map((id) => [id, ids.filter((entry) => entry === id).length]),
    ).toEqual(FEATURE_COMMAND_IDS.map((id) => [id, 1]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps new fork command ids in the viscosity namespace", () => {
    expect(TOGGLE_ZEN_MODE_COMMAND_ID).toBe("viscosity.zen.toggle");
    expect(OPEN_MISSION_CONTROL_COMMAND_ID).toBe("viscosity.missionControl.open");
    expect(OPEN_SUBSCRIPTIONS_COMMAND_ID).toBe("viscosity.subscriptions.open");
    for (const command of viscosityCommands()) {
      expect(command.id).toMatch(/^(viscosity|roundtable)\.[a-zA-Z]+(\.[a-zA-Z]+)?$/);
    }
  });

  it("adds the Subscriptions tab to Mission Control after Agents", () => {
    const { result } = renderHook(() => useMissionControlTabs());
    const ids = result.current.map((tab) => tab.id);
    expect(ids.slice(0, 2)).toEqual(["agents", "subscriptions"]);
  });

  it("offers every feature command in the desktop shell with a title no other command uses", () => {
    releaseShell = acquireViscosityShellFlag(root);
    const commands = buildCommandRegistry();
    const hidden = FEATURE_COMMAND_IDS.filter(
      (id) => commands.find((entry) => entry.id === id)?.showInPalette === false,
    );
    expect(hidden).toEqual([]);
    const duplicates: string[] = [];
    for (const platform of PLATFORMS) {
      const rows = buildShortcutRows(
        commands,
        DEFAULT_KEYBINDINGS.keybindings,
        platform,
        resolveLabel,
      );
      for (const context of SHORTCUT_CONTEXTS.map((entry) => entry.id)) {
        if (context === "all") continue;
        const seen = new Map<string, string>();
        for (const row of rows) {
          if (!row.contexts.includes(context)) continue;
          const title = row.title.trim().toLowerCase();
          const previous = seen.get(title);
          if (previous) {
            duplicates.push(`${platform} ${context} "${title}": ${previous} vs ${row.id}`);
          }
          seen.set(title, row.id);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("mounts Zen mode in the desktop shell and turns it off when the shell goes away", () => {
    releaseShell = acquireViscosityShellFlag(root);
    const view = render(
      <ViscosityCenterFrame>
        <div data-testid="content" />
      </ViscosityCenterFrame>,
    );
    act(() => {
      toggleZenMode();
    });
    expect(isZenModeActive()).toBe(true);
    expect(document.querySelector("[data-vc-zen-exit]")).not.toBeNull();
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(true);

    view.unmount();
    expect(isZenModeActive()).toBe(false);
    expect(root.hasAttribute(ZEN_ATTRIBUTE)).toBe(false);
    expect(document.querySelector("[data-vc-zen-exit]")).toBeNull();
  });
});
