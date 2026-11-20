/**
 * ViscosityCode: is this client the host's own Tauri desktop window?
 *
 * Presentation only. The host authorizes every call by the window's pairing
 * (operator). Never use this as authorization.
 */
import { isRemoteSession } from "@/renderer/bridge";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { remoteConnectionKey } from "@/renderer/state/remoteServers/types";

/** `window.viscosityShell`, injected by `desktop-tauri/src/shell_script.rs` (versioning.md). */
interface ViscosityShellGlobal {
  readonly kind?: unknown;
  readonly version?: unknown;
}

/** True when the browser client runs in the Tauri shell's main frame (shell global v1). */
export function isLocalDesktopWindow(): boolean {
  if (!isRemoteSession()) return false;
  const shell = (window as { viscosityShell?: ViscosityShellGlobal }).viscosityShell;
  // Absence or another version is a plain browser client.
  return shell?.kind === "tauri" && shell.version === 1;
}

/**
 * True when the Tauri window is also talking to the host it is served from.
 * The window can pair other hosts, so "this is the Tauri window" alone does not
 * mean the host runs on this machine. Same-origin rule as `selectBrowserBridgeServer`.
 */
export function isLocalDesktopHost(connectionKey: string | undefined): boolean {
  if (connectionKey === undefined || !isLocalDesktopWindow()) return false;
  const record = useRemoteServersStore
    .getState()
    .servers.find((server) => remoteConnectionKey(server) === connectionKey);
  return record !== undefined && servesThisPage(record.endpoint);
}

/** Whether a paired host's `endpoint` is the origin this page was loaded from. */
export function servesThisPage(endpoint: string): boolean {
  try {
    return new URL(endpoint).origin === window.location.origin;
  } catch {
    return false;
  }
}
