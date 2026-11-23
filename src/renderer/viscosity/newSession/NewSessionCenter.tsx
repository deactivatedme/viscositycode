// ViscosityCode: project and device selection for the shell's New session draft.
import type { Project } from "@/shared/contracts";
import { ProjectSwitchMenu } from "@/renderer/components/thread/ProjectSwitchMenu";
import { useDraftDevices } from "./useDraftDevices";

export function NewSessionCenter(props: { project: Project }) {
  const devices = useDraftDevices();
  return (
    <ProjectSwitchMenu currentProjectId={props.project.id} variant="compact" devices={devices} />
  );
}
