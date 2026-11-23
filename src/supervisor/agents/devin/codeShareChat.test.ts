import { expect, it } from "vitest";
import { devinSharePolicy } from "./codeShareChat";
it("disables native host file/shell tools and subagents without granting broad permissions", () => {
  const policy = devinSharePolicy();
  expect(policy.disabled_tools).toEqual(["read", "write", "edit", "grep", "glob", "exec"]);
  expect(policy.permissions.deny).toContain("Read(/**)");
  expect(policy.permissions.deny).toContain("Write(/**)");
  expect(policy.permissions.allow).toEqual(["mcp__codeshare_workspace__*"]);
  expect(policy.subagents_enabled).toBe(false);
  expect(Object.values(policy.read_config_from).every((value) => value === false)).toBe(true);
});
