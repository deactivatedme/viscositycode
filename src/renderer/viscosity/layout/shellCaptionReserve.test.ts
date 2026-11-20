// ViscosityCode: the top bar sits below the Windows/Linux content-header row,
// which already clears the caption buttons; the toggle must not reserve them again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(join(process.cwd(), "src/renderer/viscosity/layout/shell.css"), "utf8");
const tokens = readFileSync(join(process.cwd(), "src/renderer/theme/viscosity/tokens.css"), "utf8");

describe("top bar end", () => {
  it("adds no titlebar-area reserve to the right sidebar toggle", () => {
    expect(shell).not.toMatch(/\.vc-tabstrip__end[^{]*\{[^}]*titlebar-area/);
  });

  it("keeps the macOS collapsed clearance with a 0px rail", () => {
    // The rail is gone: the token is 0px, so the clearance is the full gutter + 16px.
    expect(tokens).toMatch(/html\[data-vc-shell\] \{[^}]*--vc-activitybar-width: 0px;/);
    expect(shell).toMatch(
      /calc\(var\(--vc-traffic-light-reach\) \+ var\(--vc-space-5\) - var\(--vc-activitybar-width\)\)/,
    );
  });
});
