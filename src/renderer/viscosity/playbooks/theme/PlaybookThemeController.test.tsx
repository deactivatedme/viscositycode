import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import type { ThreadPlaybookBinding } from "@/shared/viscosity/playbook";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { applyAppTheme, getAppThemeOverride } from "@/renderer/theme/applyAppTheme";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { PlaybookThemeController } from "./PlaybookThemeController";
import { useRoundtablePlaybookTheme } from "./coverPlaybookTheme";
import { registerPanePlaybook } from "../playbookTargets";
import { DEFAULT_PLAYBOOK_VIEW_PREFS, setPlaybookViewPrefs } from "../viewPrefs";

const root = document.documentElement;

const reversing: ThreadPlaybookBinding = {
  version: 1,
  id: "reversing",
  label: "Reversing",
  instructions: "Reverse it.",
  themeId: "hostile-binary",
  switchPhrases: ["BREACH THE BINARY"],
  exitPhrases: ["STAND DOWN"],
};

function thread(id: string, playbook?: unknown): Thread {
  return {
    id,
    projectId: "p1",
    title: id,
    agentKind: "test-agent",
    config: playbook === undefined ? {} : { playbook },
  } as unknown as Thread;
}

function focus(threadId: string) {
  act(() => {
    useAppStore.setState({ focusedPaneId: threadId });
  });
}

function setPrefs(prefs: Parameters<typeof setPlaybookViewPrefs>[0]) {
  act(() => {
    setPlaybookViewPrefs(prefs);
  });
}

/** No switch animation or CRT attribute is left on <html>. */
function expectNoSwitchEffects() {
  expect(root.getAttributeNames().filter((name) => /^data-vc-(pb|crt)/.test(name))).toEqual([]);
  expect(document.querySelector("[data-vc-pb-fx]")).toBeNull();
}

beforeEach(() => {
  // Playbook themes are off by default; these tests are about what happens once allowed.
  setPlaybookViewPrefs({ ...DEFAULT_PLAYBOOK_VIEW_PREFS, themeOverride: true });
  useSharedSettings.setState({ themePreset: "github", customThemes: [], playbooks: [] } as never);
  useAppStore.setState({
    threads: [thread("plain"), thread("re", reversing), thread("future", { version: 2, id: "x" })],
    view: { kind: "thread", panes: ["plain", "re", "future"] },
    focusedPaneId: "plain",
  });
  applyAppTheme(root, "dark", "github");
});

afterEach(() => {
  root.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE);
});

