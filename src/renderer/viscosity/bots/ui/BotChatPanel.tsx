/**
 * ViscosityCode Bots UI: the native chat of a bot whose brain is a Grok model
 * on the xAI API (fork of Poracode). Shown over the center split view, like
 * the Roundtable panel; agent bots use their ordinary thread instead.
 *
 * The transcript renders with the app's chat markdown renderer. Only the live
 * reply row re-renders while a reply streams (throttled to 8 Hz by the
 * driver); the composer is the app's own thread composer.
 */
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Tooltip, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Pencil, RotateCcw, Settings2, X } from "lucide-react";
import { friendlyError } from "@/shared/messages";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { panelHeaderIconButtonClass } from "@/renderer/components/layout/sidebarChrome";
import { ItemMarkdown } from "@/renderer/components/thread/ChatPane/parts/items/ItemMarkdown";
import { ThreadComposer } from "@/renderer/components/thread/ThreadComposer";
import { usePanelStore } from "@/renderer/state/panelStore";
import { type BotProfile, useBot } from "../api";
import { startNewBotSession } from "../botActions";
import {
  type BotChatMessage,
  sendBotApiMessage,
  stopBotApiReply,
  useBotChatsStore,
  useBotLiveReply,
} from "../botApiChat";
import { closeBotChatPanel } from "../botChatPanelStore";
import { refreshXaiKeyStatus, useXaiKeyStatus } from "@/renderer/viscosity/xai/useXaiKeyStatus";
import { BotAvatar } from "./BotAvatar";
import { useBotLiveState } from "./botLiveState";
import { openBotEditor } from "./botsDialogStore";
import { useBrainLabel } from "./brainLabel";

const EMPTY_MESSAGES: readonly BotChatMessage[] = [];
const headerButtonClass = `${panelHeaderIconButtonClass} h-auto w-auto min-h-0 min-w-0`;

function HeaderAction(props: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className={headerButtonClass}
          aria-label={props.label}
          onPress={props.onPress}
        >
          {props.children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom">{props.label}</Tooltip.Content>
    </Tooltip>
  );
}

