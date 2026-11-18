/**
 * ViscosityCode Bots UI: start a group chat (fork of Poracode). Picks 2–5
 * bots, the workspace project, an optional title and an optional first
 * message, then starts a Roundtable in the "open" pattern through the Bots
 * API. The first message is posted right after the start so the bots answer
 * at once; later messages go through the Roundtable panel, where the user
 * @mentions who should reply.
 */
import { useState } from "react";
import { Checkbox, Input, Label, Modal, TextField, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { isHomeProject } from "@/shared/homeScope";
import { friendlyError } from "@/shared/messages";
import { Button } from "@/renderer/components/common/Button";
import { Select } from "@/renderer/components/common/Select";
import { TextArea } from "@/renderer/components/common/TextArea";
import { useAppStore } from "@/renderer/state/appStore";
import { postOpeningMessage } from "../../roundtable/ui/openingMessage";
import { startBotGroupChat, useBots } from "../api";
import { BOT_GROUP_CHAT_MAX_BOTS, BOT_GROUP_CHAT_MIN_BOTS, botGroupChatTitle } from "../botActions";
import { BotAvatar } from "./BotAvatar";
import { useBrainLabel } from "./brainLabel";

function BotOption(props: {
  bot: ReturnType<typeof useBots>[number];
  selected: boolean;
  disabled: boolean;
  onChange: (selected: boolean) => void;
}) {
  const brain = useBrainLabel(props.bot.brain, props.bot.projectId);
  return (
    <Checkbox
      isSelected={props.selected}
      isDisabled={props.disabled}
      onChange={props.onChange}
      className="w-full"
    >
      <Checkbox.Content className="flex w-full items-center gap-2">
        <Checkbox.Control className="border border-[var(--hairline-strong)] bg-surface-secondary shadow-none">
          <Checkbox.Indicator />
        </Checkbox.Control>
        <BotAvatar bot={props.bot} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{props.bot.label}</span>
          <span className="truncate text-[11px] text-muted">{brain}</span>
        </span>
      </Checkbox.Content>
    </Checkbox>
  );
}

export function BotGroupChatDialog(props: { botIds?: string[]; onClose: () => void }) {
  const { t } = useLingui();
  const bots = useBots();
  const projects = useAppStore((state) => state.projects);
  const [selected, setSelected] = useState<string[]>(() =>
    (props.botIds ?? []).filter((id) => bots.some((bot) => bot.id === id)),
  );
  const firstSelected = bots.find((bot) => bot.id === selected[0]);
  const [projectId, setProjectId] = useState<string>(
    () => firstSelected?.projectId ?? bots[0]?.projectId ?? "",
  );
  const [title, setTitle] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [starting, setStarting] = useState(false);

  const count = selected.length;
  const projectExists = projects.some((project) => project.id === projectId);
  const canStart =
    count >= BOT_GROUP_CHAT_MIN_BOTS &&
    count <= BOT_GROUP_CHAT_MAX_BOTS &&
    projectExists &&
    !starting;
  const reason =
    count < BOT_GROUP_CHAT_MIN_BOTS
      ? t`Pick at least two bots.`
      : !projectExists
        ? t`Pick a workspace project.`
        : null;
  const names = bots.filter((bot) => selected.includes(bot.id)).map((bot) => bot.label);
  const projectOptions = projects
    .filter((project) => !isHomeProject(project))
    .map((project) => ({ id: project.id, label: project.name }));

  function toggle(botId: string, on: boolean) {
    setSelected((current) =>
      on ? [...current.filter((id) => id !== botId), botId] : current.filter((id) => id !== botId),
    );
  }

  async function start() {
    if (!canStart) return;
    setStarting(true);
    // The bots in the order they are seated (the session keeps it), so the
    // first message's @mentions resolve like the Roundtable composer's.
    const seated = selected.flatMap((id) => bots.filter((bot) => bot.id === id));
    let sessionId: string;
    try {
      sessionId = await startBotGroupChat(selected, projectId, title.trim() || undefined);
    } catch (error) {
      toast.danger(friendlyError(error));
      setStarting(false);
      return;
    }
    // The chat has started either way; a message that could not be posted is only reported.
    await postOpeningMessage(sessionId, firstMessage, seated).catch((error: unknown) =>
      toast.danger(friendlyError(error)),
    );
    setStarting(false);
    props.onClose();
    // The view does not switch: say where the group chat went.
    toast.success(t`Roundtable started`);
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && props.onClose()}>
      <Modal.Container placement="center" scroll="inside">
        <Modal.Dialog className="sm:max-w-[460px]" data-vc-bot-group-chat-dialog="">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              <Trans>New group chat</Trans>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="p-4">
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted">
                <Trans>
                  Seat two to five bots in one chat. @mention who should answer; the others can
                  react in turn.
                </Trans>
              </p>
              <div
                role="group"
                aria-label={t`Bots in this chat`}
                className="flex max-h-64 flex-col gap-2 overflow-y-auto"
              >
                {bots.map((bot) => {
                  const isSelected = selected.includes(bot.id);
                  return (
                    <BotOption
                      key={bot.id}
                      bot={bot}
                      selected={isSelected}
                      disabled={!isSelected && count >= BOT_GROUP_CHAT_MAX_BOTS}
                      onChange={(on) => {
                        toggle(bot.id, on);
                        if (on && !projectExists) setProjectId(bot.projectId);
                      }}
                    />
                  );
                })}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  <Trans>Workspace</Trans>
                </span>
                <Select
                  aria-label={t`Workspace project`}
                  options={projectOptions}
                  value={projectId}
                  placeholder={t`Choose a project`}
                  onChange={setProjectId}
                />
              </div>
              <TextField className="gap-1.5" value={title} onChange={setTitle}>
                <Label className="text-xs font-medium text-foreground">
                  <Trans>Title</Trans>
                </Label>
                <Input placeholder={botGroupChatTitle(names.length > 0 ? names : [t`your bots`])} />
              </TextField>
              <TextField className="gap-1.5" value={firstMessage} onChange={setFirstMessage}>
                <Label className="text-xs font-medium text-foreground">
                  <Trans>First message</Trans>
                </Label>
                <TextArea
                  rows={3}
                  className="resize-y"
                  placeholder={t`Optional. Sent as soon as the chat starts; @mention who should answer.`}
                />
              </TextField>
              <p role="status" className="min-h-4 text-[11px] text-muted">
                {reason}
              </p>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted">
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="tertiary"
              isDisabled={!canStart}
              isPending={starting}
              onPress={() => void start()}
            >
              <Trans>Start group chat</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
