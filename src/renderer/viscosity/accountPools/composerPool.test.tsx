import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentInstanceConfigMap, AgentStatus } from "@/shared/contracts";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { I18nTestWrapper } from "@/renderer/testUtils/i18n";
import { useAccountPoolDraftSelection, withAccountPoolControl } from "./composerPool";

const NOW = Date.now();

const instances = {
  work: { id: "work", driver: "codex", displayName: "Work", config: {} },
} as AgentInstanceConfigMap;

function status(kind: string, label: string, partial: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: {},
    ...partial,
  } as AgentStatus;
}

const candidates = [
  status("claude", "Claude"),
  status("codex", "Codex"),
  status("codex:work", "Codex Work"),
];
const original = useSharedSettings.getState();

function usage(providerId: string, usedPercent: number) {
  return {
    providerId,
    status: "ok" as const,
    fetchedAt: NOW,
    windows: [{ id: "session-5h", label: "5h", usedPercent }],
  };
}

function draftSelection(preferred: string | undefined, enabled = true, list = candidates) {
  return renderHook(() => useAccountPoolDraftSelection({ preferred, candidates: list, enabled }), {
    wrapper: I18nTestWrapper,
  }).result.current;
}

beforeEach(() => {
  useSharedSettings.setState({
    agentInstances: instances,
    accountPools: { codex: { enabled: true, members: ["codex", "codex:work"] } },
  });
  useAgentStatusesStore.setState({ agentStatuses: candidates, wslAgentStatuses: [] });
  useProviderUsageStore.setState({
    snapshots: { codex: usage("codex", 96), "codex:work": usage("codex:work", 30) },
  });
});

afterEach(() => {
  useSharedSettings.setState(original, true);
  useProviderUsageStore.setState({ snapshots: {} });
});

describe("draft composer account choice", () => {
  it("pre-selects the pooled account with the most usage left", () => {
    const selection = draftSelection("codex");
    expect(selection.agentKind).toBe("codex:work");
    expect(selection.controlFor("codex:work")).toMatchObject({
      kind: "static",
      value: "Account: Codex Work — most usage left",
    });
  });

  it("still names the account the user picked instead", () => {
    const selection = draftSelection("codex");
    expect(selection.controlFor("codex")).toMatchObject({ value: "Account: Codex" });
    expect(selection.controlFor("claude")).toBeUndefined();
  });

  it("leaves unpooled, disabled and isolated selections alone", () => {
    expect(draftSelection("claude").agentKind).toBe("claude");
    const isolated = draftSelection("codex", false);
    expect(isolated.agentKind).toBe("codex");
    expect(isolated.controlFor("codex")).toBeUndefined();

    useSharedSettings.setState({
      accountPools: { codex: { enabled: false, members: ["codex", "codex:work"] } },
    });
    expect(draftSelection("codex").agentKind).toBe("codex");
  });

  it("does not move the pick or claim most usage left while usage is unknown", () => {
    useProviderUsageStore.setState({ snapshots: {} });
    const selection = draftSelection("codex:work");
    expect(selection.agentKind).toBe("codex:work");
    expect(selection.controlFor("codex:work")).toMatchObject({ value: "Account: Codex Work" });
  });

  it("never picks a signed-out account", () => {
    const list = [
      status("codex", "Codex"),
      status("codex:work", "Codex Work", { authState: "missing" }),
    ];
    expect(draftSelection("codex", true, list).agentKind).toBe("codex");
  });

  it("places the chip right after the model picker", () => {
    const picker = { kind: "provider-model" } as ComposerControl;
    const effort = { kind: "static", value: "High" } as ComposerControl;
    const chip = { kind: "static", value: "Account: Work" } as ComposerControl;
    expect(withAccountPoolControl([picker, effort], chip)).toEqual([picker, chip, effort]);
    expect(withAccountPoolControl([effort], chip)).toEqual([chip, effort]);
    const controls = [picker, effort];
    expect(withAccountPoolControl(controls, undefined)).toBe(controls);
  });
});
