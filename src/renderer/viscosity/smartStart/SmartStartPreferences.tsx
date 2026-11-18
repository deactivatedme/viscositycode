/**
 * ViscosityCode: Smart start preferences (fork of Poracode).
 *
 * Two ordered provider lists the owner can edit: "Preferred for coding" and
 * "Preferred for quick questions". Auto gives the first few providers of the
 * matching list a small head start over pure usage headroom. A list the
 * owner never edited follows the last-used order. Providers are agent kinds,
 * named through their manifests, so nothing here knows one by name.
 *
 * `SmartStartPreferencesEditor` is the body (mountable in Settings);
 * `SmartStartPreferencesDialog` wraps it for the composer's Auto row.
 */
import { Modal } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/renderer/components/common/Button";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import {
  getProviderManifest,
  getProviderModelPickerRank,
} from "@/renderer/components/providers/providerManifest";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useManagedAgentStatuses } from "@/renderer/viscosity/accountPools/poolHooks";
import { completeProviderOrder, moveProvider } from "./preferencesModel";
import { useLastUsedProviderOrder } from "./lastUsed";
import { PREFERENCE_BONUS, smartStartProviderOf } from "./scoring";
import { useSmartStartStore } from "./smartStartStore";
import type { SmartStartTaskKind } from "./taskKind";

/** Installed, enabled providers of the managed host, in the model picker's order. */
function useKnownProviders(): string[] {
  const statuses = useManagedAgentStatuses();
  const disabledAgents = useSharedSettings((state) => state.disabledAgents);
  const providers = statuses
    .filter((status) => status.installed && !disabledAgents.includes(status.kind))
    .map((status) => smartStartProviderOf(status.kind));
  return completeProviderOrder([], providers).toSorted(
    (left, right) => getProviderModelPickerRank(left) - getProviderModelPickerRank(right),
  );
}

function PreferenceList(props: {
  kind: SmartStartTaskKind;
  title: string;
  description: string;
  known: readonly string[];
  lastUsed: readonly string[];
}) {
  const { t } = useLingui();
  const explicit = useSmartStartStore((state) =>
    Object.hasOwn(state.preferences, props.kind) ? state.preferences[props.kind] : undefined,
  );
  const setPreference = useSmartStartStore((state) => state.setPreference);
  const order = completeProviderOrder(explicit ?? props.lastUsed, props.known);
  const labelOf = (provider: string): string => {
    const manifest = getProviderManifest(provider);
    return manifest ? t(manifest.label) : provider;
  };
  const headStart = PREFERENCE_BONUS.length;

  return (
    <section className="flex flex-col gap-2" aria-label={props.title}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
          <p className="mt-0.5 text-xs text-muted">{props.description}</p>
        </div>
        {explicit ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs text-muted"
            onPress={() => setPreference(props.kind, null)}
          >
            <Trans>Use last-used order</Trans>
          </Button>
        ) : (
          <span className="shrink-0 text-xs text-muted">
            <Trans>Following your last-used order</Trans>
          </span>
        )}
      </div>
      {order.length === 0 ? (
        <p className="text-xs text-muted">
          <Trans>No providers are installed yet.</Trans>
        </p>
      ) : (
        <ol className="flex flex-col rounded-md border border-border">
          {order.map((provider, index) => {
            const label = labelOf(provider);
            return (
              <li
                key={provider}
                className="flex items-center gap-2 border-b border-border px-2 py-1 text-sm last:border-b-0"
              >
                <span className="w-4 shrink-0 text-right text-xs text-muted tabular-nums">
                  {index + 1}
                </span>
                <ProviderIcon kind={provider} fallbackLabel={label} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
                {index < headStart ? (
                  <span className="shrink-0 text-xs text-muted">
                    <Trans>head start</Trans>
                  </span>
                ) : null}
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="size-6 min-w-0 shrink-0 text-muted"
                  aria-label={t`Move ${label} up`}
                  isDisabled={index === 0}
                  onPress={() => setPreference(props.kind, moveProvider(order, index, -1))}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="size-6 min-w-0 shrink-0 text-muted"
                  aria-label={t`Move ${label} down`}
                  isDisabled={index === order.length - 1}
                  onPress={() => setPreference(props.kind, moveProvider(order, index, 1))}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Both preference lists; mountable in Settings or the composer dialog. */
export function SmartStartPreferencesEditor() {
  const { t } = useLingui();
  const known = useKnownProviders();
  const lastUsed = useLastUsedProviderOrder();
  return (
    <div className="flex flex-col gap-5" data-vc-smart-start-preferences="">
      <PreferenceList
        kind="coding"
        title={t`Preferred for coding`}
        description={t`When a prompt looks like coding work, Auto gives the first providers here a small head start. Usage left still matters most.`}
        known={known}
        lastUsed={lastUsed}
      />
      <PreferenceList
        kind="quick"
        title={t`Preferred for quick questions`}
        description={t`When a prompt looks like a quick question, Auto gives the first providers here a small head start. Usage left still matters most.`}
        known={known}
        lastUsed={lastUsed}
      />
    </div>
  );
}

export function SmartStartPreferencesDialog(props: { onClose: () => void }) {
  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && props.onClose()}>
      <Modal.Container scroll="inside">
        <Modal.Dialog className="sm:max-w-[460px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              <Trans>Smart start preferences</Trans>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-3 p-4">
            <p className="text-sm text-muted">
              <Trans>
                Auto starts new threads on the ready account with the most usage left. These lists
                break close calls by what the prompt looks like.
              </Trans>
            </p>
            <SmartStartPreferencesEditor />
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              <Trans>Done</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
