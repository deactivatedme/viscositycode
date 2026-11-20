/**
 * ViscosityCode: Cursor's line in the Cloud tab's setup state (fork of
 * Poracode). It names the same labels the profile settings show, so the
 * directions always match the screen they point to.
 */
import { Button } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { registerCloudAgentSetupHint } from "@/renderer/viscosity/cloudAgents/cloudSetupHints";
import {
  CURSOR_CLOUD_TARGET_LABEL,
  CURSOR_PROFILES_HEADING,
  CURSOR_RUN_IN_LABEL,
} from "./cloudProfileSettings";
import providerManifest from "./manifest";

export function CursorCloudSetupHint(props: { openAgentSettings: (agentKind: string) => void }) {
  const { t } = useLingui();
  const provider = t(providerManifest.label);
  const profiles = t(CURSOR_PROFILES_HEADING);
  const runIn = t(CURSOR_RUN_IN_LABEL);
  const cloud = t(CURSOR_CLOUD_TARGET_LABEL);
  return (
    <div className="flex flex-col items-center gap-2" data-cloud-setup-hint={providerManifest.kind}>
      <p>
        <Trans>
          In Settings → Agents → {provider} → {profiles}, add a profile with a User API key, then
          set {runIn} to {cloud}.
        </Trans>
      </p>
      <Button
        size="sm"
        variant="secondary"
        onPress={() => props.openAgentSettings(providerManifest.kind)}
      >
        <Trans>Open {provider} settings</Trans>
      </Button>
    </div>
  );
}

export function registerCursorCloudSetupHint(): () => void {
  return registerCloudAgentSetupHint({ id: providerManifest.kind, Hint: CursorCloudSetupHint });
}
