// ViscosityCode: fork-only. Centre of the shell's New session draft: the folder
// picker with its device menu, plus Add folder and Start from scratch. No logo.
import { FilePlus, Plus } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import type { Project } from "@/shared/contracts";
import { hasClientCapability } from "@/renderer/clientRuntime";
import { Button } from "@/renderer/components/common/Button";
import { ProjectSwitchMenu } from "@/renderer/components/thread/ProjectSwitchMenu";
import { usePanelStore } from "@/renderer/state/panelStore";
import { CreateProjectMenu } from "@/renderer/views/MainView/parts/CreateProject/CreateProjectMenu";
import {
  MACHINE_RUNTIME_PREFIX,
  useProjectMachines,
} from "@/renderer/views/MainView/parts/CreateProject/projectMachines";
import { useDraftDevices } from "./useDraftDevices";

export function NewSessionCenter(props: { project: Project }) {
  const { project } = props;
  const devices = useDraftDevices();
  const machines = useProjectMachines();
  // The draft's device is where Start from scratch creates the folder.
  const machineKey = project.remoteServerId ?? project.location.remoteServerId;
  const runtimeKey = machineKey
    ? `${MACHINE_RUNTIME_PREFIX}${machineKey}`
    : project.location.kind === "wsl"
      ? project.location.distro
      : "native";
  // Same rule as the add menu: this computer needs the local backend, and a
  // paired machine must be reachable and let this client manage projects.
  const canCreate = machineKey
    ? machines.some((machine) => machine.connectionKey === machineKey)
    : hasClientCapability("localBackend");

  return (
    <div className="vc-new-session-center flex flex-col items-center gap-1">
      <ProjectSwitchMenu currentProjectId={project.id} variant="compact" devices={devices} />
      <div className="flex items-center gap-1">
        <CreateProjectMenu>
          <Button size="sm" variant="ghost">
            <Plus aria-hidden="true" className="size-3.5" />
            <Trans>Add folder</Trans>
          </Button>
        </CreateProjectMenu>
        {canCreate ? (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => usePanelStore.getState().openCreateProjectModal(runtimeKey)}
          >
            <FilePlus aria-hidden="true" className="size-3.5" />
            <Trans>Start from scratch</Trans>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
