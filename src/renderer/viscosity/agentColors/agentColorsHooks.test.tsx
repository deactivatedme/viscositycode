// ViscosityCode: the per-agent colour hook-ins outside this folder.
import { describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ThreadTab } from "@/renderer/viscosity/layout/tabs/ThreadTab";
import { AGENT_KIND_ATTRIBUTE } from "./api";
import { AGENT_COLORS_STYLE_ID } from "./runtime";

vi.mock("@/renderer/actions/threadActions", () => ({
  openThread: vi.fn<(threadId: string) => void>(),
  openNewThread: vi.fn<(projectId?: string) => void>(),
}));

describe("agent colour hook-ins", () => {
  it("installs the generated stylesheet once the tab strip loads", () => {
    expect(document.querySelectorAll(`#${AGENT_COLORS_STYLE_ID}`)).toHaveLength(1);
  });

  it("marks a thread tab with its agent kind", () => {
    useAppStore.setState({
      threads: [
        {
          id: "t1",
          projectId: "p1",
          title: "Thread one",
          agentKind: "agent-a",
          status: "idle",
          archived: false,
          done: false,
        } as Thread,
      ],
      projects: [{ id: "p1", name: "Project", location: { kind: "local" } } as unknown as Project],
      view: { kind: "thread", panes: ["t1"] },
      focusedPaneId: "t1",
    });
    const { container } = render(<ThreadTab threadId="t1" />);
    const tab = container.querySelector(".vc-tab");
    expect(tab?.getAttribute(AGENT_KIND_ATTRIBUTE)).toBe("agent-a");
  });
});
