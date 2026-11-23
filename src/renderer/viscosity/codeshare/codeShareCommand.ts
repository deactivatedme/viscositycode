import { msg } from "@lingui/core/macro";
import { create } from "zustand";
import { registerViscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { VISCOSITY_COMMAND_GROUP } from "@/renderer/viscosity/commands/commandSupport";

export const useCodeSharePanel = create<{ open: boolean }>(() => ({ open: false }));
export const JOIN_CODE_SHARE_COMMAND = "viscosity.codeShare.join";

registerViscosityCommands("viscosity.codeShare", () => [
  {
    id: JOIN_CODE_SHARE_COMMAND,
    title: msg({ id: "codeShare.join", message: "Join CodeShare" }),
    group: VISCOSITY_COMMAND_GROUP,
    keywords: ["codeshare", "join", "invite", "shared models"],
    run: () => useCodeSharePanel.setState({ open: true }),
  },
]);
