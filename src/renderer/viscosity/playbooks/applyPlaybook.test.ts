import { describe, expect, it } from "vitest";
import type { ThreadConfig } from "@/shared/contracts";
import { playbookBindingFromSaved, type SavedPlaybook } from "@/shared/viscosity/playbook";
import {
  applyPlaybook,
  isPlaybookOutdated,
  draftPlaybookFields,
  PLAYBOOK_BROWSER_ID,
  splitDraftPlaybookPatch,
  withCarriedPlaybook,
} from "./applyPlaybook";

const reversing: SavedPlaybook = {
  id: "reversing",
  label: "Reversing",
  icon: "binary",
  instructions: "Reverse it.",
  themeId: "hostile-binary",
  mcp: ["ghidra", "ida-pro-mcp", "binaryninja"],
};
const review: SavedPlaybook = {
  id: "review",
  label: "Review",
  readOnly: true,
  instructions: "Review.",
};
const webQa: SavedPlaybook = {
  id: "web-qa",
  label: "Web QA",
  instructions: "QA.",
  browserMcp: true,
};
const servers = [
  { id: "srv-ghidra", name: "Ghidra", enabled: false },
  { id: "srv-ida", name: "ida-pro-mcp", enabled: false },
  { id: "srv-on", name: "always", enabled: true },
];
const base: ThreadConfig = {
  model: "m",
  mode: "plan",
  approvalPolicy: "on-request",
  sandboxMode: "workspace-write",
};

describe("applyPlaybook", () => {
  it("matches names case-insensitively, switches them on by id and reports the missing ones", () => {
    const result = applyPlaybook(base, reversing, { servers, browserAvailable: true });
    expect(result.found).toEqual(["Ghidra", "ida-pro-mcp"]);
    expect(result.missing).toEqual(["binaryninja"]);
    expect(result.patch.mcpServerOverrides).toEqual({ "srv-ghidra": true, "srv-ida": true });
    expect(result.patch.playbook).toMatchObject({
      version: 1,
      id: "reversing",
      themeId: "hostile-binary",
      mcpServerIds: ["srv-ghidra", "srv-ida"],
    });
    // Never the global flags, never mode/approval/sandbox.
    expect(servers.every((server) => server.id === "srv-on" || !server.enabled)).toBe(true);
    expect(Object.keys(result.patch).toSorted()).toEqual(["mcpServerOverrides", "playbook"]);
  });

  it("does not record servers that are already on", () => {
    const result = applyPlaybook(
      base,
      { ...reversing, mcp: ["always"] },
      { servers, browserAvailable: true },
    );
    expect(result.found).toEqual(["always"]);
    expect(result.patch.mcpServerOverrides).toBeUndefined();
    expect(result.patch.playbook).not.toHaveProperty("mcpServerIds");
  });

  it("reverts the previous playbook's servers on a switch but keeps the user's own choices", () => {
    const first = applyPlaybook(base, reversing, { servers, browserAvailable: true });
    const config: ThreadConfig = {
      ...base,
      ...first.patch,
      mcpServerOverrides: { ...first.patch.mcpServerOverrides, "srv-user": false },
    };
    const second = applyPlaybook(config, review, { servers, browserAvailable: true });
    expect(second.patch.mcpServerOverrides).toEqual({ "srv-user": false });
    expect(second.patch.playbook).toMatchObject({ id: "review", readOnly: true });
  });

  it("writes an explicit null and an explicit empty map when turned off", () => {
    const first = applyPlaybook(base, reversing, { servers, browserAvailable: true });
    const off = applyPlaybook({ ...base, ...first.patch }, null, {
      servers,
      browserAvailable: true,
    });
    expect(off.patch).toEqual({ playbook: null, mcpServerOverrides: {} });
  });

  it("asks for the browser only when it can serve this agent", () => {
    expect(applyPlaybook(base, webQa, { servers, browserAvailable: true }).patch.browserMcp).toBe(
      true,
    );
    expect(
      applyPlaybook(base, webQa, { servers, browserAvailable: false }).patch,
    ).not.toHaveProperty("browserMcp");
  });

  it("turns the browser off on leaving a playbook that turned it on, never one the user had on", () => {
    const first = applyPlaybook(base, webQa, { servers, browserAvailable: true });
    expect(first.patch.playbook).toMatchObject({ mcpServerIds: [PLAYBOOK_BROWSER_ID] });
    const on: ThreadConfig = { ...base, ...first.patch };
    expect(applyPlaybook(on, review, { servers, browserAvailable: true }).patch.browserMcp).toBe(
      false,
    );
    expect(applyPlaybook(on, null, { servers, browserAvailable: true }).patch.browserMcp).toBe(
      false,
    );
    // Web QA again keeps it on and keeps owning it.
    const again = applyPlaybook(on, webQa, { servers, browserAvailable: true }).patch;
    expect(again).not.toHaveProperty("browserMcp");
    expect(again.playbook).toMatchObject({ mcpServerIds: [PLAYBOOK_BROWSER_ID] });

    const userOn: ThreadConfig = { ...base, browserMcp: true };
    const viaUser = applyPlaybook(userOn, webQa, { servers, browserAvailable: true });
    expect(viaUser.patch.playbook).not.toHaveProperty("mcpServerIds");
    expect(
      applyPlaybook({ ...userOn, ...viaUser.patch }, null, { servers, browserAvailable: true })
        .patch,
    ).not.toHaveProperty("browserMcp");
  });
});

