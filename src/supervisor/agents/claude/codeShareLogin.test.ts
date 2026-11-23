import { expect, it } from "vitest";
import { claudeCodeShareLoginUrl } from "./codeShareLogin";

it("accepts provider authorization links and refuses unrelated or misleading hosts", () => {
  expect(claudeCodeShareLoginUrl("Open https://claude.ai/oauth/authorize?state=fixture\n")).toBe(
    "https://claude.ai/oauth/authorize?state=fixture",
  );
  expect(
    claudeCodeShareLoginUrl("https://claude.ai.attacker.example/oauth/authorize?state=fixture"),
  ).toBeUndefined();
  expect(
    claudeCodeShareLoginUrl("https://attacker.example/?next=https://claude.ai/oauth/authorize"),
  ).toBeUndefined();
});
