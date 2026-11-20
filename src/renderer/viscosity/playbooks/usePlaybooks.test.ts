import { afterEach, describe, expect, it, vi } from "vitest";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { MAX_SAVED_PLAYBOOKS, type SavedPlaybook } from "@/shared/viscosity/playbook";
import {
  mergePlaybookCatalog,
  newCustomPlaybookId,
  removeSavedPlaybook,
  savePlaybook,
  upsertSavedPlaybook,
} from "./usePlaybooks";

const builtIns: SavedPlaybook[] = [
  { id: "reversing", label: "Reversing", instructions: "a" },
  { id: "review", label: "Review", instructions: "b" },
];

afterEach(() => {
  useSharedSettings.setState({ playbooks: [] } as never);
});

describe("playbook catalog", () => {
  it("lists built-ins first, an edited copy in place of its built-in, then the user's own", () => {
    const catalog = mergePlaybookCatalog(builtIns, [
      { id: "c-0000abcd", label: "Mine", instructions: "c" },
      { id: "review", label: "Review", instructions: "edited" },
    ]);
    expect(catalog.map((entry) => [entry.playbook.id, entry.builtIn, entry.edited])).toEqual([
      ["reversing", true, false],
      ["review", true, true],
      ["c-0000abcd", false, false],
    ]);
    expect(catalog[1]?.playbook.instructions).toBe("edited");
  });

  it("mints custom ids as c- plus 8 hex digits, avoiding taken ones", () => {
    expect(newCustomPlaybookId(new Set())).toMatch(/^c-[0-9a-f]{8}$/);
  });

  it("rejects invalid entries and refuses to grow past the cap", () => {
    expect(upsertSavedPlaybook([], { id: "c-1", label: "", instructions: "x" })).toBeUndefined();
    const full = Array.from({ length: MAX_SAVED_PLAYBOOKS }, (_, index) => ({
      id: `c-${index.toString(16).padStart(8, "0")}`,
      label: "x",
      instructions: "x",
    }));
    expect(
      upsertSavedPlaybook(full, { id: "c-ffffffff", label: "y", instructions: "y" }),
    ).toBeUndefined();
    expect(upsertSavedPlaybook(full, { ...full[0]!, label: "renamed" }, 5)?.[0]).toEqual({
      ...full[0],
      label: "renamed",
      updatedAt: 5,
    });
  });

  it("writes through the shared-settings setter", () => {
    const setPlaybooks = vi.fn<(playbooks: SavedPlaybook[]) => void>((playbooks) =>
      useSharedSettings.setState({ playbooks } as never),
    );
    useSharedSettings.setState({ playbooks: [], setPlaybooks } as never);
    expect(savePlaybook({ id: "review", label: "Review", instructions: "edited" })).toBe(true);
    expect(setPlaybooks).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "review", instructions: "edited" }),
    ]);
    removeSavedPlaybook("review");
    expect(setPlaybooks).toHaveBeenLastCalledWith([]);
  });

  it("reports failure instead of success when the store has no playbooks setter", () => {
    useSharedSettings.setState({
      playbooks: [{ id: "review", label: "Review", instructions: "edited" }],
      setPlaybooks: undefined,
    } as never);
    expect(savePlaybook({ id: "review", label: "Review", instructions: "again" })).toBe(false);
    expect(removeSavedPlaybook("review")).toBe(false);
    // Nothing to remove is not a failure.
    expect(removeSavedPlaybook("missing")).toBe(true);
  });
});
