// @vitest-environment node

import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "@/shared/brand";
import { brandDisplayText } from "./brandDisplay";

describe("brandDisplayText (ViscosityCode)", () => {
  it("names the fork in engine prose", () => {
    expect(
      brandDisplayText(
        "Agent launch refused: this is a mock QA session, so Poracode will not start provider sessions.",
      ),
    ).toBe(
      `Agent launch refused: this is a mock QA session, so ${BRAND_NAME} will not start provider sessions.`,
    );
    expect(brandDisplayText("Restart Poracode. (Poracode's helper) “Poracode”, Poracode:")).toBe(
      `Restart ${BRAND_NAME}. (${BRAND_NAME}'s helper) “${BRAND_NAME}”, ${BRAND_NAME}:`,
    );
    expect(brandDisplayText("line one\nPoracode Helper failed\tagain")).toBe(
      `line one\n${BRAND_NAME} Helper failed\tagain`,
    );
  });

  it("keeps paths, URLs and file names verbatim", () => {
    for (const verbatim of [
      "ENOENT: no such file or directory, open '/Users/me/Poracode/settings.json'",
      "Cannot write C:\\Users\\me\\Poracode\\data.db",
      "cwd ~/Downloads/Poracode-master is not a git repository",
      "Move Poracode.app to /Applications first",
      "See https://github.com/Porabuild/Poracode/issues",
      "PORACODE_HOME and .poracode/worktrees and poracode.com",
    ]) {
      expect(brandDisplayText(verbatim)).toBe(verbatim);
    }
    expect(brandDisplayText("Move Poracode.app, then restart Poracode.")).toBe(
      `Move Poracode.app, then restart ${BRAND_NAME}.`,
    );
  });

  it("returns the same string when there is nothing to brand", () => {
    const text = `Connection failed after ${BRAND_NAME} retried.`;
    expect(brandDisplayText(text)).toBe(text);
    expect(brandDisplayText("")).toBe("");
  });
});
