// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LARGE_DROPDOWN_VIRTUALIZATION_THRESHOLD,
  VIRTUALIZED_MENU_DROPDOWN_ITEM_CLASS,
} from "./dropdownVirtualization";
import { OptionMenu } from "./OptionMenu";

describe("OptionMenu", () => {
  afterEach(() => {
    delete (window as unknown as { poracode?: unknown }).poracode;
  });

  it("opens a bottom drawer with large tap targets in a remote/mobile session", async () => {
    // isRemoteSession() keys off window.poracode.appVersion === "remote".
    (window as unknown as { poracode?: unknown }).poracode = { appVersion: "remote" };
    const onChange = vi.fn<(value: string) => void>();

    render(
      <OptionMenu
        value="a"
        options={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    // The mobile path renders a drawer dialog with .m-sheet-action rows rather
    // than the desktop popover listbox.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const beta = screen.getByText("Beta");
    expect(beta.closest("button")?.className).toContain("m-sheet-action");

    fireEvent.click(beta);
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("defers menu item rendering until opened", async () => {
    const onChange = vi.fn<(value: string) => void>();

    render(
      <OptionMenu
        value="a"
        options={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.queryByText("Beta")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    fireEvent.click(await screen.findByText("Beta"));

    expect(onChange).toHaveBeenCalledWith("b");
  });

  // ViscosityCode: the stylesheet flips a popup trigger's chevron through these hooks.
  it("marks its open trigger so the stylesheet can flip the chevron", async () => {
    const trigger = ':is(.popover__trigger, [aria-haspopup])[aria-expanded="true"]';
    const chevron = ":is(.lucide-chevron-down, .lucide-chevron-up)";
    const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");
    expect(styles.replace(/\s+/g, " ")).toContain(`${trigger} ${chevron} { rotate: 180deg; }`);
    render(
      <OptionMenu value="a" options={["a", "b"]} onChange={vi.fn<(value: string) => void>()} />,
    );
    expect(document.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(document.querySelector(`${trigger} ${chevron}`)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    await screen.findByRole("listbox", { name: "Options" });
    expect(document.querySelector(`${trigger} ${chevron}`)).not.toBeNull();
  });

  it("pins virtualized rows to the configured menu height", async () => {
    render(
      <OptionMenu
        value="value-1"
        options={Array.from(
          { length: LARGE_DROPDOWN_VIRTUALIZATION_THRESHOLD + 1 },
          (_, index) => ({
            id: `value-${index + 1}`,
            label: `Value ${index + 1}`,
          }),
        )}
        onChange={vi.fn<(value: string) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    expect((await screen.findByRole("listbox", { name: "Options" })).className).toContain(
      VIRTUALIZED_MENU_DROPDOWN_ITEM_CLASS,
    );
  });
});
