// ViscosityCode: fork-only. The devices a New session draft can be opened on.
import type { Project } from "@/shared/contracts";
import {
  type ProjectEnvironmentMachine,
  useProjectEnvironmentMachineLookup,
} from "@/renderer/components/common/ProjectEnvironment";
import { useProjectSwitchProjects } from "@/renderer/components/thread/projectSwitchGroups";
import { projectEnvironmentKey } from "@/renderer/state/projectGroups/projectGroups";
import { pickGroupMember } from "@/renderer/state/projectGroups/useProjectGroups";

/**
 * One entry per device (this computer, its WSL distros, each reachable paired
 * machine) that holds a project the project switcher offers. A draft sent to a
 * device opens on the project used there most recently, else the first one
 * (Home while its scope is on). A device with no project is not listed: a
 * draft needs a project row to open on.
 */
export function useDraftDevices(): readonly ProjectEnvironmentMachine[] {
  const projects = useProjectSwitchProjects();
  const machineFor = useProjectEnvironmentMachineLookup();
  const byDevice = new Map<string, Project[]>();
  for (const project of projects) {
    const key = projectEnvironmentKey(project);
    byDevice.set(key, [...(byDevice.get(key) ?? []), project]);
  }
  return [...byDevice.values()].flatMap((rows) => {
    const entry = machineFor(pickGroupMember(rows, () => true)!);
    return entry ? [entry] : [];
  });
}
