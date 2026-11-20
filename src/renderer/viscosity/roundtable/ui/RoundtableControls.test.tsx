import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { participant, session } from "./roundtable.testFixtures";
import { RoundtableComposer, RoundtableControls } from "./RoundtableControls";

vi.mock("../api", () => ({
  interruptRoundtable: vi.fn<() => void>(),
  pauseRoundtable: vi.fn<() => void>(),
  postToRoundtable: vi.fn<() => void>(),
  resumeRoundtable: vi.fn<() => void>(),
  stopRoundtable: vi.fn<() => void>(),
}));
vi.mock("@/renderer/viscosity/layout/tabs/tabActions", () => ({
  activateThreadTab: vi.fn<(threadId: string) => void>(),
}));

describe("RoundtableComposer mention chips", () => {
  it("switches off a chip selected by a typed label", () => {
    render(
      <RoundtableComposer
        session={session({ pattern: "open", participants: [participant("a"), participant("b")] })}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Message the Roundtable" });
    fireEvent.change(box, { target: { value: "@Agent A hi" } });
    const chip = screen.getByRole("button", { name: "Mention Agent A" });
    expect(chip).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chip);
    expect(box).toHaveValue("hi");
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });
});

describe("RoundtableControls thread buttons", () => {
  it("offers Open thread only for seats whose thread is still live", () => {
    useAppStore.setState({
      threads: [
        { id: "thread-a", projectId: "p1", archived: false },
        { id: "thread-b", projectId: "p1", archived: true },
      ] as Thread[],
    });
    render(
      <RoundtableControls
        session={session({
          participants: [participant("a"), participant("b"), participant("c")],
          // thread-b is archived and thread-c was deleted.
          threadIds: { a: "thread-a", b: "thread-b", c: "thread-c" },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Open Agent A thread/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open Agent B thread/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Agent C thread/ })).toBeNull();
  });
});
