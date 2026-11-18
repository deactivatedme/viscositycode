// ViscosityCode: the transcript divider names an out-of-usage account switch (fork of Poracode).
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderHandoffRow } from "@/renderer/components/thread/ChatPane/parts/items/ProviderHandoffRow";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";

const handoff = { fromAgentKind: "codex", toAgentKind: "codex:work", at: "2026-11-17T00:00:00Z" };

function item(id: string, type: string, payload: object = {}): RuntimeChatItem {
  return { id, threadId: "t1", type, state: "completed", payload } as unknown as RuntimeChatItem;
}

function renderDivider(transcript: RuntimeChatItem[]) {
  useAppStore.setState({
    runtimeItemIdsByThread: { t1: transcript.map((entry) => entry.id) },
    runtimeItemsByIdByThread: {
      t1: Object.fromEntries(transcript.map((entry) => [entry.id, entry])),
    },
  });
  const divider = transcript.find((entry) => entry.type === "provider_handoff")!;
  return render(<ProviderHandoffRow threadId="t1" item={divider} />);
}

afterEach(() => {
  useAppStore.setState({ runtimeItemIdsByThread: {}, runtimeItemsByIdByThread: {} });
});

describe("ProviderHandoffRow with account pools", () => {
  it("says the previous account ran out of usage after a usage-limited turn", () => {
    renderDivider([
      item("u1", "user_message"),
      item("e1", "error", { message: "Usage limit reached.", reason: "usage_limited" }),
      item("divider", "provider_handoff", handoff),
    ]);
    expect(screen.getByText("Switched to codex:work because codex ran out of usage")).toBeTruthy();
  });

  it("keeps the existing text for a manual switch", () => {
    renderDivider([item("u1", "user_message"), item("divider", "provider_handoff", handoff)]);
    expect(screen.getByText("Switched from codex to codex:work")).toBeTruthy();
  });
});
