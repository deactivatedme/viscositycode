import { describe, expect, it } from "vitest";
import type { CustomTheme } from "@/shared/customThemes";
import type { ThreadPlaybookBinding } from "@/shared/viscosity/playbook";
import { playbookThemeOverride } from "./themeSwitchPlan";

const reversing: ThreadPlaybookBinding = {
  version: 1,
  id: "reversing",
  label: "Reversing",
  instructions: "Reverse it.",
  themeId: "hostile-binary",
  switchPhrases: ["BREACH THE BINARY"],
  exitPhrases: ["STAND DOWN"],
};

describe("playbookThemeOverride", () => {
  it("uses the playbook's theme only while the switch is on", () => {
    expect(playbookThemeOverride(reversing, true, [])).toBe("hostile-binary");
    expect(playbookThemeOverride(reversing, false, [])).toBeNull();
    expect(playbookThemeOverride(undefined, true, [])).toBeNull();
    expect(playbookThemeOverride({ ...reversing, themeId: undefined }, true, [])).toBeNull();
  });

  it("ignores unknown theme ids and accepts the user's custom themes", () => {
    const custom = { ...reversing, themeId: "custom:night" };
    expect(playbookThemeOverride(custom, true, [])).toBeNull();
    const night = { id: "custom:night" } as CustomTheme;
    expect(playbookThemeOverride(custom, true, [night])).toBe("custom:night");
  });
});
