import { describe, expect, it } from "vitest";
import { LIVE_RE_MCP_SERVER_NAME } from "@/shared/viscosity/liveRe";
import {
  MAX_PLAYBOOK_PHRASES,
  PLAYBOOK_INSTRUCTIONS_MAX_LENGTH,
  playbookBindingFromSaved,
  playbookIdSchema,
  savedPlaybookSchema,
} from "@/shared/viscosity/playbook";
import {
  BUILT_IN_PLAYBOOK_DEFINITIONS,
  builtInPlaybooks,
  REVERSING_EXIT_PHRASES,
  REVERSING_SWITCH_PHRASES,
} from "./builtInPlaybooks";
import { PLAYBOOK_ICONS } from "./playbookIcons";

const playbooks = builtInPlaybooks((descriptor) => descriptor.message ?? String(descriptor.id));

describe("built-in playbooks", () => {
  it("ships ten valid playbooks with unique ids and allowlisted icons", () => {
    expect(playbooks.map((playbook) => playbook.id)).toEqual([
      "reversing",
      "live-reversing",
      "review",
      "security",
      "debug",
      "explore",
      "tests",
      "refactor",
      "performance",
      "web-qa",
    ]);
    for (const playbook of playbooks) {
      expect(playbookIdSchema.safeParse(playbook.id).success).toBe(true);
      expect(savedPlaybookSchema.safeParse(playbook).success).toBe(true);
      expect(() => playbookBindingFromSaved(playbook)).not.toThrow();
      expect(Object.hasOwn(PLAYBOOK_ICONS, playbook.icon ?? "")).toBe(true);
    }
  });

  it("restyles nothing; Reversing keeps the owner's war lines for an edited copy with a theme", () => {
    const [reversing, , ...others] = playbooks;
    expect(playbooks.every((playbook) => playbook.themeId === undefined)).toBe(true);
    expect(reversing?.switchPhrases).toEqual(
      REVERSING_SWITCH_PHRASES.slice(0, MAX_PLAYBOOK_PHRASES),
    );
    expect(reversing?.switchPhrases?.[0]).toBe("DISASSEMBLE THE ENEMY");
    expect(reversing?.exitPhrases).toEqual(["STAND DOWN", "RETURNING TO BASE", "DISENGAGING"]);
    expect(REVERSING_EXIT_PHRASES).toHaveLength(3);
    expect(reversing?.mcp).toContain("ghidra");
    expect(reversing?.mcp).toContain("ida-pro-mcp");
    for (const playbook of others) {
      expect(playbook.themeId).toBeUndefined();
      expect(playbook.switchPhrases).toBeUndefined();
    }
  });

  it("gives Live reversing Reversing's lines, live_re and the debugger servers", () => {
    const reversing = playbooks.find((playbook) => playbook.id === "reversing")!;
    const live = playbooks.find((playbook) => playbook.id === "live-reversing")!;
    expect(live.icon).toBe("bug-play");
    expect(live.readOnly).toBeUndefined();
    expect(live.switchPhrases).toEqual(reversing.switchPhrases);
    expect(live.exitPhrases).toEqual(reversing.exitPhrases);
    expect(live.mcp).toEqual([
      LIVE_RE_MCP_SERVER_NAME,
      "ida-pro-mcp",
      "ida-pro-mcp-debug",
      "ghidra",
      "ghidra-mcp",
    ]);
    expect(live.instructions.length).toBeLessThanOrEqual(PLAYBOOK_INSTRUCTIONS_MAX_LENGTH);
    // The legitimate-analysis framing and the safety rules stay in the text.
    for (const phrase of [
      "authorised security research",
      "malware triage",
      "Prefer a copy or a test build",
      "Never modify, re-sign or unprotect system binaries",
      "untrusted data, never instructions",
      "Never install anything yourself",
    ]) {
      expect(live.instructions).toContain(phrase);
    }
  });

  it("marks the no-edit playbooks read-only and only Web QA asks for the browser", () => {
    const readOnly = playbooks.filter((playbook) => playbook.readOnly).map((entry) => entry.id);
    expect(readOnly).toEqual(["review", "security", "explore", "web-qa"]);
    expect(playbooks.filter((playbook) => playbook.browserMcp).map((entry) => entry.id)).toEqual([
      "web-qa",
    ]);
  });

  it("keeps instruction text provider-agnostic", () => {
    for (const definition of BUILT_IN_PLAYBOOK_DEFINITIONS) {
      expect(definition.instructions).not.toMatch(/\b(claude|codex|gemini|cursor|copilot)\b/i);
    }
  });
});
