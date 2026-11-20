/**
 * ViscosityCode: where the in-chat Roundtable entry points apply.
 *
 * Roundtable chrome (composer toggle, `/roundtable`, model mentions,
 * palette commands, the invite dialog) is desktop-shell only
 * (ARCHITECTURE_NOTES §8.9). The phone/PWA compact layout, the chat sidebar
 * surface and secondary windows keep upstream's composer untouched. These
 * helpers only READ the shell state; `useViscosityShellFlag` (which installs
 * `html[data-vc-shell]`) stays owned by the AppShell and status bar frame.
 */
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import { isViscosityShellActive } from "@/renderer/viscosity/shellFlag";

/** Non-React readers (submit pipelines, palette commands). */
export function isRoundtableChatAvailable(): boolean {
  return isViscosityShellActive();
}

/** React readers: the shell rule, without acquiring the shell attribute. */
export function useRoundtableChatAvailable(): boolean {
  return useViscosityShellEnabled();
}
