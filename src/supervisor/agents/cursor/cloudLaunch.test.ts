import { describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import { cursorCloudRepoUrl, resolveCursorCloudLaunch, type CursorCloudGit } from "./cloudLaunch";

// Catalog keys land with the shared message handoff; assert the key chosen.
vi.mock("@/shared/messages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/messages")>()),
  msg: (key: string, params?: Record<string, string>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

const location: ProjectLocation = { kind: "posix", path: "/repo" };

function fakeGit(answers: Record<string, string>): CursorCloudGit {
  return async (_location, args) => answers[args.join(" ")] ?? "";
}

const pushedRepo = {
  "rev-parse --is-inside-work-tree": "true\n",
  "remote get-url origin": "git@github.com:acme/widgets.git\n",
  "rev-parse --abbrev-ref HEAD": "feature/x\n",
  "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/feature/x\n",
  "rev-list --count @{u}..HEAD": "0\n",
};

describe("cursorCloudRepoUrl", () => {
  it.each([
    ["https://github.com/acme/widgets.git", "https://github.com/acme/widgets"],
    ["git@github.com:acme/widgets.git", "https://github.com/acme/widgets"],
    ["ssh://git@gitlab.com/group/sub/widgets.git", "https://gitlab.com/group/sub/widgets"],
    ["https://user@github.com/acme/widgets", "https://github.com/acme/widgets"],
  ])("normalizes %s", (origin, expected) => {
    expect(cursorCloudRepoUrl(origin)).toBe(expected);
  });

  it("rejects a local path origin", () => {
    expect(cursorCloudRepoUrl("/srv/git/widgets.git")).toBeUndefined();
  });
});

describe("resolveCursorCloudLaunch", () => {
  it("starts from the pushed upstream branch of origin", async () => {
    await expect(resolveCursorCloudLaunch(location, fakeGit(pushedRepo))).resolves.toEqual({
      ok: true,
      repos: [{ url: "https://github.com/acme/widgets", startingRef: "feature/x" }],
    });
  });

  it("refuses a branch with no upstream instead of using the default branch", async () => {
    const result = await resolveCursorCloudLaunch(
      location,
      fakeGit({ ...pushedRepo, "rev-parse --abbrev-ref --symbolic-full-name @{u}": "" }),
    );
    expect(result).toEqual({
      ok: false,
      code: "no-upstream",
      message: 'cursor.cloud.pushBranch {"branch":"feature/x"}',
    });
  });

  it("refuses a branch with local commits that are not pushed", async () => {
    await expect(
      resolveCursorCloudLaunch(
        location,
        fakeGit({ ...pushedRepo, "rev-list --count @{u}..HEAD": "1\n" }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "unpushed",
      message: 'cursor.cloud.unpushedCommits {"branch":"feature/x"}',
    });
  });

  it("refuses an upstream on another remote and a detached HEAD", async () => {
    await expect(
      resolveCursorCloudLaunch(
        location,
        fakeGit({
          ...pushedRepo,
          "rev-parse --abbrev-ref --symbolic-full-name @{u}": "fork/feature/x",
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "no-upstream" });
    await expect(
      resolveCursorCloudLaunch(
        location,
        fakeGit({ ...pushedRepo, "rev-parse --abbrev-ref HEAD": "HEAD\n" }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "no-upstream",
      message: "cursor.cloud.checkoutBranch",
    });
  });

  it("launches a repo-less agent from Home without asking git", async () => {
    const git = vi.fn<CursorCloudGit>(async () => "true\n");
    await expect(
      resolveCursorCloudLaunch({ kind: "posix", path: "/Users/someone" }, git),
    ).resolves.toEqual({ ok: true, repos: [] });
    expect(git).not.toHaveBeenCalled();
  });

  it("refuses a project folder that is not a git work tree", async () => {
    await expect(resolveCursorCloudLaunch(location, fakeGit({}))).resolves.toEqual({
      ok: false,
      code: "no-origin",
      message: "cursor.cloud.noOrigin",
    });
  });

  it("refuses a work tree without origin instead of starting a repo-less agent", async () => {
    await expect(
      resolveCursorCloudLaunch(location, fakeGit({ "rev-parse --is-inside-work-tree": "true\n" })),
    ).resolves.toEqual({ ok: false, code: "no-origin", message: "cursor.cloud.noOrigin" });
  });

  it("reports git failures and timeouts as git-unavailable", async () => {
    const failing: CursorCloudGit = async () => {
      throw new Error("git timed out");
    };
    await expect(resolveCursorCloudLaunch(location, failing)).resolves.toMatchObject({
      ok: false,
      code: "git-unavailable",
    });
  });

  it("refuses an origin Cursor cannot clone", async () => {
    await expect(
      resolveCursorCloudLaunch(
        location,
        fakeGit({ ...pushedRepo, "remote get-url origin": "/srv/git/widgets.git" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "unsupported-origin" });
  });
});
