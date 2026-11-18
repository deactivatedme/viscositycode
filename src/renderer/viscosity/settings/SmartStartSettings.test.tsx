import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { SmartStartSettings } from "./SmartStartSettings";

const root = document.documentElement;

beforeEach(() => {
  root.dataset.windowKind = "main";
});

afterEach(() => {
  delete root.dataset.windowKind;
});

describe("SmartStartSettings", () => {
  it("shows the Smart start preference lists in the desktop layout", () => {
    render(<SmartStartSettings />);
    const group = screen.getByRole("region", { name: "Smart start" });
    expect(group.querySelector("[data-vc-smart-start-preferences]")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Preferred for coding" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Preferred for quick questions" })).toBeTruthy();
  });

  it("renders nothing where Auto never runs (secondary windows)", () => {
    root.dataset.windowKind = "thread";
    const { container } = render(<SmartStartSettings />);
    expect(container.innerHTML).toBe("");
  });
});
