import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { BotProfile } from "../api";
import { BotChatPanel } from "./BotChatPanel";

const mocks = vi.hoisted(() => ({
  bot: undefined as BotProfile | undefined,
  closeBotChatPanel: vi.fn<() => void>(),
}));

vi.mock("../api", () => ({ useBot: () => mocks.bot }));
vi.mock("../botActions", () => ({ startNewBotSession: vi.fn<() => Promise<void>>() }));
vi.mock("../botChatPanelStore", () => ({ closeBotChatPanel: mocks.closeBotChatPanel }));
vi.mock("../botApiChat", () => ({
  useBotChatsStore: (select: (state: { chats: object; running: object }) => unknown) =>
    select({ chats: {}, running: {} }),
  useBotLiveReply: () => "",
  sendBotApiMessage: vi.fn<() => Promise<boolean>>(),
  stopBotApiReply: vi.fn<() => Promise<void>>(),
}));
vi.mock("./botLiveState", () => ({ useBotLiveState: () => "idle" }));
vi.mock("./brainLabel", () => ({ useBrainLabel: () => "Grok · grok-4.7" }));
vi.mock("@/renderer/viscosity/xai/useXaiKeyStatus", () => ({
  refreshXaiKeyStatus: () => Promise.resolve(),
  useXaiKeyStatus: () => ({
    available: true,
    status: { configured: true, source: "stored" },
    loading: false,
    error: undefined,
  }),
}));
// The app's composer and markdown renderer are covered by their own tests.
vi.mock("@/renderer/components/thread/ThreadComposer", () => ({
  ThreadComposer: (props: { placeholder?: string }) => <textarea aria-label={props.placeholder} />,
}));
vi.mock("@/renderer/components/thread/ChatPane/parts/items/ItemMarkdown", () => ({
  ItemMarkdown: (props: { text: string }) => <p>{props.text}</p>,
}));

function grokBot(): BotProfile {
  return {
    id: "ada",
    label: "Ada",
    role: "member",
    brain: {
      kind: "xai",
      model: "grok-4.7",
      region: "global",
      tools: { webSearch: false, xSearch: false },
    },
    projectId: "p1",
    chatId: "chat-1",
    createdAt: 1,
  };
}

/** The center body as the shell renders it: the panes, then the bot chat panel. */
function CenterBody(props: { children?: ReactNode }) {
  return (
    <div data-vc-center-body="">
      <div data-testid="panes">
        <button type="button">Pane composer</button>
      </div>
      {props.children}
    </div>
  );
}

beforeEach(() => {
  mocks.bot = grokBot();
  mocks.closeBotChatPanel.mockReset();
});

describe("BotChatPanel", () => {
  it("makes the panes inert and takes focus while open, and gives both back on close", () => {
    const { rerender } = render(<CenterBody />);
    const panes = screen.getByTestId("panes");
    const paneButton = screen.getByRole("button", { name: "Pane composer" });
    paneButton.focus();

    rerender(
      <CenterBody>
        <BotChatPanel botId="ada" />
      </CenterBody>,
    );
    const panel = screen.getByRole("region", { name: "Ada" });
    expect(panes.hasAttribute("inert")).toBe(true);
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(panel);

    screen.getByRole("button", { name: "Close chat" }).focus();
    rerender(<CenterBody />);
    expect(panes.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(paneButton);
  });

  it("covers nothing for a bot that has no panel chat", () => {
    mocks.bot = {
      ...grokBot(),
      brain: { kind: "agent", agentKind: "provider-a", model: "model-1", presentationMode: "gui" },
    };
    render(
      <CenterBody>
        <BotChatPanel botId="ada" />
      </CenterBody>,
    );
    expect(screen.getByTestId("panes").hasAttribute("inert")).toBe(false);
    expect(mocks.closeBotChatPanel).toHaveBeenCalled();
  });
});
