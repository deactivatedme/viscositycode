import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageDescriptor } from "@lingui/core";
import { i18n } from "@/renderer/i18n/i18n";
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";
import { viscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import "./index";
import { registerPlaybookTarget } from "./playbookTargets";

const text = (value: string | MessageDescriptor | undefined) =>
  typeof value === "string" || value === undefined ? (value ?? "") : i18n._(value);

function matches(query: string) {
  const terms = query.toLowerCase().split(/\s+/);
  return viscosityCommands().filter((command) => {
    const haystack = [text(command.title), ...(command.keywords ?? [])].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

afterEach(() => document.documentElement.removeAttribute(VISCOSITY_SHELL_ATTRIBUTE));

describe("Playbook palette commands", () => {
  it("finds the Reversing playbook for 'reversing mode'", () => {
    expect(matches("reversing mode").map((command) => command.id)).toContain(
      "viscosity.playbooks.use.reversing",
    );
  });

  it("offers them only in the desktop shell", () => {
    const pick = () =>
      viscosityCommands().find((command) => command.id === "viscosity.playbooks.pick");
    expect(pick()?.showInPalette).toBe(false);
    document.documentElement.setAttribute(VISCOSITY_SHELL_ATTRIBUTE, "");
    expect(pick()?.showInPalette).toBeUndefined();
  });

  it("acts on the mounted picker", async () => {
    const target = {
      openPicker: vi.fn<() => void>(),
      apply: vi.fn<(id: string | null) => void>(),
    };
    const unregister = registerPlaybookTarget("draft:p", target);
    const commands = viscosityCommands();
    await commands.find((command) => command.id === "viscosity.playbooks.use.review")?.run();
    await commands.find((command) => command.id === "viscosity.playbooks.off")?.run();
    await commands.find((command) => command.id === "viscosity.playbooks.pick")?.run();
    expect(target.apply.mock.calls).toEqual([["review"], [null]]);
    expect(target.openPicker).toHaveBeenCalledTimes(1);
    unregister();
  });
});
