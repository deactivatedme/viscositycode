import { describe, expect, it } from "vitest";
import type { MachineDescriptor } from "@/renderer/state/machines";
import type { Project } from "@/shared/contracts";
import { findProjectForMachine } from "./acpRegistryAuth";

// A remote client's local entry: the bridge host it talks to (deriveMachines `localHost`).
const hostLocal: MachineDescriptor = {
  id: "local",
  ref: { host: "local", env: { kind: "native" } },
  kind: "local",
  label: "Studio",
  status: "online",
  desktopId: "conn-1",
};

const electronLocal: MachineDescriptor = {
  id: "local",
  ref: { host: "local", env: { kind: "native" } },
  kind: "local",
  label: "This Mac",
  status: "online",
};

describe("findProjectForMachine", () => {
  it("pins a home location to a remote client's own host when it has no projects", () => {
    expect(findProjectForMachine(hostLocal, [], false)).toMatchObject({
      remoteServerId: "conn-1",
      location: { kind: "posix", path: "~", remoteServerId: "conn-1" },
    });
    expect(findProjectForMachine({ ...hostLocal, platform: "win32" }, [], false)).toMatchObject({
      remoteServerId: "conn-1",
      location: { kind: "windows", path: ".", remoteServerId: "conn-1" },
    });
  });

  it("returns a projected project of that host", () => {
    const projected: Project = {
      id: "remote:conn-1:project:p1",
      name: "repo",
      disabled: false,
      createdAt: new Date(0).toISOString(),
      remoteServerId: "conn-1",
      location: { kind: "posix", path: "/repo", remoteServerId: "conn-1" },
    };
    expect(findProjectForMachine(hostLocal, [projected], false)).toBe(projected);
  });

  it("keeps Electron's local machine without projects unresolved", () => {
    expect(findProjectForMachine(electronLocal, [], false)).toBeUndefined();
  });

  it("synthesizes the host's WSL home for a remote client's local WSL entry", () => {
    const wsl: MachineDescriptor = {
      ...hostLocal,
      id: "local/wsl:Ubuntu",
      ref: { host: "local", env: { kind: "wsl", distro: "Ubuntu" } },
      kind: "local-wsl",
      wslDistro: "Ubuntu",
    };
    expect(findProjectForMachine(wsl, [], true)).toMatchObject({
      remoteServerId: "conn-1",
      location: { kind: "wsl", distro: "Ubuntu", linuxPath: "~", remoteServerId: "conn-1" },
    });
  });
});
