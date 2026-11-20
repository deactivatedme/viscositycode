import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { acquireViscosityShellFlag } from "@/renderer/viscosity/shellFlag";
import type { RoundtableSession } from "../types";
import { session, summaryOf, turn } from "./roundtable.testFixtures";
import { RoundtableSidebarView } from "./RoundtableSidebarView";
import { useRoundtableViewStore } from "./roundtableViewStore";

const api = vi.hoisted(() => ({
  sessions: new Map<string, RoundtableSession>(),
  deleteRoundtable: vi.fn<(id: string) => void>(),
  stopRoundtable: vi.fn<(id: string) => Promise<void>>(),
}));

vi.mock("../api", () => ({
  useRoundtableList: () => [...api.sessions.values()].map(summaryOf),
  useRoundtableSession: (id: string | undefined) => (id ? api.sessions.get(id) : undefined),
  deleteRoundtable: api.deleteRoundtable,
  stopRoundtable: api.stopRoundtable,
}));

let releaseShell: (() => void) | undefined;

beforeEach(() => {
  api.sessions.clear();
  api.deleteRoundtable.mockReset();
  api.stopRoundtable.mockReset().mockResolvedValue(undefined);
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

  it("shows an idle team chat as ready", () => {
    api.sessions.set(
      "chat",
      session({
        id: "chat",
        pattern: "open",
        notes: [{ id: "n1", text: "Hi", createdAt: 1 }],
        turns: [turn("t1", { round: 0, phase: "reply", noteId: "n1" })],
      }),
    );
    render(<RoundtableSidebarView visible />);
    const row = screen.getByRole("listitem");
    expect(row.textContent).toContain("Ready");
    expect(row.querySelector('.vc-rt-status-dot[data-tone="inactive"]')).not.toBeNull();
  });

  it("deletes a session after confirmation, stopping it first and closing its tab", async () => {
    api.sessions.set("rt1", session({ status: "running" }));
    useRoundtableViewStore.setState({ openSessionId: "rt1", shown: true });
    render(<RoundtableSidebarView visible />);
    fireEvent.click(
      screen.getByRole("button", { name: "Roundtable actions for Fix the login bug" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Roundtable" }));
    expect(api.deleteRoundtable).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete Roundtable" }));
    });
    expect(api.stopRoundtable).toHaveBeenCalledWith("rt1");
    expect(api.deleteRoundtable).toHaveBeenCalledWith("rt1");
    expect(useRoundtableViewStore.getState().openSessionId).toBeNull();
  });
});
