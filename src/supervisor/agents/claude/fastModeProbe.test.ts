// ViscosityCode (fork of Poracode): fast-mode probe must fail open without losing init results.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFastAvailabilityAt } from "./fastModeCacheCore";
import { resolveFastAvailability } from "./fastModeProbe";
import type { AsyncPromptQueue } from "./promptQueue";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-fast-probe-"));
  dirs.push(dir);
  return join(dir, "claude-fast-mode.json");
}

function runtime(messages: () => AsyncGenerator<SDKMessage>): Query {
  return Object.assign(messages(), {
    setModel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    applyFlagSettings: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }) as unknown as Query;
}

function queue() {
  return { push: vi.fn<(message: unknown) => void>() };
}

describe("resolveFastAvailability", () => {
  it("returns undefined and caches nothing when the turn is aborted", async () => {
    const path = cachePath();
    // oxlint-disable-next-line require-yield -- the turn aborts before any message
    const aborted = runtime(async function* () {
      throw new Error("Operation aborted");
    });
    await expect(
      resolveFastAvailability(aborted, queue() as unknown as AsyncPromptQueue, "a@b.c", path),
    ).resolves.toBeUndefined();
    expect(existsSync(path)).toBe(false);
  });

  it("caches the fast_mode_state of the result", async () => {
    const path = cachePath();
    const ok = runtime(async function* () {
      yield { type: "result", fast_mode_state: "on" } as unknown as SDKMessage;
    });
    await expect(
      resolveFastAvailability(ok, queue() as unknown as AsyncPromptQueue, "a@b.c", path),
    ).resolves.toBe(true);
    await expect(readFastAvailabilityAt(path, "a@b.c")).resolves.toBe(true);
  });

  it("runs no turn without an account", async () => {
    const q = queue();
    const idle = runtime(async function* () {
      yield { type: "result", fast_mode_state: "on" } as unknown as SDKMessage;
    });
    await expect(
      resolveFastAvailability(idle, q as unknown as AsyncPromptQueue, undefined, cachePath()),
    ).resolves.toBeUndefined();
    expect(q.push).not.toHaveBeenCalled();
  });
});
