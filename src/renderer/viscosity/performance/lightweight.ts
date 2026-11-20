/**
 * ViscosityCode: Lightweight mode, for machines with little memory or no
 * usable GPU (software compositing, Remote Desktop).
 *
 * While active the window loses its glass, running indicators hold still,
 * background chats are cached more lightly, and the Roundtable live preview
 * refreshes less often.
 */
import { usePerformanceSettings, type LightweightMode } from "./performanceSettingsStore";

/** Auto turns the mode on at or below this much memory (8 GiB plus slack). */
export const LOW_MEMORY_MAX_BYTES = 8.5 * 1024 ** 3;

/** Total memory from the desktop preload, else a browser's `navigator.deviceMemory`, else null. */
export function detectTotalMemoryBytes(): number | null {
  const host = (globalThis as { viscosityHost?: { system?: { totalMemoryBytes?: unknown } } })
    .viscosityHost;
  const fromHost = host?.system?.totalMemoryBytes;
  if (typeof fromHost === "number" && Number.isFinite(fromHost) && fromHost > 0) return fromHost;
  // Browsers cap this at 8 (GiB), so 8 only means "at least 8": count smaller values only.
  const deviceMemory =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
  if (typeof deviceMemory === "number" && deviceMemory > 0 && deviceMemory < 8) {
    return deviceMemory * 1024 ** 3;
  }
  return null;
}

let cachedTotalMemory: number | null | undefined;

/** Whether this device counts as low-memory (unknown memory does not). Cached per session. */
export function isLowMemoryDevice(): boolean {
  if (cachedTotalMemory === undefined) cachedTotalMemory = detectTotalMemoryBytes();
  return cachedTotalMemory !== null && cachedTotalMemory <= LOW_MEMORY_MAX_BYTES;
}

let cachedWebGlUnusable: boolean | undefined;

/**
 * Whether a hardware WebGL2 context is refused (software GL, blocklisted driver,
 * failed GPU init). Unlike main's GPU status at window creation, `getContext`
 * waits for the GPU process's verdict, so a cold launch sees it too.
 */
function probeWebGlUnusable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const gl = document
      .createElement("canvas")
      .getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!gl) return true;
    // Hand the context back at once so xterm keeps its budget.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return false;
  } catch {
    return false;
  }
}

/** Software graphics or a Remote Desktop session (desktop preload only). */
export function hasLowPowerGraphics(): boolean {
  const system = (
    globalThis as {
      viscosityHost?: { system?: { lowPowerGraphics?: unknown; probeWebGl?: unknown } };
    }
  ).viscosityHost?.system;
  if (system?.lowPowerGraphics === true) return true;
  // macOS sets no probe: its Auto stays memory-only.
  if (system?.probeWebGl !== true) return false;
  cachedWebGlUnusable ??= probeWebGlUnusable();
  return cachedWebGlUnusable;
}

/** Auto's input: low memory, or graphics that would redraw panel blur on the CPU. */
export function isLowPowerDevice(): boolean {
  return isLowMemoryDevice() || hasLowPowerGraphics();
}

/** Test hook: forget the cached memory size and WebGL probe. */
export function resetLowMemoryCacheForTests(): void {
  cachedTotalMemory = undefined;
  cachedWebGlUnusable = undefined;
}

export function resolveLightweight(mode: LightweightMode, lowMemory: boolean): boolean {
  return mode === "on" || (mode === "auto" && lowMemory);
}

/** Non-React read, for code that runs outside components. */
export function isLightweightActive(): boolean {
  return resolveLightweight(usePerformanceSettings.getState().lightweight, isLowPowerDevice());
}

export function useLightweightActive(): boolean {
  const mode = usePerformanceSettings((state) => state.lightweight);
  return resolveLightweight(mode, isLowPowerDevice());
}
