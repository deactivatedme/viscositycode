import { describe, expect, it } from "vitest";
import { resolveExplorerScope } from "./explorerRoot";

const none = { filesPanel: null, focused: null, editorRoot: null, fallbackProjectId: undefined };

describe("resolveExplorerScope", () => {
  it("shares the right-panel Files root so two trees never fight over one loader", () => {
    expect(
      resolveExplorerScope({
        ...none,
        filesPanel: { projectId: "p-files", worktreePath: "/wt/files" },
        focused: { projectId: "p-thread" },
        fallbackProjectId: "p-first",
      }),
    ).toEqual({ source: "files-panel", projectId: "p-files", worktreePath: "/wt/files" });
  });

  it("follows the focused thread's project and worktree", () => {
    expect(
      resolveExplorerScope({
        ...none,
        focused: { projectId: "p-thread", worktreePath: "/wt/feature" },
        editorRoot: { projectId: "p-editor" },
      }),
    ).toEqual({ source: "thread", projectId: "p-thread", worktreePath: "/wt/feature" });
  });

  it("omits an empty worktree path", () => {
    expect(
      resolveExplorerScope({
        ...none,
        focused: { projectId: "p-thread", worktreePath: undefined },
      }),
    ).toEqual({ source: "thread", projectId: "p-thread" });
  });

  it("falls back to the editor root, then the first project", () => {
    expect(
      resolveExplorerScope({
        ...none,
        editorRoot: { projectId: "p-editor" },
        fallbackProjectId: "p1",
      }),
    ).toEqual({ source: "editor", projectId: "p-editor" });
    expect(resolveExplorerScope({ ...none, fallbackProjectId: "p1" })).toEqual({
      source: "workspace",
      projectId: "p1",
    });
  });

  it("returns null without any project", () => {
    expect(resolveExplorerScope(none)).toBeNull();
  });
});