describe("applyPlaybook with live_re", () => {
  const live: SavedPlaybook = {
    id: "live-reversing",
    label: "Live reversing",
    instructions: "Debug it.",
    mcp: ["live_re", "ida-pro-mcp-debug", "ghidra"],
  };
  const withDebug = [
    ...servers,
    { id: "srv-ida-debug", name: "ida-pro-mcp-debug", enabled: false },
  ];

  it("maps live_re to the helper's override id and records it", () => {
    const result = applyPlaybook(base, live, { servers: withDebug, browserAvailable: true });
    expect(result.found).toEqual(["live_re", "ida-pro-mcp-debug", "Ghidra"]);
    expect(result.missing).toEqual([]);
    expect(result.patch.mcpServerOverrides).toEqual({
      "viscosity.live-re": true,
      "srv-ida-debug": true,
      "srv-ghidra": true,
    });
    expect(result.patch.playbook).toMatchObject({
      mcpServerIds: ["viscosity.live-re", "srv-ida-debug", "srv-ghidra"],
    });
    // Mode, approval and sandbox are untouched.
    expect(Object.keys(result.patch).toSorted()).toEqual(["mcpServerOverrides", "playbook"]);
  });

  it("reverts the helper when the chat switches to Reversing", () => {
    const first = applyPlaybook(base, live, { servers: withDebug, browserAvailable: true });
    const second = applyPlaybook({ ...base, ...first.patch }, reversing, {
      servers: withDebug,
      browserAvailable: true,
    });
    expect(second.patch.mcpServerOverrides).toEqual({ "srv-ghidra": true, "srv-ida": true });
  });

  it("reports live_re as unavailable and leaves it off when the host cannot load it", () => {
    const result = applyPlaybook(base, live, {
      servers: withDebug,
      browserAvailable: true,
      liveReAvailable: false,
    });
    expect(result.found).toEqual(["ida-pro-mcp-debug", "Ghidra"]);
    expect(result.unavailable).toEqual(["live_re"]);
    expect(result.patch.mcpServerOverrides).toEqual({
      "srv-ida-debug": true,
      "srv-ghidra": true,
    });
    expect(result.patch.playbook).toMatchObject({ mcpServerIds: ["srv-ida-debug", "srv-ghidra"] });
  });

  it("uses a configured server named live_re instead of the helper", () => {
    const own = [...servers, { id: "srv-own", name: "LIVE_RE", enabled: false }];
    const result = applyPlaybook(base, live, { servers: own, browserAvailable: true });
    expect(result.found[0]).toBe("LIVE_RE");
    expect(result.patch.mcpServerOverrides).toEqual({ "srv-own": true, "srv-ghidra": true });
  });
});

describe("playbook carry helpers", () => {
  it("carries the playbook and its servers into a provider switch", () => {
    const source: ThreadConfig = {
      ...base,
      playbook: playbookBindingFromSaved(reversing, ["srv-ghidra"]),
    };
    expect(withCarriedPlaybook(source, { model: "other" })).toEqual({
      model: "other",
      playbook: source.playbook,
      mcpServerOverrides: { "srv-ghidra": true },
    });
    expect(withCarriedPlaybook(source, { model: "other", playbook: null })).toEqual({
      model: "other",
      playbook: null,
    });
    expect(withCarriedPlaybook(base, { model: "other" })).toEqual({ model: "other" });
  });

  it("keeps a draft's playbook fields apart from its model selection", () => {
    const binding = playbookBindingFromSaved(webQa);
    const set = splitDraftPlaybookPatch(
      { mcpServerOverrides: { a: true } },
      { playbook: binding, browserMcp: true, model: "n" },
    );
    // The browser stays in the rest: it goes through the draft's @browser mention flag.
    expect(set).toEqual({
      fields: { playbook: binding, mcpServerOverrides: { a: true } },
      rest: { browserMcp: true, model: "n" },
    });
    expect(
      splitDraftPlaybookPatch(set.fields!, { playbook: null, mcpServerOverrides: {} }),
    ).toEqual({
      fields: { playbook: null, mcpServerOverrides: {} },
      rest: {},
    });
    expect(splitDraftPlaybookPatch({}, { effort: "high" })).toEqual({ rest: { effort: "high" } });
    // Restore: a saved project draft from before playbooks has none.
    expect(draftPlaybookFields({ model: "m" } as ThreadConfig)).toEqual({});
    expect(
      draftPlaybookFields({
        model: "m",
        playbook: binding,
        mcpServerOverrides: { a: true },
        browserMcp: true,
      } as ThreadConfig),
    ).toEqual({ playbook: binding, mcpServerOverrides: { a: true } });
  });

  it("flags a chat copy that differs from the catalog entry", () => {
    const config: ThreadConfig = { ...base, playbook: playbookBindingFromSaved(reversing, ["x"]) };
    expect(isPlaybookOutdated(config, reversing)).toBe(false);
    expect(isPlaybookOutdated(config, { ...reversing, instructions: "New text." })).toBe(true);
    expect(isPlaybookOutdated(config, { ...reversing, themeId: "viscosity-blue" })).toBe(true);
    expect(isPlaybookOutdated(config, review)).toBe(false);
    // An unedited built-in shown in another app language is not an update.
    const translated = { ...reversing, label: "Ingeniería inversa", description: "Otro idioma" };
    expect(isPlaybookOutdated(config, translated)).toBe(true);
    expect(isPlaybookOutdated(config, translated, true)).toBe(false);
    expect(isPlaybookOutdated(config, { ...translated, instructions: "New text." }, true)).toBe(
      true,
    );
  });
});
