// ViscosityCode: fork-only.
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PoracodeBridge } from "@/shared/ipc";
import { installBrowserClientRuntime, resetClientRuntimeForTest } from "@/renderer/clientRuntime";
import { usePanelStore } from "@/renderer/state/panelStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { NoAgentsComposerHint } from "./NoAgentsComposerHint";

function openedSection(): string | null {
  render(<NoAgentsComposerHint detecting={false} />);
  fireEvent.click(screen.getByRole("button", { name: /Set up in Settings/ }));
  return usePanelStore.getState().settingsSection;
}

beforeEach(() => {
  const bridge = { arch: "web" } as unknown as PoracodeBridge;
  window.poracode = bridge;
  installBrowserClientRuntime(bridge);
  usePanelStore.setState({ settingsSection: null });
});

afterEach(() => {
  resetClientRuntimeForTest();
  Reflect.deleteProperty(window, "poracode");
  Reflect.deleteProperty(window, "viscosityShell");
});

describe("NoAgentsComposerHint", () => {
  it("opens the Agent Registry in the host's own Tauri window", () => {
    Object.assign(window, { viscosityShell: Object.freeze({ kind: "tauri", version: 1 }) });
    expect(openedSection()).toBe("acpRegistry");
  });

  it("opens the models page in a plain browser, which has no Agents tree", () => {
    expect(openedSection()).toBe("agentsGeneral");
  });
});
