import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppView, Experiment } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { withoutViewSwitch } from "./liveServices";

// The race adapter's experiment and worktree actions are not exercised here.
vi.mock("@/renderer/actions/experimentActions", () => ({
  launchExperiment: vi.fn<() => Promise<undefined>>(),
}));
vi.mock("@/renderer/actions/experimentDecisionActions", () => ({
  crownExperiment: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("@/renderer/actions/worktreeLaunchActions", () => ({
  createWorktree: vi.fn<() => Promise<never>>(),
}));
vi.mock("@/renderer/actions/worktreeInitialization", () => ({
  initializeCreatedWorktree: vi.fn<() => void>(),
}));

const HOME: AppView = { kind: "home" };
const realOpenExperiment = useAppStore.getState().openExperiment;

function viewKinds(): { kinds: string[]; stop: () => void } {
  const kinds: string[] = [];
  const stop = useAppStore.subscribe((state, previous) => {
    if (state.view !== previous.view) kinds.push(state.view.kind);
  });
  return { kinds, stop };
}

beforeEach(() => {
  useAppStore.setState({ view: HOME, openExperiment: realOpenExperiment });
  useExperimentStore.setState({ experiments: {} });
});

describe("withoutViewSwitch (race launches never switch the view)", () => {
  it("keeps the view while the launch opens its new experiment, not even for a moment", async () => {
    const seen = viewKinds();
    const result = await withoutViewSwitch(async () => {
      // What launchExperiment does after recording the new experiment.
      useAppStore.getState().openExperiment("exp-new", "p1");
      return "launched";
    });
    seen.stop();
    expect(result).toBe("launched");
    expect(useAppStore.getState().view).toEqual(HOME);
    expect(seen.kinds).toEqual([]);
  });

  it("still opens an experiment that existed before the launch (a user's click)", async () => {
    useExperimentStore.setState({ experiments: { "exp-old": { id: "exp-old" } as Experiment } });
    await withoutViewSwitch(async () => {
      useAppStore.getState().openExperiment("exp-old", "p1");
    });
    expect(useAppStore.getState().view).toMatchObject({
      kind: "experiment",
      experimentId: "exp-old",
    });
  });

  it("restores the store action once overlapping launches end, even when one fails", async () => {
    let finishFirst: () => void = () => {};
    const first = withoutViewSwitch(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    await expect(
      withoutViewSwitch(async () => {
        throw new Error("launch failed");
      }),
    ).rejects.toThrow("launch failed");
    // The first launch still runs: new experiments stay in the background.
    useAppStore.getState().openExperiment("exp-a", "p1");
    expect(useAppStore.getState().view).toEqual(HOME);
    finishFirst();
    await first;
    expect(useAppStore.getState().openExperiment).toBe(realOpenExperiment);
    useAppStore.getState().openExperiment("exp-a", "p1");
    expect(useAppStore.getState().view).toMatchObject({
      kind: "experiment",
      experimentId: "exp-a",
    });
  });
});
