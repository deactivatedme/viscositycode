import { describe, expect, it } from "vitest";
import { BRAND_NAME, brandText } from "./brand";

describe("brandText", () => {
  it("replaces the upstream product name as a whole word", () => {
    expect(brandText("Restart Poracode")).toBe(`Restart ${BRAND_NAME}`);
    expect(brandText("Poracode's built-in browser")).toBe(`${BRAND_NAME}'s built-in browser`);
    expect(brandText("Poracode Nightly")).toBe(`${BRAND_NAME} Nightly`);
  });

  it("leaves lowercase technical identifiers alone", () => {
    expect(brandText(".poracode/worktrees")).toBe(".poracode/worktrees");
    expect(brandText("PORACODE_BASE_DIR")).toBe("PORACODE_BASE_DIR");
  });

  it("returns text without the brand unchanged", () => {
    const text = "Nothing to replace";
    expect(brandText(text)).toBe(text);
  });
});
