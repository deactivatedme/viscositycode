// ViscosityCode: fork-only. Centre of the shell's New session draft: the folder
// picker (with its environment menu) and an Add folder action. No logo.
import { Plus } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import type { Project } from "@/shared/contracts";
import { Button } from "@/renderer/components/common/Button";
import { ProjectSwitchMenu } from "@/renderer/components/thread/ProjectSwitchMenu";
import { CreateProjectMenu } from "@/renderer/views/MainView/parts/CreateProject/CreateProjectMenu";

export function NewSessionCenter(props: { project: Project }) {
  return (
    <div className="vc-new-session-center flex flex-col items-center gap-1">
      <ProjectSwitchMenu currentProjectId={props.project.id} variant="compact" />
      <CreateProjectMenu>
        <Button size="sm" variant="ghost">
          <Plus aria-hidden="true" className="size-3.5" />
          <Trans>Add folder</Trans>
        </Button>
      </CreateProjectMenu>
    </div>
  );
}
