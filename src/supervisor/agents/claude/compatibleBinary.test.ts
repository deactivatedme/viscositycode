import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  getPrimedPosixEnv,
  getWindowsPathOverrideEnv,
  readAgentCommandOutput,
  resolveExecutablePathAsync,
} from "../base";
import { findCompatibleClaudeOverride } from "./compatibleBinary";

vi.mock("../base", () => ({
  getPrimedPosixEnv: vi.fn<typeof getPrimedPosixEnv>(),
  getWindowsPathOverrideEnv: vi.fn<typeof getWindowsPathOverrideEnv>(),
  readAgentCommandOutput: vi.fn<typeof readAgentCommandOutput>(),
  resolveExecutablePathAsync: vi.fn<typeof resolveExecutablePathAsync>(),
}));

let scratch: string | undefined;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  vi.resetAllMocks();
});

it.each([
  ["1.0.0 (Claude Code)", "2.1.330 (Claude Code)", true],
  ["2.1.330 (Claude Code)", "2.1.331 (Claude Code)", false],
  ["1.0.0 (Claude Code)", "9.0.0 (Another Tool)", false],
])(
  "checks installed alternatives when the PATH winner reports %s",
  async (first, second, swaps) => {
    scratch = mkdtempSync(join(tmpdir(), "claude-alternate-"));
    const firstDir = join(scratch, "first");
    const secondDir = join(scratch, "second");
    const windows = process.platform === "win32";
    const binary = windows ? "claude.exe" : "claude";
    const primary = join(firstDir, binary);
    const alternative = join(secondDir, binary);
    for (const dir of [firstDir, secondDir]) {
      mkdirSync(dir);
      writeFileSync(join(dir, binary), "", { mode: 0o755 });
    }
    vi.mocked(resolveExecutablePathAsync).mockResolvedValue(primary);
    const env = { PATH: firstDir + delimiter + secondDir };
    vi.mocked(getPrimedPosixEnv).mockReturnValue(env);
    vi.mocked(getWindowsPathOverrideEnv).mockReturnValue(env);
    vi.mocked(readAgentCommandOutput).mockImplementation(async (_location, path) => ({
      ok: true,
      stdout: path === primary ? first : path === alternative ? second : "",
      stderr: "",
    }));
    const choice = await findCompatibleClaudeOverride({
      kind: windows ? "windows" : "posix",
      path: scratch,
    });
    expect(choice).toBe(swaps ? alternative : undefined);
  },
);

it("keeps WSL resolution in its Linux distribution", async () => {
  await expect(
    findCompatibleClaudeOverride({
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/tmp",
      uncPath: "\\\\wsl$",
    }),
  ).resolves.toBeUndefined();
  expect(resolveExecutablePathAsync).not.toHaveBeenCalled();
});
