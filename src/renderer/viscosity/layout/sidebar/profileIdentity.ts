/**
 * ViscosityCode: the name the sidebar profile row shows. In order: the name
 * the viewer typed (`profileNameStore.ts`), the OS account name the desktop
 * shell put on the page, then, for a client that cannot know it (a plain
 * browser, a phone, an older shell), the local part of the first signed-in
 * account in the model picker's provider order. Provider-agnostic.
 */
import type { UsageSnapshot } from "@/shared/contracts";

export const PROFILE_NAME_MAX_LENGTH = 80;

/** Trimmed and capped; null when the value is not a name. */
export function cleanProfileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, PROFILE_NAME_MAX_LENGTH).trim() || null;
}

/**
 * `window.viscosityHost.system.userName`: the OS account's display name, set
 * by the Tauri shell (`desktop-tauri/src/shell_script.rs`) and the Electron
 * preload. Null when the shell did not provide one.
 */
export function readOsUserName(): string | null {
  const host = (globalThis as { viscosityHost?: { system?: { userName?: unknown } } })
    .viscosityHost;
  return cleanProfileName(host?.system?.userName);
}

/** The name to show, or null for the generic "Account". */
export function pickProfileName(input: {
  customName: string | null;
  osUserName: string | null;
  snapshots: Readonly<Record<string, UsageSnapshot>>;
  rank: (providerId: string) => number;
}): string | null {
  if (input.customName) return input.customName;
  if (input.osUserName) return input.osUserName;
  const accountNames = Object.values(input.snapshots)
    .filter((snapshot) => snapshot.status === "ok")
    .toSorted((left, right) => input.rank(left.providerId) - input.rank(right.providerId))
    .map((snapshot) => snapshot.authenticatedAs?.split("@")[0]?.trim());
  return accountNames.find(Boolean) ?? null;
}

/** Uppercase first character of the shown name, for the avatar circle. */
export function profileInitial(name: string): string {
  return (Array.from(name.trim())[0] ?? "?").toUpperCase();
}
