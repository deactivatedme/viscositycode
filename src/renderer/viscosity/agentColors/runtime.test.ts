import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import type { AgentStatus } from "@/shared/contracts";
import { useAgentColors } from "./agentColorsStore";
import {
  AGENT_COLORS_ENABLED_ATTRIBUTE,
  AGENT_COLORS_STYLE_ID,
  installAgentColors,
} from "./runtime";

const status = (kind: string, installed = true) =>
  ({ kind, label: kind, installed }) as unknown as AgentStatus;

function styleText(): string {
  return document.getElementById(AGENT_COLORS_STYLE_ID)?.textContent ?? "";
}

describe("installAgentColors", () => {
  let dispose: (() => void) | undefined;
  let initialStatuses: ReturnType<typeof useAgentStatusesStore.getState>;

  beforeEach(() => {
    localStorage.clear();
    useAgentColors.getState().reset();
    initialStatuses = useAgentStatusesStore.getState();
    useAgentStatusesStore.setState({ agentStatuses: [status("agent-a")], wslAgentStatuses: [] });
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    useAgentStatusesStore.setState(initialStatuses, true);
    useAgentColors.getState().reset();
  });

  it("injects one stylesheet and the on flag, and removes both on dispose", () => {
    dispose = installAgentColors(document);
    expect(document.querySelectorAll(`#${AGENT_COLORS_STYLE_ID}`)).toHaveLength(1);
    expect(styleText()).toContain('[data-vc-agent-kind="agent-a"]');
    expect(document.documentElement.hasAttribute(AGENT_COLORS_ENABLED_ATTRIBUTE)).toBe(true);

    dispose();
    dispose = undefined;
    expect(document.getElementById(AGENT_COLORS_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute(AGENT_COLORS_ENABLED_ATTRIBUTE)).toBe(false);
  });

  it("follows the switch and the owner's picks", () => {
    dispose = installAgentColors(document);
    useAgentColors.getState().setEnabled(false);
    expect(document.documentElement.hasAttribute(AGENT_COLORS_ENABLED_ATTRIBUTE)).toBe(false);
    // The colours stay defined for features that use them outside panes and tabs.
    expect(styleText()).toContain('[data-vc-agent-kind="agent-a"]');

    useAgentColors.getState().setColor("agent-a", "fuchsia");
    expect(styleText()).toMatch(
      /\[data-vc-agent-kind="agent-a"\] \{ --vc-agent-accent: color-mix\(in oklch, var\(--project-icon-violet\), var\(--project-icon-pink\)\); \}/,
    );
  });

  it("adds rules for newly detected agents", () => {
    dispose = installAgentColors(document);
    expect(styleText()).not.toContain("agent-b");
    useAgentStatusesStore.setState({ wslAgentStatuses: [status("agent-b", false)] });
    expect(styleText()).toContain('[data-vc-agent-kind="agent-b"]');
  });

  it("leaves the style text alone when unrelated state changes", () => {
    dispose = installAgentColors(document);
    const style = document.getElementById(AGENT_COLORS_STYLE_ID)!;
    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(style, { childList: true, characterData: true, subtree: true });
    useAgentStatusesStore.setState({ discoveryHidden: true });
    // Same agents in a new array: the generated text is identical.
    useAgentStatusesStore.setState({ agentStatuses: [status("agent-a")] });
    useAgentColors.getState().setEnabled(true);
    return Promise.resolve().then(() => {
      observer.disconnect();
      expect(mutations).toBe(0);
    });
  });
});
