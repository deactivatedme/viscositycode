// ViscosityCode: the desktop shell renders the New session landing in place of
// upstream's HomeView; outside the shell (compact/PWA) HomeView stays.
import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";

const shell = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/renderer/viscosity/layout/tabs/shellGate", () => ({
  useViscosityShellEnabled: () => shell.enabled,
}));
vi.mock("@/renderer/views/HomeView", () => ({
  HomeView: () => <div data-testid="home-view" />,
}));
vi.mock("@/renderer/viscosity/newSession", () => ({
  NewSessionLanding: (props: { redirect: boolean }) => (
    <div data-testid="new-session-landing" data-redirect={String(props.redirect)} />
  ),
  NewSessionCenter: () => <div data-testid="new-session-center" />,
}));
const draftViewProps = vi.hoisted(() => ({
  last: undefined as Record<string, unknown> | undefined,
}));
vi.mock("@/renderer/components/thread/ThreadDraftView", () => ({
  ThreadDraftView: (props: Record<string, unknown>) => {
    draftViewProps.last = props;
    return <div data-testid="draft-view">{props.sessionCenter as ReactNode}</div>;
  },
}));
vi.mock("@/renderer/hooks/uiSelectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/hooks/uiSelectors")>()),
  useDraftEnvironment: () => ({ agentStatuses: [], isDetectingAgents: false }),
}));

import type { Project } from "@/shared/contracts";
import { AppContent } from "./AppContent";

const projectA: Project = {
  id: "a",
  name: "a",
  location: { kind: "posix", path: "/repo/a" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("AppContent home view", () => {
  beforeEach(() => {
    useAppStore.setState({ projects: [], threads: [], view: { kind: "home" } });
  });

  it("renders the redirecting New session landing in the shell", () => {
    shell.enabled = true;
    render(<AppContent />);

    expect(screen.getByTestId("new-session-landing")).toHaveAttribute("data-redirect", "true");
    expect(screen.queryByTestId("home-view")).not.toBeInTheDocument();
  });

  it("keeps HomeView outside the shell", () => {
    shell.enabled = false;
    render(<AppContent />);

    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(screen.queryByTestId("new-session-landing")).not.toBeInTheDocument();
  });

  it("does not redirect from a thread view whose panes are not loaded yet", () => {
    shell.enabled = true;
    useAppStore.setState({ view: { kind: "thread", panes: ["missing-thread"] } });
    render(<AppContent />);

    expect(screen.getByTestId("new-session-landing")).toHaveAttribute("data-redirect", "false");
  });

  it("gives the shell's draft the New session centre and placeholder", () => {
    shell.enabled = true;
    useAppStore.setState({ projects: [projectA], view: { kind: "draft", projectId: "a" } });
    render(<AppContent />);

    expect(screen.getByTestId("new-session-center")).toBeInTheDocument();
    expect(draftViewProps.last?.composerPlaceholder).toBe("Describe a task or ask a question");
  });

  it("keeps the upstream draft outside the shell", () => {
    shell.enabled = false;
    useAppStore.setState({ projects: [projectA], view: { kind: "draft", projectId: "a" } });
    render(<AppContent />);

    expect(screen.getByTestId("draft-view")).toBeInTheDocument();
    expect(draftViewProps.last).not.toHaveProperty("sessionCenter");
    expect(draftViewProps.last).not.toHaveProperty("composerPlaceholder");
  });
});
