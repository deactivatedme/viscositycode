import { afterEach, describe, expect, it } from "vitest";
import type { RoundtableSummary } from "../api";
import {
  isReusableRoundtable,
  resetKnownRoundtables,
  syncKnownRoundtables,
} from "./chatLinksStore";

function summary(
  id: string,
  pattern: RoundtableSummary["pattern"],
  status: RoundtableSummary["status"],
): RoundtableSummary {
  return { id, title: id, pattern, status, participantCount: 2, updatedAt: 1 };
}

describe("isReusableRoundtable", () => {
  afterEach(() => resetKnownRoundtables());

  it("keeps a stopped team chat linked, since posting reopens it", () => {
    syncKnownRoundtables([summary("chat", "open", "stopped")]);
    expect(isReusableRoundtable("chat")).toBe(true);
  });

  it("drops stopped sessions of other patterns and failed or unknown ones", () => {
    syncKnownRoundtables([
      summary("debate", "debate", "stopped"),
      summary("broken", "open", "failed"),
      summary("live", "build-review", "running"),
    ]);
    expect(isReusableRoundtable("debate")).toBe(false);
    expect(isReusableRoundtable("broken")).toBe(false);
    expect(isReusableRoundtable("missing")).toBe(false);
    expect(isReusableRoundtable("live")).toBe(true);
  });
});
