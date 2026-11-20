// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDraftPaneId } from "@/shared/paneId";
import {
  keepAlivePatch,
  LIGHTWEIGHT_MAX_KEEP_ALIVE_PANES,
  MAX_KEEP_ALIVE_PANES,
  removeKeepAliveId,
  touchKeepAliveIds,
} from "./paneCacheSlice";

const { lightweightMock } = vi.hoisted(() => ({ lightweightMock: { active: false } }));
vi.mock("@/renderer/viscosity/performance/lightweight", () => ({
  isLightweightActive: () => lightweightMock.active,
}));

describe("paneCacheSlice", () => {
  afterEach(() => {
    lightweightMock.active = false;
  });

  it("caps hidden panes at 3 in Lightweight and 8 otherwise", () => {
    const current = Array.from({ length: MAX_KEEP_ALIVE_PANES }, (_, index) => `hidden-${index}`);
    expect(touchKeepAliveIds(current, "new", [])).toHaveLength(MAX_KEEP_ALIVE_PANES);
    lightweightMock.active = true;
    expect(LIGHTWEIGHT_MAX_KEEP_ALIVE_PANES).toBe(3);
    expect(touchKeepAliveIds(current, "new", [])).toEqual(["hidden-6", "hidden-7", "new"]);
  });

  it("adds touched panes to the end", () => {
    expect(touchKeepAliveIds(["a", "b"], "a", [])).toEqual(["b", "a"]);
  });

  it("removes a pane", () => {
    expect(removeKeepAliveId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("evicts the oldest hidden pane past the cap", () => {
    const current = Array.from({ length: MAX_KEEP_ALIVE_PANES }, (_, index) => `hidden-${index}`);
    expect(touchKeepAliveIds(current, "new", [])).toEqual([...current.slice(1), "new"]);
  });

  it("keeps visible panes when enforcing the cap", () => {
    const current = [
      "visible",
      ...Array.from({ length: MAX_KEEP_ALIVE_PANES - 1 }, (_, index) => `hidden-${index}`),
    ];
    const next = touchKeepAliveIds(current, "new", ["visible"]);
    expect(next).toContain("visible");
    expect(next).not.toContain("hidden-0");
  });

  it("keeps the outgoing terminal pane when opening another thread", () => {
    const patch = keepAlivePatch(
      {
        keepAlivePaneIds: [],
        view: { kind: "thread", panes: ["command-code"] },
        threads: [
          { id: "command-code", presentationMode: "terminal" },
          { id: "opencode", presentationMode: "terminal" },
        ],
      },
      "opencode",
    );
    expect(patch.keepAlivePaneIds).toEqual(["command-code", "opencode"]);
  });

  it("skips unknown, draft and GUI panes so they do not consume the LRU cap", () => {
    const draftId = makeDraftPaneId("project");
    const patch = keepAlivePatch(
      {
        keepAlivePaneIds: [],
        view: { kind: "thread", panes: [draftId, "gui-thread"] },
        threads: [
          { id: "gui-thread", presentationMode: "gui" },
          { id: "terminal-thread", presentationMode: "terminal" },
        ],
      },
      ["unknown-thread", "terminal-thread"],
    );
    expect(patch.keepAlivePaneIds).toEqual(["terminal-thread"]);
  });
});
