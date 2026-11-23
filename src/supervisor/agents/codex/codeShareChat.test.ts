import { expect, it } from "vitest";
import { textOnlyCodexCatalog } from "./codeShareChat";

it("removes tool entry points from the provider catalog without changing the requested model", () => {
  const native = {
    slug: "m",
    context_window: 10000,
    shell_type: "unified_exec",
    tool_mode: "code_mode_only",
    apply_patch_tool_type: "freeform",
    experimental_supported_tools: ["exec"],
    multi_agent_version: "v2",
  };
  expect(textOnlyCodexCatalog({ models: [native, { slug: "other" }] }, "m")).toEqual({
    models: [
      {
        ...native,
        shell_type: "disabled",
        tool_mode: null,
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
        multi_agent_version: null,
        node_repl_disabled: true,
        supports_search_tool: false,
        include_skills_usage_instructions: false,
        include_plugin_usage_instructions: false,
        include_apps_usage_instructions: false,
      },
    ],
  });
  expect(native.shell_type).toBe("unified_exec");
  expect(() => textOnlyCodexCatalog({ models: [native] }, "missing")).toThrow("absent");
});

it("starts only a structured app-server and disables native MCP servers", async () => {
  const { codexCodeShareArgs } = await import("./codeShareChat");
  const args = codexCodeShareArgs(
    "/fixture/models.json",
    "/fixture/instructions.txt",
    ["shell_tool", "hooks"],
    ["private-server"],
  );
  expect(args).toContain("app-server");
  expect(args).toContain("--stdio");
  expect(args).not.toContain("exec");
  expect(args).toContain("features.shell_tool=false");
  expect(args.join(" ")).toContain("enabled=false");
  expect(args.join(" ")).not.toContain("forced_login_method");
});
