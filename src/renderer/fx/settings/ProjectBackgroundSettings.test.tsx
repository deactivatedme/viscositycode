import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useFxSettings } from "../fxSettingsStore";
import { ProjectBackgroundSettings } from "./ProjectBackgroundSettings";

const projects = [
  { id: "alpha", name: "Alpha" },
  { id: "beta", name: "Beta" },
  { id: "gone", name: "Disabled one", disabled: true },
] as unknown as Project[];

function slider(name: string): HTMLInputElement {
  const group = screen.getByRole("group", { name });
  return within(group).getByRole("slider") as HTMLInputElement;
}

describe("ProjectBackgroundSettings", () => {
  const initialProjects = useAppStore.getState().projects;

  beforeEach(() => {
    localStorage.clear();
    useFxSettings.getState().reset();
    useAppStore.setState({ projects });
  });

  afterEach(() => {
    useAppStore.setState({ projects: initialProjects });
  });

  it("lists enabled projects following the global background", () => {
    render(<ProjectBackgroundSettings />);
    const items = within(
      screen.getByRole("list", { name: "Per-project backgrounds" }),
    ).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector(".settings-row__title")?.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(screen.getAllByText("Follows the global background.")).toHaveLength(2);
    expect(slider("Background intensity for Alpha").value).toBe("70");
    expect(screen.getByRole("button", { name: "Reset the background for Alpha" })).toBeDisabled();
  });

  it("sets a project's style and intensity, then resets it", async () => {
    render(<ProjectBackgroundSettings />);

    fireEvent.click(screen.getByRole("button", { name: /Background style for Alpha/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Aurora grid" }));
    await waitFor(() =>
      expect(useFxSettings.getState().projectBackgrounds.alpha).toEqual({ preset: "aurora" }),
    );

    fireEvent.change(slider("Background intensity for Alpha"), { target: { value: "25" } });
    expect(useFxSettings.getState().projectBackgrounds.alpha).toEqual({
      preset: "aurora",
      intensity: 0.25,
    });
    expect(screen.getByText("This project has its own background.")).toBeInTheDocument();

    const reset = screen.getByRole("button", { name: "Reset the background for Alpha" });
    expect(reset).not.toBeDisabled();
    fireEvent.click(reset);
    expect(useFxSettings.getState().projectBackgrounds).toEqual({});
    expect(reset).toBeDisabled();
  });

  it("returns the style to global without dropping an intensity override", async () => {
    act(() =>
      useFxSettings
        .getState()
        .setProjectBackground("beta", { preset: "particles", intensity: 0.5 }),
    );
    render(<ProjectBackgroundSettings />);

    fireEvent.click(screen.getByRole("button", { name: /Background style for Beta/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Global (Gradient mesh)" }));
    await waitFor(() =>
      expect(useFxSettings.getState().projectBackgrounds.beta).toEqual({ intensity: 0.5 }),
    );
  });

  it("is disabled while the animated background is off", () => {
    act(() => useFxSettings.getState().setBackground({ enabled: false }));
    render(<ProjectBackgroundSettings />);
    expect(screen.getByRole("button", { name: /Background style for Alpha/ })).toBeDisabled();
    expect(slider("Background intensity for Beta")).toBeDisabled();
  });

  it("says so when there are no projects", () => {
    useAppStore.setState({ projects: [] });
    render(<ProjectBackgroundSettings />);
    expect(screen.getByText("No projects yet.")).toBeInTheDocument();
  });
});
