// ViscosityCode: the per-agent colour hook-ins outside this folder.
import { describe, expect, it } from "vitest";
// Loads the per-agent colour stylesheet as a side effect, like the main layout.
import "@/renderer/viscosity/layout/tabs/ViscosityCenterFrame";
import { AGENT_COLORS_STYLE_ID } from "./runtime";

describe("agent colour hook-ins", () => {
  it("installs the generated stylesheet once the center frame loads", () => {
    expect(document.querySelectorAll(`#${AGENT_COLORS_STYLE_ID}`)).toHaveLength(1);
  });
});
