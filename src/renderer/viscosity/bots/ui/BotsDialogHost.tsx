/**
 * ViscosityCode Bots UI: renders the open bot dialog (editor, group chat,
 * delete confirmation). Mounted by the Bots sidebar view and the center chat
 * panel; only the first mounted host renders (see `useBotsDialogHostLease`).
 */
import { toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { friendlyError } from "@/shared/messages";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { useBot } from "../api";
import { removeBot } from "../botActions";
import { BotEditorDialog } from "./BotEditorDialog";
import { BotGroupChatDialog } from "./BotGroupChatDialog";
import { closeBotsDialog, useBotsDialogHostLease, useBotsDialogStore } from "./botsDialogStore";

function DeleteBotDialog(props: { botId: string }) {
  const { t } = useLingui();
  const bot = useBot(props.botId);
  const name = bot?.label ?? "";
  return (
    <ConfirmDialog
      isOpen
      status="danger"
      confirmVariant="danger"
      title={t`Delete ${name}?`}
      body={
        bot?.brain.kind === "agent"
          ? t`The bot's profile is removed. Its thread stays in your sidebar.`
          : t`The bot's profile and its chat on this device are removed.`
      }
      confirmLabel={t`Delete bot`}
      onClose={closeBotsDialog}
      onConfirm={() => {
        closeBotsDialog();
        void removeBot(props.botId).catch((error: unknown) => toast.danger(friendlyError(error)));
      }}
    />
  );
}

export function BotsDialogHost() {
  const leader = useBotsDialogHostLease();
  const dialog = useBotsDialogStore((state) => state.dialog);
  if (!leader || !dialog) return null;
  switch (dialog.kind) {
    case "editor":
      return (
        <BotEditorDialog
          key={dialog.nonce}
          {...(dialog.botId ? { botId: dialog.botId } : {})}
          onClose={closeBotsDialog}
        />
      );
    case "group-chat":
      return (
        <BotGroupChatDialog
          key={dialog.nonce}
          {...(dialog.botIds ? { botIds: dialog.botIds } : {})}
          onClose={closeBotsDialog}
        />
      );
    case "delete":
      return <DeleteBotDialog key={dialog.nonce} botId={dialog.botId} />;
  }
}
