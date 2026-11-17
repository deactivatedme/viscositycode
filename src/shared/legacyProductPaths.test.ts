import { describe, expect, it } from "vitest";
import { PORACODE_CHANNELS, productNameFor } from "./channel";
import { legacyProductNameFor } from "./legacyProductPaths";

describe("legacyProductNameFor", () => {
  // ViscosityCode: no Lightcode safe-storage identity to preserve.
  it("uses the fork's own product name for every channel", () => {
    for (const channel of PORACODE_CHANNELS) {
      expect(legacyProductNameFor(channel)).toBe(productNameFor(channel));
      expect(legacyProductNameFor(channel)).not.toMatch(/Lightcode|Poracode/u);
    }
  });
});
