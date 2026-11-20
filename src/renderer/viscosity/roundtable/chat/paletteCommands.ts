/**
 * ViscosityCode: Roundtable commands for the command palette (Cmd/Ctrl+K).
 *
 * "New Roundtable…" opens the full setup dialog. "Invite another model into
 * this chat…" is also how terminal-presentation threads reach the invite
 * dialog, since `/roundtable` is a GUI-only local command. Both open a dialog
 * in place and never switch the view.
 * Outside the desktop shell they are not offered.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { getCurrentProjectId, resolveActivePaneId } from "@/renderer/actions/currentProject";
import { useAppStore } from "@/renderer/state/appStore";
import { parseDraftProjectId } from "@/shared/paneId";
import { openRoundtableSetup } from "../ui/roundtableViewStore";
import { isRoundtableChatAvailable } from "./availability";
import { lastUserMessageText, openRoundtableInvite } from "./inviteStore";

export const NEW_ROUNDTABLE_COMMAND_ID = "roundtable.new";
export const INVITE_ROUNDTABLE_COMMAND_ID = "roundtable.invite";

/** The focused pane's thread (not a draft pane), if any. */
function focusedThread(): { id: string; projectId: string } | undefined {
  const app = useAppStore.getState();
  if (app.view.kind !== "thread") return undefined;
  const paneId = resolveActivePaneId(app.view.panes, app.focusedPaneId);
  if (parseDraftProjectId(paneId)) return undefined;
  return app.threads.find((thread) => thread.id === paneId);
}

/** The same full setup dialog as the sidebar's "New Roundtable" (instructions, first message). */
export function openNewRoundtableFromPalette(): void {
  const projectId = focusedThread()?.projectId ?? getCurrentProjectId();
  if (!projectId) return;
  openRoundtableSetup({ projectId });
}

export function inviteIntoFocusedChatFromPalette(): void {
  const thread = focusedThread();
  if (!thread) return;
  openRoundtableInvite({
    kind: "invite",
    projectId: thread.projectId,
    originThreadId: thread.id,
    task: lastUserMessageText(thread.id),
  });
}

export function roundtableChatCommands(): AppCommand[] {
  const hidden = isRoundtableChatAvailable()
    ? {}
    : { showInPalette: false, showInShortcuts: false };
  return [
    {
      id: NEW_ROUNDTABLE_COMMAND_ID,
      title: msg`New Roundtable…`,
      subtitle: msg`Work with several AIs together`,
      group: msg`Roundtable`,
      keywords: [
        "roundtable",
        "together",
        "team",
        "group chat",
        "models",
        "debate",
        "review",
        "relay",
        "race",
      ],
      when: "hasProject",
      ...hidden,
      run: openNewRoundtableFromPalette,
    },
    {
      id: INVITE_ROUNDTABLE_COMMAND_ID,
      title: msg`Invite another model into this chat…`,
      subtitle: msg`Start a Roundtable from this chat`,
      group: msg`Roundtable`,
      keywords: ["roundtable", "invite", "model", "mention", "second opinion"],
      when: "hasThread",
      ...hidden,
      run: inviteIntoFocusedChatFromPalette,
    },
  ];
}
