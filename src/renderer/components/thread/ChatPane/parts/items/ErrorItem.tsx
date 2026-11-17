// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { Alert } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import type { ErrorItemPayload } from "@/shared/contracts";
// ViscosityCode: engine text can name the upstream product; brand it for display.
import { brandDisplayText } from "@/renderer/i18n/brandDisplay";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";

interface ErrorItemProps {
  item: RuntimeChatItem;
}

export function ErrorItem({ item }: ErrorItemProps) {
  const { t } = useLingui();
  const payload = getRuntimeItemPayload<ErrorItemPayload>(item, "error");
  const message = payload?.message;
  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description className="text-[length:var(--lc-chat-font-size-meta)]">
          {message == null ? t`Error` : brandDisplayText(message)}
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
