import { describe, expect, it } from "vitest";
import { agentProfileDriver } from "@/shared/contracts/agentProfiles";
import { parseCursorProfileConfig, validateCursorProfileConfig } from "./profileConfig";

describe("parseCursorProfileConfig", () => {
  it("reads a profile saved before the format existed as local", () => {
    expect(parseCursorProfileConfig(undefined)).toMatchObject({
      status: "ok",
      runtimeTarget: "local",
    });
    expect(parseCursorProfileConfig({})).toMatchObject({ status: "ok", runtimeTarget: "local" });
  });

  it("parses a cloud profile and keeps unknown keys", () => {
    const result = parseCursorProfileConfig({
      format: 1,
      runtimeTarget: "cloud",
      autoCreatePR: true,
      future: "kept",
    });
    expect(result).toEqual({
      status: "ok",
      runtimeTarget: "cloud",
      config: { format: 1, runtimeTarget: "cloud", autoCreatePR: true, future: "kept" },
    });
  });

  it("disables a future format instead of misreading it", () => {
    expect(parseCursorProfileConfig({ format: 2, runtimeTarget: "cloud" }).status).toBe(
      "unsupported-format",
    );
  });

  it("rejects invalid values", () => {
    expect(parseCursorProfileConfig({ runtimeTarget: "moon" }).status).toBe("invalid");
    expect(parseCursorProfileConfig({ autoCreatePR: "yes" }).status).toBe("invalid");
    expect(() => validateCursorProfileConfig({ runtimeTarget: "moon" })).toThrow(
      /Invalid Cursor profile config/,
    );
  });

  it("is the cursor profile driver's save-time validator", () => {
    const validate = agentProfileDriver("cursor")?.validateConfig;
    expect(validate).toBe(validateCursorProfileConfig);
    expect(() => validate?.({ format: 1, runtimeTarget: "cloud" })).not.toThrow();
    expect(() => validate?.({ runtimeTarget: "cloud", autoCreatePR: 1 })).toThrow(
      /Invalid Cursor profile config/,
    );
  });
});
