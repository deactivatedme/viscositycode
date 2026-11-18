import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import type { RoundtableSession } from "../types";
import { session, summaryOf } from "./roundtable.testFixtures";
import { RoundtableSidebarView } from "./RoundtableSidebarView";
import { useRoundtableViewStore } from "./roundtableViewStore";

const api = vi.hoisted(() => ({
  sessions: new Map<string, RoundtableSession>(),
}));

vi.mock("../api", () => ({
  useRoundtableList: () => [...api.sessions.values()].map(summaryOf),
  useRoundtableSession: (id: string | undefined) => (id ? api.sessions.get(id) : undefined),
}));

let releaseShell: (() => void) | undefined;

beforeEach(() => {
  api.sessions.clear();
  useRoundtableViewStore.setState({ openSessionId: null, shown: false, setup: null });
  releaseShell = acquireViscosityShellFlag(document.documentElement);
});

afterEach(() => {
  releaseShell?.();
});

describe("RoundtableSidebarView", () => {
  it("explains the empty state and offers a new Roundtable", () => {
    render(<RoundtableSidebarView visible />);
    expect(screen.getByText("No roundtables yet")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New Roundtable" }));
    expect(useRoundtableViewStore.getState().setup?.request).toEqual({});
  });

  it("lists sessions newest first with pattern, status and seats", () => {
    api.sessions.set("old", session({ id: "old", title: "Older", updatedAt: 1, status: "done" }));
    api.sessions.set(
      "new",
      session({ id: "new", title: "Newer", pattern: "debate", updatedAt: 9, status: "running" }),
    );
    const { container } = render(<RoundtableSidebarView visible />);
    const rows = within(screen.getByRole("list", { name: "Roundtables" })).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-vc-roundtable-row"))).toEqual(["new", "old"]);
    expect(within(rows[0]!).getByText("Newer")).toBeTruthy();
    expect(within(rows[0]!).getByText(/Debate → decide/)).toBeTruthy();
    expect(rows[0]!.querySelector('.vc-rt-status-dot[data-tone="working"]')).not.toBeNull();
    expect(rows[1]!.querySelector('.vc-rt-status-dot[data-tone="finished"]')).not.toBeNull();
    expect(container.querySelectorAll(".vc-rt-avatar-stack .vc-rt-avatar")).toHaveLength(4);
  });

  it("opens a session from its row and marks it current", () => {
    api.sessions.set("rt1", session());
    const { rerender } = render(<RoundtableSidebarView visible />);
    fireEvent.click(screen.getByText("Fix the login bug"));
    expect(useRoundtableViewStore.getState()).toMatchObject({ openSessionId: "rt1", shown: true });
    rerender(<RoundtableSidebarView visible />);
    expect(screen.getByRole("listitem").querySelector('[aria-current="page"]')).not.toBeNull();
  });
});
