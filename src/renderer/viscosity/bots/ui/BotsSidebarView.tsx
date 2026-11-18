/**
 * ViscosityCode Bots UI: the activity bar's Bots sidebar view (fork of
 * Poracode). Lists the user's bots (avatar with live state, name, brain) and
 * the group chats they sit in (Roundtables in the "open" pattern seating at
 * least one bot), with "New bot" and "New group chat". Rows reuse the
 * sidebar's `SidebarButton` pattern; pressing a bot opens its ongoing chat.
 */
import { Dropdown, Label, Button as HeroButton, toast } from "@heroui/react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { SyntheticEvent } from "react";
import { Bot, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, UsersRound } from "lucide-react";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import type { ActivitySidebarViewProps } from "@/renderer/viscosity/layout/activityBar";
import { friendlyError } from "@/shared/messages";
import { openRoundtableView, useRoundtableViewStore } from "@/renderer/viscosity/roundtable";
import {
  type RoundtableSummary,
  useRoundtableList,
  useRoundtableSession,
} from "../../roundtable/api";
import { type BotProfile, openBot, useBots } from "../api";
import { startNewBotSession } from "../botActions";
import { useBotChatPanelStore } from "../botChatPanelStore";
import { BotAvatar, BotAvatarStack } from "./BotAvatar";
import { BotsDialogHost } from "./BotsDialogHost";
import { useBotLiveState } from "./botLiveState";
import { confirmDeleteBot, openBotEditor, openBotGroupChatDialog } from "./botsDialogStore";
import { useBrainLabel } from "./brainLabel";

/** Same wording as the Roundtable list, so the catalog already translates it. */
const GROUP_CHAT_STATUS_LABELS: Readonly<Record<RoundtableSummary["status"], MessageDescriptor>> = {
  draft: msg`Draft`,
  running: msg`Running`,
  paused: msg`Paused`,
  done: msg`Done`,
  failed: msg`Failed`,
  stopped: msg`Stopped`,
};

function reportFailure(error: unknown): void {
  toast.danger(friendlyError(error));
}

function stopPropagation(event: SyntheticEvent): void {
  event.stopPropagation();
}