function MessageRow(props: { message: BotChatMessage; bot: BotProfile }) {
  const { t } = useLingui();
  const { message } = props;
  if (message.role === "user") {
    return (
      <div className="vc-bot-chat__message" data-role="user">
        <div className="vc-bot-chat__bubble">{message.text}</div>
      </div>
    );
  }
  return (
    <div className="vc-bot-chat__message" data-role="assistant">
      <BotAvatar bot={props.bot} size="md" />
      <div className="vc-bot-chat__bubble">
        {message.text ? <ItemMarkdown text={message.text} /> : null}
        {message.status === "stopped" ? (
          <p className="vc-bot-chat__note">{t`Stopped.`}</p>
        ) : message.status === "failed" ? (
          <p role="alert" className="vc-bot-chat__note" data-tone="error">
            {message.error ?? t`The bot could not answer.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The streaming reply: the only row that re-renders while text arrives. */
function LiveReply(props: { chatId: string; bot: BotProfile }) {
  const text = useBotLiveReply(props.chatId);
  return (
    <div className="vc-bot-chat__message" data-role="assistant" data-vc-bot-live="">
      <BotAvatar bot={props.bot} size="md" state="working" />
      {/* aria-busy: the transcript is already a polite live region (role="log");
          streamed updates are not announced one by one, the finished reply is. */}
      <div className="vc-bot-chat__bubble" aria-busy="true">
        {text ? <ItemMarkdown text={text} /> : <PixelLoader size="sm" />}
      </div>
    </div>
  );
}

function Transcript(props: { bot: BotProfile; chatId: string | undefined }) {
  const { chatId } = props;
  const messages = useBotChatsStore((state) =>
    chatId ? (state.chats[chatId]?.messages ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const running = useBotChatsStore((state) => (chatId ? Boolean(state.running[chatId]) : false));
  const name = props.bot.label;
  return (
    // column-reverse keeps the view pinned to the newest message as replies grow.
    <div className="vc-bot-chat__transcript flex flex-col-reverse">
      <div className="vc-bot-chat__column" role="log" aria-label={name}>
        {messages.length === 0 && !running ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <BotAvatar bot={props.bot} size="lg" />
            <p className="text-sm font-medium text-foreground">{name}</p>
            <p className="max-w-80 text-xs text-muted">
              <Trans>
                Ask {name} anything. The chat stays on this device; New session starts over.
              </Trans>
            </p>
          </div>
        ) : null}
        {messages.map((message) => (
          <MessageRow key={message.id} message={message} bot={props.bot} />
        ))}
        {running && chatId ? <LiveReply chatId={chatId} bot={props.bot} /> : null}
      </div>
    </div>
  );
}

function Composer(props: { bot: BotProfile; chatId: string | undefined }) {
  const { t } = useLingui();
  const { bot, chatId } = props;
  const [draft, setDraft] = useState("");
  const latestDraft = useRef(draft);
  useLayoutEffect(() => {
    latestDraft.current = draft;
  });
  const running = useBotChatsStore((state) => (chatId ? Boolean(state.running[chatId]) : false));
  const xaiKey = useXaiKeyStatus();
  // Blocked once the status is known: no bridge here, or no key from env or storage.
  const blocked = !xaiKey.available || (xaiKey.status !== undefined && !xaiKey.status.configured);
  const canSend = !blocked && !running && draft.trim().length > 0;
  const name = bot.label;

  function submit() {
    if (!canSend) return;
    const text = draft.trim();
    setDraft("");
    void sendBotApiMessage(bot.id, text).then(
      (sent) => {
        // Nothing was sent: give the text back unless the user typed something new.
        if (!sent && latestDraft.current === "") setDraft(text);
      },
      (error: unknown) => toast.danger(friendlyError(error)),
    );
  }

  return (
    <div className="vc-bot-chat__composer">
      {blocked ? (
        <div role="status" className="mb-2 flex items-center gap-2 text-xs text-muted">
          <span>
            <Trans>Grok bots need your xAI API key.</Trans>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-auto min-h-0 px-1 text-[var(--link)]"
            onPress={() => usePanelStore.getState().openSettingsSection("bots", "bots.xaiKey")}
          >
            <Settings2 aria-hidden="true" className="size-3.5" />
            <Trans>Open Settings → Bots</Trans>
          </Button>
        </div>
      ) : null}
      <ThreadComposer
        variant="active"
        prompt={draft}
        placeholder={t`Message ${name}`}
        promptDisabled={blocked}
        submitLabel={t`Send`}
        submitDisabled={!canSend}
        controls={[]}
        onPromptChange={setDraft}
        onSubmit={submit}
        onStop={
          running && chatId
            ? () => {
                void stopBotApiReply(chatId);
              }
            : undefined
        }
      />
    </div>
  );
}

function BotChatPanelContent(props: { bot: BotProfile }) {
  const { t } = useLingui();
  const { bot } = props;
  const state = useBotLiveState(bot);
  const brain = useBrainLabel(bot.brain, bot.projectId);

  useEffect(() => {
    void refreshXaiKeyStatus();
  }, []);

  return (
    <section className="vc-bot-chat" aria-label={bot.label} data-vc-bot-chat={bot.id}>
      <header className="vc-bot-chat__header">
        <BotAvatar bot={bot} size="md" state={state} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold text-foreground">{bot.label}</h2>
          <p className="truncate text-[11px] text-muted">{brain}</p>
        </div>
        <HeaderAction
          label={t`New session`}
          onPress={() =>
            void startNewBotSession(bot.id).catch((error: unknown) =>
              toast.danger(friendlyError(error)),
            )
          }
        >
          <RotateCcw className="size-3.5" />
        </HeaderAction>
        <HeaderAction label={t`Edit bot`} onPress={() => openBotEditor(bot.id)}>
          <Pencil className="size-3.5" />
        </HeaderAction>
        <HeaderAction label={t`Close chat`} onPress={closeBotChatPanel}>
          <X className="size-3.5" />
        </HeaderAction>
      </header>
      <Transcript bot={bot} chatId={bot.chatId} />
      <Composer key={bot.chatId ?? "none"} bot={bot} chatId={bot.chatId} />
    </section>
  );
}

export function BotChatPanel(props: { botId: string }) {
  const bot = useBot(props.botId);
  // A deleted bot, or one switched to an agent brain, has no panel chat.
  const usable = bot?.brain.kind === "xai";
  useEffect(() => {
    if (!usable) closeBotChatPanel();
  }, [usable]);
  return bot && usable ? <BotChatPanelContent bot={bot} /> : null;
}
