import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wsl = vi.hoisted(() => ({
  batch: vi.fn<(distro: string, commands: string[]) => Promise<{ ok: boolean; stdout: string }[]>>(
    async () => [{ ok: true, stdout: "/mnt/c/data/playbooks/x.md\n" }],
  ),
}));
vi.mock("../agents/base", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/base")>()),
  batchWslCommandsAsync: wsl.batch,
}));

import {
  PLAYBOOK_POINTER_REMOVED_TEXT,
  PLAYBOOK_RESUMED_DELIVERY,
  restartedPlaybookDelivery,
  resumedPlaybookDelivered,
  playbookSetBriefText,
  leadsWithTerminalCommand,
  terminalPlaybookPointer,
  withPlaybookPointerSegment,
  withPlaybookPointerText,
  writePlaybookBriefFile,
} from "./playbookBrief";
import { playbookFingerprint } from "@/shared/viscosity/playbook";

const binding = {
  version: 1 as const,
  id: "reversing",
  label: "Rev\nersing",
  instructions: "Line one.\nLine two.",
};
const posix = { kind: "posix" as const, path: "/project" };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "playbook-brief-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("playbook instructions file", () => {
  it("is content-addressed and recreated when missing", async () => {
    const first = await writePlaybookBriefFile(binding, posix, { dir });
    expect(first.startsWith(dir)).toBe(true);
    expect(await readFile(first, "utf8")).toBe(`${playbookSetBriefText(binding)}\n`);
    expect(await writePlaybookBriefFile({ ...binding, icon: "bug" }, posix, { dir })).toBe(first);
    expect(
      await writePlaybookBriefFile({ ...binding, instructions: "Other." }, posix, { dir }),
    ).not.toBe(first);
    await rm(first);
    expect(await writePlaybookBriefFile(binding, posix, { dir })).toBe(first);
    expect(await readFile(first, "utf8")).toContain("Line two.");
  });

  it("translates the path for WSL projects", async () => {
    const location = {
      kind: "wsl" as const,
      distro: "Ubuntu",
      linuxPath: "/home/u/p",
      uncPath: "\\\\wsl$\\Ubuntu\\home\\u\\p",
    };
    expect(await writePlaybookBriefFile(binding, location, { dir })).toBe(
      "/mnt/c/data/playbooks/x.md",
    );
    expect(wsl.batch).toHaveBeenCalledWith("Ubuntu", [expect.stringContaining("wslpath -a -u --")]);
  });

  it("does not hand a WSL agent a host path or multi-line text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const location = {
      kind: "wsl" as const,
      distro: "Ubuntu",
      linuxPath: "/home/u/p",
      uncPath: "\\\\wsl$\\Ubuntu\\home\\u\\p",
    };
    for (const result of [
      { ok: false, stdout: "" },
      { ok: true, stdout: "C:\\data\\playbooks\\x.md" },
      { ok: true, stdout: "Welcome to Ubuntu\n/mnt/c/data/playbooks/x.md" },
    ]) {
      wsl.batch.mockResolvedValueOnce([result]);
      // Undefined keeps the playbook undelivered, so the next prompt retries.
      expect(
        await terminalPlaybookPointer({ playbook: binding }, undefined, location, { dir }),
      ).toBeUndefined();
    }
    warn.mockRestore();
  });
});