function BotRowMenu(props: { bot: BotProfile }) {
  const { t } = useLingui();
  const { bot } = props;
  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={t`Bot actions for ${bot.label}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-3xl text-muted outline-none hover:bg-[var(--row-hover)] hover:text-foreground focus-visible:focus-ring"
      >
        <MoreHorizontal aria-hidden="true" className="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label={t`Bot actions for ${bot.label}`}
          className="poracode-menu min-w-44"
          onAction={(key) => {
            if (key === "edit") openBotEditor(bot.id);
            else if (key === "new-session") void startNewBotSession(bot.id).catch(reportFailure);
            else if (key === "delete") confirmDeleteBot(bot.id);
          }}
        >
          <Dropdown.Item id="edit" textValue={t`Edit bot`}>
            <Pencil aria-hidden="true" className="size-3.5" />
            <Label>
              <Trans>Edit bot</Trans>
            </Label>
          </Dropdown.Item>
          <Dropdown.Item id="new-session" textValue={t`New session`}>
            <RotateCcw aria-hidden="true" className="size-3.5" />
            <Label>
              <Trans>New session</Trans>
            </Label>
          </Dropdown.Item>
          <Dropdown.Item id="delete" textValue={t`Delete bot`} variant="danger">
            <Trash2 aria-hidden="true" className="size-3.5" />
            <Label>
              <Trans>Delete bot</Trans>
            </Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function BotRow(props: { bot: BotProfile; active: boolean }) {
  const { bot } = props;
  const state = useBotLiveState(bot);
  const brain = useBrainLabel(bot.brain, bot.projectId);
  return (
    <div role="listitem" data-vc-bot-row={bot.id} data-vc-bot-state={state}>
      <SidebarButton
        size="xs"
        isActive={props.active}
        isCurrentPage={props.active}
        icon={<BotAvatar bot={bot} state={state} />}
        label={
          <>
            <span className="vc-bots-list__title">{bot.label}</span>
            <span className="vc-bots-list__meta">{brain}</span>
          </>
        }
        suffix={
          // The menu sits inside the row: its presses must not also open the bot.
          <span role="presentation" onClick={stopPropagation} onKeyDown={stopPropagation}>
            <BotRowMenu bot={bot} />
          </span>
        }
        onPress={() => void openBot(bot.id).catch(reportFailure)}
      />
    </div>
  );
}

/** One group chat row; renders nothing for an "open" Roundtable without bots. */
function GroupChatRow(props: {
  summary: RoundtableSummary;
  botsById: ReadonlyMap<string, BotProfile>;
  active: boolean;
}) {
  const { i18n } = useLingui();
  const session = useRoundtableSession(props.summary.id);
  const seatedBots = (session?.participants ?? []).flatMap((participant) => {
    const bot = props.botsById.get(participant.id);
    return bot ? [bot] : [];
  });
  if (seatedBots.length === 0) return null;
  return (
    <div role="listitem" data-vc-bot-group-chat={props.summary.id}>
      <SidebarButton
        size="xs"
        isActive={props.active}
        isCurrentPage={props.active}
        icon={<UsersRound aria-hidden="true" className="size-3.5 shrink-0" />}
        label={
          <>
            <span className="vc-bots-list__title">{props.summary.title}</span>
            <span className="vc-bots-list__meta">
              {i18n._(GROUP_CHAT_STATUS_LABELS[props.summary.status])}
            </span>
          </>
        }
        suffix={<BotAvatarStack bots={seatedBots} />}
        onPress={() => openRoundtableView(props.summary.id)}
      />
    </div>
  );
}

export function BotsSidebarView(_props: ActivitySidebarViewProps) {
  const { t } = useLingui();
  const bots = useBots();
  const openBotId = useBotChatPanelStore((state) => state.openBotId);
  const activeSessionId = useRoundtableViewStore((state) =>
    state.shown ? state.openSessionId : null,
  );
  const groupChats = useRoundtableList()
    .filter((summary) => summary.pattern === "open")
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const botsById = new Map(bots.map((bot) => [bot.id, bot]));

  return (
    <div className="vc-bots-list flex h-full min-h-0 flex-col" data-vc-bots-view="">
      <div className="flex shrink-0 flex-col gap-px px-2 pb-1">
        <SidebarButton
          size="xs"
          icon={<Plus aria-hidden="true" className="size-3.5 shrink-0" />}
          label={t`New bot`}
          onPress={() => openBotEditor()}
        />
        <SidebarButton
          size="xs"
          icon={<UsersRound aria-hidden="true" className="size-3.5 shrink-0" />}
          label={t`New group chat`}
          isDisabled={bots.length < 2}
          onPress={() => openBotGroupChatDialog()}
        />
      </div>
      {bots.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <Bot aria-hidden="true" className="size-5 text-muted" />
          <p className="text-sm text-foreground">
            <Trans>No bots yet</Trans>
          </p>
          <p className="text-xs text-muted">
            <Trans>
              Bots are named teammates with their own brain, instructions and memory. They use the
              agents you are already signed in to, or Grok over the xAI API.
            </Trans>
          </p>
          <HeroButton size="sm" variant="secondary" onPress={() => openBotEditor()}>
            <Plus aria-hidden="true" className="size-3.5" />
            <Trans>New bot</Trans>
          </HeroButton>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
          <div className="vc-bots-list__section" id="vc-bots-list-heading">
            <Trans>Bots</Trans>
          </div>
          <div
            role="list"
            aria-labelledby="vc-bots-list-heading"
            className="flex flex-col gap-px px-2"
          >
            {bots.map((bot) => (
              <BotRow key={bot.id} bot={bot} active={bot.id === openBotId} />
            ))}
          </div>
          {groupChats.length > 0 ? (
            // Hidden by CSS while no listed Roundtable seats a bot (rows decide that themselves).
            <div className="vc-bots-group-chats">
              <div className="vc-bots-list__section" id="vc-bots-group-chats-heading">
                <Trans>Group chats</Trans>
              </div>
              <div
                role="list"
                aria-labelledby="vc-bots-group-chats-heading"
                className="flex flex-col gap-px px-2"
              >
                {groupChats.map((summary) => (
                  <GroupChatRow
                    key={summary.id}
                    summary={summary}
                    botsById={botsById}
                    active={summary.id === activeSessionId}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
      <BotsDialogHost />
    </div>
  );
}
