/**
 * ViscosityCode: the note a single-account provider's settings page shows in
 * place of the account pool card (fork of Poracode). The reason is declared by
 * the provider (`NativeAgentRegistryEntry.accountPoolUnavailableReason`), so
 * shared code never names a provider.
 */
import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";

export function AccountPoolUnavailableNote(props: { reason: MessageDescriptor }) {
  const { t } = useLingui();
  return (
    <div
      data-account-pool-unavailable=""
      className="border-t border-border/10 pt-4 text-xs text-muted"
    >
      <p className="text-sm font-medium text-foreground">
        <Trans>Account pool</Trans>
      </p>
      <p>{t(props.reason)}</p>
    </div>
  );
}
