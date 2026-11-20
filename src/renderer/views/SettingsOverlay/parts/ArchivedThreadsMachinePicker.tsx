// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { useLingui } from "@lingui/react/macro";
import { Monitor } from "lucide-react";
import { desktopTitle } from "@/shared/remote/desktopLabel";
import { isRemoteSession } from "@/renderer/bridge";
import { Select } from "@/renderer/components/common";
import { ProjectRemoteServerIcon } from "@/renderer/components/common/ProjectRemoteServer";
import { remoteConnectionKey } from "@/renderer/state/remoteServers/types";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { useSettingsHostServer } from "@/renderer/state/settingsHostStore";

export const LOCAL_ARCHIVE_MACHINE_ID = "local";

export interface ArchivedThreadsScopeProps {
  machineId: string;
  onMachineChange: (machineId: string) => void;
}

export function useArchivedThreadsMachine(machineId: string) {
  const { t } = useLingui();
  const servers = useRemoteServersStore((state) => state.servers);
  const runtime = useRemoteServersStore((state) => state.runtime);
  const settingsHost = useSettingsHostServer();
  // ViscosityCode: a remote client's own archive is its bridge host's, projected under that key.
  const localServerId =
    isRemoteSession() && settingsHost ? remoteConnectionKey(settingsHost) : undefined;
  const options = [
    {
      id: LOCAL_ARCHIVE_MACHINE_ID,
      label: localServerId && settingsHost ? desktopTitle(settingsHost.label) : t`This machine`, // ViscosityCode
      icon: <Monitor className="size-4" />,
    },
    ...servers
      .filter((server) => remoteConnectionKey(server) !== localServerId) // ViscosityCode
      .map((server) => ({
        id: remoteConnectionKey(server),
        label: desktopTitle(server.label),
        icon: (
          <ProjectRemoteServerIcon
            info={{
              isRemote: true,
              serverName: desktopTitle(server.label),
              status: runtime[remoteConnectionKey(server)]?.status,
            }}
            className="size-3.5 text-muted"
            dotClassName="size-1"
          />
        ),
      })),
  ];
  const selectedMachine = options.find((option) => option.id === machineId) ?? options[0]!;
  /** The `Thread.remoteServerId` of the selected archive; `undefined` is this device's own. */
  const selectedServerId =
    selectedMachine.id === LOCAL_ARCHIVE_MACHINE_ID ? localServerId : selectedMachine.id; // ViscosityCode
  const unavailable =
    selectedServerId !== undefined &&
    runtime[selectedServerId]?.status !== "online" &&
    runtime[selectedServerId]?.status !== "error";
  return { options, selectedMachine, selectedServerId, unavailable };
}

export function ArchivedThreadsMachinePicker(props: ArchivedThreadsScopeProps) {
  const { t } = useLingui();
  const { options, selectedMachine } = useArchivedThreadsMachine(props.machineId);
  if (options.length <= 1) return null;
  return (
    <Select
      aria-label={`${t`Machine`}: ${selectedMachine.label}`}
      className="w-[220px] shrink-0"
      options={options}
      value={selectedMachine.id}
      onChange={props.onMachineChange}
    />
  );
}