describe("PlaybookThemeController", () => {
  it("switches instantly to the focused chat's playbook theme without saving it, and restores on leave", () => {
    const view = render(<PlaybookThemeController />);
    expect(getAppThemeOverride()).toBeNull();

    focus("re");
    expect(getAppThemeOverride()).toBe("hostile-binary");
    expect(root.dataset.themePreset).toBe("hostile-binary");
    expect(useSharedSettings.getState().themePreset).toBe("github");
    expectNoSwitchEffects();

    focus("plain");
    expect(getAppThemeOverride()).toBeNull();
    expect(root.dataset.themePreset).toBe("github");
    expectNoSwitchEffects();
    view.unmount();
  });

  it("follows the playbook picked in a new-chat draft before the first send", () => {
    const project = (playbook?: unknown) =>
      ({
        id: "p1",
        name: "p1",
        lastDraftConfig: {
          agentKind: "test-agent",
          model: "m",
          ...(playbook === undefined ? {} : { playbook }),
        },
      }) as unknown as Project;
    act(() => {
      useAppStore.setState({ projects: [project()], view: { kind: "draft", projectId: "p1" } });
    });
    const view = render(<PlaybookThemeController />);
    expect(getAppThemeOverride()).toBeNull();

    // Picking Reversing in the draft's chip writes the project's draft config.
    act(() => {
      useAppStore.setState({ projects: [project(reversing)] });
    });
    expect(getAppThemeOverride()).toBe("hostile-binary");

    // Sending turns the draft into a chat with the same playbook.
    act(() => {
      useAppStore.setState({ view: { kind: "thread", panes: ["re"] }, focusedPaneId: "re" });
    });
    expect(getAppThemeOverride()).toBe("hostile-binary");

    // A draft pane in a split view reads its project's draft config too.
    act(() => {
      useAppStore.setState({
        projects: [project(null)],
        view: { kind: "thread", panes: ["re", "draft:p1#x"] },
        focusedPaneId: "draft:p1#x",
      });
    });
    expect(getAppThemeOverride()).toBeNull();
    view.unmount();
  });

  it("applies on mount and restores the saved theme on unmount", () => {
    focus("re");
    const view = render(<PlaybookThemeController />);
    expect(getAppThemeOverride()).toBe("hostile-binary");
    view.unmount();
    expect(getAppThemeOverride()).toBeNull();
    expect(root.dataset.themePreset).toBe("github");
  });

  it("ignores future-version playbooks", () => {
    focus("future");
    const view = render(<PlaybookThemeController />);
    expect(getAppThemeOverride()).toBeNull();
    view.unmount();
  });

  it("follows the focused draft pane's own picker, not another draft of the same project", () => {
    const project = {
      id: "p1",
      name: "p1",
      lastDraftConfig: { agentKind: "test-agent", model: "m", playbook: reversing },
    } as unknown as Project;
    act(() => {
      useAppStore.setState({
        projects: [project],
        view: { kind: "thread", panes: ["draft:p1#a", "draft:p1#b"] },
        focusedPaneId: "draft:p1#a",
      });
    });
    const unregister: (() => void)[] = [];
    act(() => {
      unregister.push(registerPanePlaybook("draft:p1#a", reversing));
      unregister.push(registerPanePlaybook("draft:p1#b", undefined));
    });
    const view = render(<PlaybookThemeController />);
    expect(getAppThemeOverride()).toBe("hostile-binary");
    focus("draft:p1#b");
    expect(getAppThemeOverride()).toBeNull();
    // Without a mounted picker the project's draft config still decides.
    act(() => unregister.pop()?.());
    expect(getAppThemeOverride()).toBe("hostile-binary");
    act(() => unregister.pop()?.());
    view.unmount();
  });

  it("is off by default on a device that never chose", () => {
    setPrefs(DEFAULT_PLAYBOOK_VIEW_PREFS);
    const view = render(<PlaybookThemeController />);
    focus("re");
    expect(getAppThemeOverride()).toBeNull();
    view.unmount();
  });

  it("follows the 'Let playbooks change the theme' switch", () => {
    focus("re");
    const view = render(<PlaybookThemeController />);
    setPrefs({ themeOverride: false });
    expect(getAppThemeOverride()).toBeNull();
    setPrefs({ themeOverride: true });
    expect(getAppThemeOverride()).toBe("hostile-binary");
    view.unmount();
  });

  it("ignores the retired animation and CRT switches", () => {
    setPrefs({ switchAnimation: true, crtScanlines: true });
    const view = render(<PlaybookThemeController />);
    focus("re");
    expect(getAppThemeOverride()).toBe("hostile-binary");
    expectNoSwitchEffects();
    view.unmount();
  });

  it("follows a covering Roundtable view's table playbook while it is mounted", () => {
    function RoundtableCover(props: { playbookId: string | undefined }) {
      useRoundtablePlaybookTheme(props.playbookId);
      return null;
    }
    // Built-ins carry no theme; an edited copy of Reversing gives it one.
    useSharedSettings.setState({
      playbooks: [
        { id: "reversing", label: "Reversing", instructions: "R.", themeId: "hostile-binary" },
      ],
    } as never);
    const view = render(<PlaybookThemeController />);
    const cover = render(<RoundtableCover playbookId="reversing" />);
    expect(getAppThemeOverride()).toBe("hostile-binary");

    // No table playbook: the user's theme shows even though "re" is focused.
    focus("re");
    cover.rerender(<RoundtableCover playbookId={undefined} />);
    expect(getAppThemeOverride()).toBeNull();
    cover.rerender(<RoundtableCover playbookId="no-such-playbook" />);
    expect(getAppThemeOverride()).toBeNull();

    // Closing the view hands the theme back to the focused pane.
    cover.unmount();
    expect(getAppThemeOverride()).toBe("hostile-binary");
    view.unmount();
  });
});
