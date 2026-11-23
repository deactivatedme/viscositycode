import { describe, expect, it } from "vitest";
import { readCodeShareConfig } from "./cliCodeShare";
import { parseServerCliCommand } from "./cliParse";

const env = {
  CODESHARE_MODELS: "openai:small,anthropic:large,openai:small",
  CODESHARE_OPENAI_API_KEY: "test-openai",
  CODESHARE_ANTHROPIC_API_KEY: "test-anthropic",
};

describe("CodeShare CLI", () => {
  it("dispatches CodeShare and its help independently of serve", () => {
    expect(parseServerCliCommand(["codeshare"])).toBe("codeshare");
    expect(parseServerCliCommand(["codeshare", "--help"])).toBe("help");
  });

  it("defaults to local-only and accepts explicitly configured HTTPS", () => {
    expect(readCodeShareConfig(env)).toMatchObject({
      adminPort: 8788,
      guestPort: 8787,
      guestOrigin: "http://127.0.0.1:8787",
      models: [{ id: "openai:small" }, { id: "anthropic:large" }],
    });
    expect(
      readCodeShareConfig({ ...env, CODESHARE_PUBLIC_ORIGIN: "https://share.example.com/" })
        .guestOrigin,
    ).toBe("https://share.example.com");
  });

  it("rejects missing keys, conflicting ports, and non-HTTPS public URLs", () => {
    expect(() => readCodeShareConfig({ ...env, CODESHARE_ANTHROPIC_API_KEY: "" })).toThrow(
      "CODESHARE_ANTHROPIC_API_KEY",
    );
    expect(() => readCodeShareConfig({ ...env, CODESHARE_ADMIN_PORT: "8787" })).toThrow("distinct");
    for (const origin of [
      "http://share.example.com",
      "https://share.example.com/path",
      "https://a:b@share.example.com",
    ]) {
      expect(() => readCodeShareConfig({ ...env, CODESHARE_PUBLIC_ORIGIN: origin })).toThrow(
        "HTTPS origin",
      );
    }
  });
  it("configures a subset for new invites without removing the runtime catalog", () => {
    const config = readCodeShareConfig({ ...env, CODESHARE_INVITE_MODELS: "anthropic:large" });
    expect(config.models.map((model) => model.id)).toEqual(["openai:small", "anthropic:large"]);
    expect(config.inviteModels).toEqual(new Set(["anthropic:large"]));
    expect(() => readCodeShareConfig({ ...env, CODESHARE_INVITE_MODELS: "codex:missing" })).toThrow(
      "CODESHARE_INVITE_MODELS",
    );
  });

  it("configures guest subscriptions without a host API key", () => {
    expect(
      readCodeShareConfig({
        CODESHARE_SUBSCRIPTION_MODELS: "codex:gpt-6,claude:claude-fable-5-2,devin:swe-2",
      }),
    ).toMatchObject({
      keys: {},
      models: [
        { id: "codex:gpt-6", execution: "guest-subscription" },
        { id: "claude:claude-fable-5-2", execution: "guest-subscription" },
        { id: "devin:swe-2", execution: "guest-subscription" },
      ],
    });
  });
});
