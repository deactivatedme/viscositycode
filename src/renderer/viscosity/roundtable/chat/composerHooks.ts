/**
 * ViscosityCode: the existing-chat composer's Roundtable hook-ins, called from
 * upstream's `submitComposerPrompt` (threadComposerSubmit.ts). They take a
 * structural slice of its submit context so this module never imports the
 * composer, and they leave the normal send path untouched whenever they do
 * not apply (`null` = not handled).
 */
import { toast } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { friendlyError } from "@/shared/messages";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { lastUserMessageText, openRoundtableInvite } from "./inviteStore";
import { findRoundtableMentions, type RoundtableMentionTarget } from "./mentions";
import { postMentionedRoundtableMessage } from "./mentionRouting";
import { toastRoundtableStarted } from "./startedToast";

export interface RoundtableComposerSurface {
  thread: {
    id: string;
    projectId: string;
    title?: string | undefined;
    agentKind: string;
    config: { model: string };
  };
  presentationMode: "gui" | "terminal";
  resumesInterruptedTurn?: boolean | undefined;
  /** Surfaces with their own send action (e.g. PR Ask) never route to a Roundtable. */
  onSubmitInput?: unknown;
  roundtableMentionTargets?: readonly RoundtableMentionTarget[] | undefined;
  attachments: { getDraftAttachments(): readonly unknown[] };
  mentionRef: { current: { clear(): void } | null };
  latestSegmentsRef: { current: readonly unknown[] };
  isCurrentSession(): boolean;
  setPrompt(value: string): void;
  setHasContent(value: boolean): void;
  setIsSubmitting(value: boolean): void;
}

/** Clear the composer only if it still holds what was submitted. */
function clearComposerIfUnchanged(surface: RoundtableComposerSurface, draftAtSubmit: string): void {
  if (!surface.isCurrentSession()) return;
  if (JSON.stringify(surface.latestSegmentsRef.current) !== draftAtSubmit) return;
  surface.mentionRef.current?.clear();
  surface.setPrompt("");
  surface.setHasContent(false);
  surface.latestSegmentsRef.current = [];
  if (surface.attachments.getDraftAttachments().length === 0) {
    useAppStore.getState().clearThreadDraftContent(surface.thread.id);
  }
}

/**
 * `/roundtable [task]` in a chat: open the invite dialog with this chat as
 * the origin. The task defaults to the chat's latest user message. The
 * composer is cleared once the Roundtable starts, not before, so cancelling
 * the dialog keeps what was typed.
 */
export function openRoundtableFromComposer(surface: RoundtableComposerSurface, task: string): void {
  const draftAtSubmit = JSON.stringify(surface.latestSegmentsRef.current);
  openRoundtableInvite({
    kind: "invite",
    projectId: surface.thread.projectId,
    originThreadId: surface.thread.id,
    task: task || lastUserMessageText(surface.thread.id),
    onStarted: () => clearComposerIfUnchanged(surface, draftAtSubmit),
  });
}

/**
 * A message that `@mentions` ready models goes to the chat's open
 * Roundtable (started on the first mention) instead of the chat itself.
 * Returns `null` when the message mentions none of them.
 */
export function routeComposerRoundtableMentions(
  text: string,
  surface: RoundtableComposerSurface,
): Promise<void> | null {
  const targets = surface.roundtableMentionTargets;
  if (surface.resumesInterruptedTurn || surface.onSubmitInput || !targets?.length) return null;
  const mentioned = findRoundtableMentions(text, targets);
  if (mentioned.length === 0) return null;
  if (surface.attachments.getDraftAttachments().length > 0) {
    toast.warning(
      i18n._(
        msg`Roundtable messages are text only. Remove the attachments, or the @mention to send them to this chat.`,
      ),
    );
    return Promise.resolve();
  }
  const draftAtSubmit = JSON.stringify(surface.latestSegmentsRef.current);
  surface.setIsSubmitting(true);
  return postMentionedRoundtableMessage({
    origin: {
      id: surface.thread.id,
      title: surface.thread.title,
      agentKind: surface.thread.agentKind,
      model: surface.thread.config.model,
      presentationMode: surface.presentationMode,
    },
    projectId: surface.thread.projectId,
    text: text.trim(),
    mentioned,
    targets,
  })
    .then((result) => {
      clearComposerIfUnchanged(surface, draftAtSubmit);
      // The message leaves this chat, so every post says where it went.
      const names = mentioned.map((target) => target.label).join(", ");
      toastRoundtableStarted(
        result.sessionId,
        result.created
          ? i18n._(msg`Roundtable started with ${names}`)
          : i18n._(msg`Sent to the Roundtable for ${names}`),
      );
    })
    .catch((error: unknown) => {
      toast.danger(friendlyError(error));
    })
    .finally(() => {
      if (surface.isCurrentSession()) surface.setIsSubmitting(false);
    });
}
