// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { useState } from "react";
import { Button, toast } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { PixelLoader } from "@/renderer/components/common";
import { agentManagementHostForMachine } from "@/renderer/components/providers/settings/agentManagementHost";
import { useSelectedMachine } from "@/renderer/state/machines";
import { ModelOrderSection } from "./ModelOrderSection";
import { ModelVisibilitySection } from "./ModelVisibilitySection";
import { SettingsPage } from "./SettingsForm";
// ViscosityCode: Smart start's preferred-provider lists (desktop layout only).
import { SmartStartSettings } from "@/renderer/viscosity/settings/SmartStartSettings";

export function AgentsGeneralSettings() {
  const { t } = useLingui();
  const machine = useSelectedMachine();
  const host = agentManagementHostForMachine(machine);
  const [refreshingMachines, setRefreshingMachines] = useState<string[]>([]);
  const isRefreshing = refreshingMachines.includes(machine.id);
  const refreshAgents = async () => {
    if (isRefreshing || machine.status !== "online") return;
    setRefreshingMachines((current) => [...current, machine.id]);
    try {
      const wslDistros = machine.ref.env.kind === "wsl" ? [machine.ref.env.distro] : [];
      // ViscosityCode: the supervisor's bulk events update the local store.
      await host.rediscoverAgents(wslDistros);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t`Unable to refresh ${machine.label}.`);
    } finally {
      setRefreshingMachines((current) => current.filter((id) => id !== machine.id));
    }
  };
  return (
    <SettingsPage
      title={t`Agents · General`}
      actions={
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t`Refresh detected agents`}
          isPending={isRefreshing}
          isDisabled={isRefreshing || machine.status !== "online"}
          onPress={() => void refreshAgents()}
        >
          {isRefreshing ? <PixelLoader size="xs" /> : <RefreshCw className="size-4" />}
        </Button>
      }
    >
      <ModelVisibilitySection />
      <ModelOrderSection />
      {/* ViscosityCode: Smart start group (desktop layout only). */}
      <SmartStartSettings />
    </SettingsPage>
  );
}