describe("terminal playbook pointer", () => {
  it("points once per fingerprint on one line and announces removal", async () => {
    const config = { playbook: binding };
    const pointer = await terminalPlaybookPointer(config, undefined, posix, { dir });
    expect(pointer?.fingerprint).toBe(playbookFingerprint(binding));
    expect(pointer?.text).toMatch(/^Follow the standing instructions in .+\.md for this chat/);
    expect(pointer?.text).toContain('("Rev ersing" playbook)');
    expect(pointer?.text).not.toContain("\n");
    expect(await terminalPlaybookPointer(config, pointer?.fingerprint, posix, { dir })).toBe(
      undefined,
    );
    expect(await terminalPlaybookPointer({ playbook: null }, undefined, posix, { dir })).toBe(
      undefined,
    );
    expect(
      await terminalPlaybookPointer({ playbook: null }, pointer?.fingerprint, posix, { dir }),
    ).toEqual({ fingerprint: "", text: PLAYBOOK_POINTER_REMOVED_TEXT });
  });

  it("copies the file into the workspace for agents that only read project files", async () => {
    const project = join(dir, "project");
    await mkdir(project);
    const pointer = await terminalPlaybookPointer(
      { playbook: binding },
      undefined,
      { kind: "posix", path: project },
      { dir: join(dir, "data"), workspaceLocal: true },
    );
    const copied = join(project, ".poracode", "attachments");
    expect(pointer?.text).toContain(`Follow the standing instructions in ${copied}${sep}`);
    const path = /in (.+\.md) for/.exec(pointer?.text ?? "")?.[1] ?? "";
    expect(await readFile(path, "utf8")).toBe(`${playbookSetBriefText(binding)}\n`);
    expect(await readFile(join(project, ".poracode", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("does not count an uncopyable workspace file as delivered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const project = join(dir, "project-file");
    await writeFile(project, "not a directory");
    const pointer = await terminalPlaybookPointer(
      { playbook: binding },
      undefined,
      { kind: "posix", path: project },
      { dir: join(dir, "data"), workspaceLocal: true },
    );
    expect(pointer).toBeUndefined();
    warn.mockRestore();
  });

  it("retracts a playbook cleared before a resume, once", async () => {
    const seed = resumedPlaybookDelivered({ playbook: null });
    expect(seed).toBe(PLAYBOOK_RESUMED_DELIVERY);
    expect(resumedPlaybookDelivered({ playbook: binding })).toBeUndefined();
    expect(resumedPlaybookDelivered({})).toBeUndefined();
    expect(await terminalPlaybookPointer({ playbook: null }, seed, posix, { dir })).toEqual({
      fingerprint: "",
      text: PLAYBOOK_POINTER_REMOVED_TEXT,
    });
    expect(await terminalPlaybookPointer({ playbook: null }, "", posix, { dir })).toBeUndefined();
  });

  it("keeps a restarted conversation's delivery state", () => {
    expect(restartedPlaybookDelivery({ playbookBriefDelivered: "fp" }, { playbook: null })).toEqual(
      {
        playbookBriefDelivered: "fp",
      },
    );
    expect(restartedPlaybookDelivery({}, { playbook: null })).toEqual({
      playbookBriefDelivered: PLAYBOOK_RESUMED_DELIVERY,
    });
    expect(restartedPlaybookDelivery({}, { playbook: binding })).toEqual({});
  });

  it("skips the pointer instead of failing the prompt when the file cannot be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blocked = join(dir, "file");
    await writeFile(blocked, "not a directory");
    const pointer = await terminalPlaybookPointer({ playbook: binding }, undefined, posix, {
      dir: join(blocked, "nested"),
    });
    expect(pointer).toBeUndefined();
    warn.mockRestore();
  });

  it("leads segments or plain prompts with the pointer", () => {
    const segments = [{ kind: "text" as const, content: "do it" }];
    expect(withPlaybookPointerSegment("P", segments)).toEqual([
      { kind: "text", content: "P " },
      ...segments,
    ]);
    expect(withPlaybookPointerSegment(undefined, segments)).toBe(segments);
    expect(withPlaybookPointerSegment("P", undefined)).toBeUndefined();
    expect(withPlaybookPointerText("P", undefined, "do it")).toBe("P do it");
    expect(withPlaybookPointerText("P", segments, "do it")).toBe("do it");
  });

  it("holds the pointer back from prompts that open with a command or skill", () => {
    const skill = {
      kind: "skill" as const,
      name: "triage",
      invocation: "$triage",
      provider: "fixture",
      scope: "project" as const,
    };
    expect(leadsWithTerminalCommand("  /compact", undefined)).toBe(true);
    expect(leadsWithTerminalCommand("find main", undefined)).toBe(false);
    expect(leadsWithTerminalCommand("", [{ kind: "text", content: " " }, skill])).toBe(true);
    expect(leadsWithTerminalCommand("", [{ kind: "text", content: "/review now" }])).toBe(true);
    expect(leadsWithTerminalCommand("", [{ kind: "text", content: "use " }, skill])).toBe(false);
    expect(leadsWithTerminalCommand("/x", [{ kind: "file", path: "/a" }])).toBe(false);
  });
});
