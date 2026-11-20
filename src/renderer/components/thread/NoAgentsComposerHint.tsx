// ViscosityCode: fork-only. Replaces upstream's full-screen "Detecting agents" /
// "No supported agents detected" draft states with one row where the composer goes.
import { Trans } from "@lingui/react/macro";
import { Settings2 } from "lucide-react";
import { Button } from "@/renderer/components/common/Button";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { usePanelStore } from "@/renderer/state/panelStore";

export function NoAgentsComposerHint(props: { detecting: boolean }) {
  return (
    <div
      role="status"
      data-vc-no-agents-hint=""
      className="mx-auto mt-auto flex w-full max-w-[720px] items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted"
    >
      {props.detecting ? (
        <>
          <PixelLoader size="xs" />
          <Trans>Looking for installed agents…</Trans>
        </>
      ) : (
        <>
          <span className="flex-1">
            <Trans>No agents found yet.</Trans>
          </span>
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => usePanelStore.getState().openSettingsSection("agentsGeneral")}
          >
            <Settings2 aria-hidden="true" className="size-3.5" />
            <Trans>Set up in Settings → Agents</Trans>
          </Button>
        </>
      )}
    </div>
  );
}
