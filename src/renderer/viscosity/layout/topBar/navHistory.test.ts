import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import {
  canNavigateBack,
  canNavigateForward,
  NAV_HISTORY_CAP,
  navigateBack,
  navigateForward,
  recordNavFocus,
  resetNavHistory,
  startNavHistory,
} from "./navHistory";

const tabActions = vi.hoisted(() => ({ activateThreadTab: vi.fn<(threadId: string) => void>() }));
vi.mock("../tabs/tabActions", () => tabActions);

function threads(ids: string[], archived: string[] = []): Thread[] {
  return ids.map(
    (id) => ({ id, projectId: "p", title: id, archived: archived.includes(id) }) as Thread,
  );
}

beforeEach(() => {
  resetNavHistory();
  tabActions.activateThreadTab.mockReset();
  useAppStore.setState({ threads: threads(["a", "b", "c", "d"]) });
});

afterEach(() => {
  resetNavHistory();
});

describe("navHistory", () => {
  it("goes back and forward through recorded threads", () => {
    for (const id of ["a", "b", "c"]) recordNavFocus(id);
    expect(canNavigateForward()).toBe(false);
    navigateBack();
    expect(tabActions.activateThreadTab).toHaveBeenLastCalledWith("b");
    navigateBack();
    expect(tabActions.activateThreadTab).toHaveBeenLastCalledWith("a");
    expect(canNavigateBack()).toBe(false);
    navigateForward();
    expect(tabActions.activateThreadTab).toHaveBeenLastCalledWith("b");
  });

  it("drops the forward stack on a new navigation and ignores repeats", () => {
    for (const id of ["a", "b", "c"]) recordNavFocus(id);
    navigateBack();
    recordNavFocus("b"); // the focus the back move itself causes
    expect(canNavigateForward()).toBe(true);
    recordNavFocus("d");
    expect(canNavigateForward()).toBe(false);
  });

  it("goes back to the thread just left from a new session", () => {
    for (const id of ["a", "b"]) recordNavFocus(id);
    recordNavFocus(null); // + New: focus leaves b for a draft
    expect(canNavigateForward()).toBe(false);
    navigateBack();
    expect(tabActions.activateThreadTab).toHaveBeenLastCalledWith("b");
    recordNavFocus("b");
    navigateBack();
    expect(tabActions.activateThreadTab).toHaveBeenLastCalledWith("a");
  });

  it("keeps the forward stack when focus briefly leaves and returns", () => {
    for (const id of ["a", "b", "c"]) recordNavFocus(id);
    navigateBack();
    recordNavFocus(null);
    expect(canNavigateForward()).toBe(false);
    recordNavFocus("b");
    expect(canNavigateForward()).toBe(true);
    navigateForward();
    expect(tabActions.activateThreadTab).toHaveBeenLastCalledWith("c");
  });

  it("skips threads that can no longer be opened", () => {
    for (const id of ["a", "b", "c"]) recordNavFocus(id);
    useAppStore.setState({ threads: threads(["a", "c"], []).concat(threads(["b"], ["b"])) });
    navigateBack();
    expect(tabActions.activateThreadTab).toHaveBeenLastCalledWith("a");
    useAppStore.setState({ threads: threads(["c"]) });
    expect(canNavigateForward()).toBe(true);
    expect(canNavigateBack()).toBe(false);
  });

  it(`keeps at most ${NAV_HISTORY_CAP} entries`, () => {
    const ids = Array.from({ length: NAV_HISTORY_CAP + 10 }, (_, index) => `t${index}`);
    useAppStore.setState({ threads: threads(ids) });
    for (const id of ids) recordNavFocus(id);
    let steps = 0;
    while (canNavigateBack()) {
      navigateBack();
      steps += 1;
    }
    expect(steps).toBe(NAV_HISTORY_CAP - 1);
    expect(tabActions.activateThreadTab).toHaveBeenLastCalledWith("t10");
  });

  it("records the focused thread from the app store", () => {
    useAppStore.setState({ view: { kind: "thread", panes: ["a"] }, focusedPaneId: "a" });
    const stop = startNavHistory();
    useAppStore.setState({ view: { kind: "thread", panes: ["b"] }, focusedPaneId: "b" });
    expect(canNavigateBack()).toBe(true);
    stop();
  });
});
