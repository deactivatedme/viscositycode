/**
 * ViscosityCode: the "Roundtable started" toast. Starting never switches the
 * view by itself (the owner asked for that), so the toast carries an Open
 * action that brings the new session forward, even when another Roundtable
 * already holds the tab.
 */
import { toast } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import { openRoundtableView } from "../ui/roundtableViewStore";

export function toastRoundtableStarted(sessionId: string, message?: string): void {
  const toastId = toast.success(message ?? i18n._(msg`Roundtable started`), {
    actionProps: {
      children: i18n._(msg`Open`),
      variant: "secondary",
      onPress: () => {
        openRoundtableView(sessionId);
        toast.close(toastId);
      },
    },
  });
}
