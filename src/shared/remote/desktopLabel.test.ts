import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "../brand";
import { defaultClientMetadata } from "./clientTypes";
import { desktopTitle } from "./desktopLabel";

describe("desktop labels (ViscosityCode)", () => {
  it("strips the fork, upstream, and legacy brand prefixes", () => {
    expect(desktopTitle(`${BRAND_NAME} on studio-mac`)).toBe("studio-mac");
    expect(desktopTitle("Poracode on studio-mac")).toBe("studio-mac");
    expect(desktopTitle("Lightcode on studio-mac")).toBe("studio-mac");
    expect(desktopTitle("studio-mac")).toBe("studio-mac");
  });

  it("labels web clients with the fork's name", () => {
    expect(defaultClientMetadata().label).toMatch(
      new RegExp(`^${BRAND_NAME} (web app|mobile web)$`),
    );
  });
});
