/**
 * ViscosityCode: Roundtable commands for the command palette (Cmd/Ctrl+K).
 *
 * "Invite another model into this chat…" is also how terminal-presentation
 * threads reach the invite dialog, since `/roundtable` is a GUI-only local
 * command. Both commands open the dialog in place and never switch the view.
 * Outside the desktop shell they are not offered.
 */
import { msg } from "@lingui/core/macro";
import type { AppCommand } from "@/renderer/commands/registry";
import { getCurrentProjectId, resolveActivePaneId } from "@/renderer/actions/currentProject";
import { useAppStore } from "@/renderer/state/appStore";
import { parseDraftProjectId } from "@/shared/paneId";
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

export function openNewRoundtableFromPalette(): void {
  const projectId = focusedThread()?.projectId ?? getCurrentProjectId();
  if (!projectId) return;
  openRoundtableInvite({ kind: "new", projectId, task: "" });
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
      subtitle: msg`Seat several models on one task`,
      group: msg`Roundtable`,
      keywords: ["roundtable", "debate", "review", "relay", "race", "group chat", "models"],
      when: "hasProject",
      ...hidden,
      run: openNewRoundtableFromPalette,
    },
    {
      id: INVITE_ROUNDTABLE_COMMAND_ID,
      title: msg`Invite another model into this chat…`,
      subtitle: msg`Start a Roundtable from this chat`,
      group: msg`Roundtable`,
      keywords: ["roundtable", "invite", "model", "bot", "mention", "second opinion"],
      when: "hasThread",
      ...hidden,
      run: inviteIntoFocusedChatFromPalette,
    },
  ];
}
