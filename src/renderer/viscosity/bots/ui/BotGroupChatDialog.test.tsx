import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { BotProfile } from "../api";
import { BotGroupChatDialog } from "./BotGroupChatDialog";

const mocks = vi.hoisted(() => ({
  bots: [] as BotProfile[],
  startBotGroupChat:
    vi.fn<(botIds: string[], projectId: string, title?: string) => Promise<string>>(),
  postToRoundtable:
    vi.fn<(id: string, text: string, options?: { mentions?: string[] }) => Promise<void>>(),
}));

vi.mock("../api", () => ({
  useBots: () => mocks.bots,
  startBotGroupChat: mocks.startBotGroupChat,
}));
vi.mock("../botActions", () => ({
  BOT_GROUP_CHAT_MIN_BOTS: 2,
  BOT_GROUP_CHAT_MAX_BOTS: 5,
  botGroupChatTitle: (names: readonly string[]) => `Group chat: ${names.join(", ")}`,
}));
vi.mock("../../roundtable/api", () => ({ postToRoundtable: mocks.postToRoundtable }));
vi.mock("./brainLabel", () => ({ useBrainLabel: () => "Grok · grok-4.7" }));

function bot(id: string, label: string): BotProfile {
  return {
    id,
    label,
    role: "member",
    brain: {
      kind: "xai",
      model: "grok-4.7",
      region: "global",
      tools: { webSearch: false, xSearch: false },
    },
    projectId: "p1",
    createdAt: 1,
  };
}

function renderDialog(onClose = vi.fn<() => void>()) {
  render(<BotGroupChatDialog botIds={["ada", "bea"]} onClose={onClose} />);
  return onClose;
}

async function start(firstMessage?: string) {
  if (firstMessage !== undefined) {
    fireEvent.change(screen.getByRole("textbox", { name: "First message" }), {
      target: { value: firstMessage },
    });
  }
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start group chat" }));
  });
}

beforeEach(() => {
  mocks.bots = [bot("ada", "Ada"), bot("bea", "Bea Lovelace")];
  mocks.startBotGroupChat.mockReset().mockResolvedValue("rt-group");
  mocks.postToRoundtable.mockReset().mockResolvedValue(undefined);
  useAppStore.setState({
    projects: [{ id: "p1", name: "Web app", location: { kind: "local" } } as unknown as Project],
  });
});

describe("BotGroupChatDialog", () => {
  it("posts the first message right after the start so the bots answer", async () => {
    const onClose = renderDialog();
    await start("  Plan the launch together  ");
    expect(mocks.startBotGroupChat).toHaveBeenCalledWith(["ada", "bea"], "p1", undefined);
    expect(mocks.postToRoundtable).toHaveBeenCalledWith(
      "rt-group",
      "Plan the launch together",
      undefined,
    );
    expect(mocks.startBotGroupChat.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.postToRoundtable.mock.invocationCallOrder[0]!,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends the first message's @mentions so only those bots reply", async () => {
    renderDialog();
    await start("@bea-lovelace what do you think?");
    expect(mocks.postToRoundtable).toHaveBeenCalledWith(
      "rt-group",
      "@bea-lovelace what do you think?",
      { mentions: ["bea"] },
    );
  });

  it.each([
    ["left untouched", undefined],
    ["blank", "  \n "],
  ])("posts nothing when the first message is %s", async (_case, firstMessage) => {
    const onClose = renderDialog();
    await start(firstMessage);
    expect(mocks.startBotGroupChat).toHaveBeenCalledTimes(1);
    expect(mocks.postToRoundtable).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes after a started chat whose first message was refused", async () => {
    mocks.postToRoundtable.mockRejectedValueOnce(new Error("This Roundtable has ended."));
    const onClose = renderDialog();
    await start("Hello");
    expect(mocks.postToRoundtable).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open and posts nothing when the chat cannot start", async () => {
    mocks.startBotGroupChat.mockRejectedValueOnce(new Error("This bot no longer exists."));
    const onClose = renderDialog();
    await start("Hello");
    expect(mocks.postToRoundtable).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start group chat" })).not.toBeDisabled();
  });
});
