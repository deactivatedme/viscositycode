import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { viscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import {
  ASK_ALL_MODELS_COMMAND_ID,
  compareCommands,
  openAskAllModels,
  registerCompareCommands,
} from "./compareCommands";
import { useRoundtableViewStore } from "./roundtableViewStore";

let releaseShell: (() => void) | undefined;

beforeEach(() => {
  useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  useAppStore.setState({
    threads: [{ id: "t1", projectId: "p2" } as Thread],
    view: { kind: "thread", panes: ["t1"] },
    focusedPaneId: "t1",
  });
});

afterEach(() => {
  releaseShell?.();
  releaseShell = undefined;
});

describe("Ask all models… command", () => {
  it("is registered with the fork's palette commands", () => {
    registerCompareCommands();
    registerCompareCommands();
    const matches = viscosityCommands().filter(
      (command) => command.id === ASK_ALL_MODELS_COMMAND_ID,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.when).toBe("hasProject");
  });

  it("is offered only in the desktop shell", () => {
    expect(compareCommands()[0]).toMatchObject({ showInPalette: false, showInShortcuts: false });
    releaseShell = acquireViscosityShellFlag(document.documentElement);
    expect(compareCommands()[0]!.showInPalette).toBeUndefined();
  });

  it("opens the setup dialog preselected to compare for the focused thread's project", () => {
    releaseShell = acquireViscosityShellFlag(document.documentElement);
    openAskAllModels();
    expect(useRoundtableViewStore.getState().setup?.request).toEqual({
      pattern: "compare",
      projectId: "p2",
    });
    // It never switches the view.
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: null, shown: false });
  });
});
