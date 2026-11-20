/**
 * ViscosityCode: the `window.viscosityHost.system` bridge built in the
 * preload. Read once at startup, so no IPC channel is needed: Electron's
 * `process.getSystemMemoryInfo()` works in the sandboxed preload, and main's
 * graphics verdict arrives as a renderer argument.
 */

/** Preload namespace shape (`window.viscosityHost.system`). */
export interface ViscositySystemInfoBridge {
  /** Total physical memory in bytes, or null when it cannot be read. */
  totalMemoryBytes: number | null;
  /** Main saw software compositing or a Remote Desktop session (Lightweight Auto). */
  lowPowerGraphics: boolean;
  /** Renderer should confirm the GPU with a one-time WebGL probe (Windows/Linux, not macOS). */
  probeWebGl: boolean;
}

export interface SystemMemoryProcess {
  /** Electron's API; `total` is in kilobytes. */
  getSystemMemoryInfo?: () => { total: number };
  argv?: readonly string[];
  platform?: NodeJS.Platform;
}

/** Renderer argument main adds when graphics are low-power. */
export const LOW_POWER_GRAPHICS_ARGUMENT = "--vc-low-power-graphics";

/**
 * Main-side verdict, from values Electron already has (no probe): Chromium's GPU
 * feature status (software compositing covers VMs, blocklisted drivers and
 * `--disable-gpu`) and a Windows Remote Desktop session name. macOS keeps its
 * memory-only Auto. The status is only settled after `gpu-info-update`, so on a
 * cold launch it can still read "enabled": the renderer's WebGL probe
 * (`probeWebGl`) covers that race.
 */
export function lowPowerGraphicsArguments(input: {
  readGpuFeatureStatus: () => { gpu_compositing?: string };
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}): string[] {
  if (input.platform === "darwin") return [];
  const remoteDesktop = input.platform === "win32" && /^rdp-/i.test(input.env.SESSIONNAME ?? "");
  let softwareCompositing = false;
  try {
    const compositing = input.readGpuFeatureStatus().gpu_compositing;
    softwareCompositing = typeof compositing === "string" && !compositing.startsWith("enabled");
  } catch {
    // Unknown status counts as capable, as unknown memory does.
  }
  return remoteDesktop || softwareCompositing ? [LOW_POWER_GRAPHICS_ARGUMENT] : [];
}

export function createViscositySystemPreloadBridge(
  proc: SystemMemoryProcess,
): ViscositySystemInfoBridge {
  const lowPowerGraphics = proc.argv?.includes(LOW_POWER_GRAPHICS_ARGUMENT) ?? false;
  const probeWebGl = proc.platform !== undefined && proc.platform !== "darwin";
  try {
    const total = proc.getSystemMemoryInfo?.().total;
    return {
      totalMemoryBytes:
        typeof total === "number" && Number.isFinite(total) && total > 0 ? total * 1024 : null,
      lowPowerGraphics,
      probeWebGl,
    };
  } catch {
    return { totalMemoryBytes: null, lowPowerGraphics, probeWebGl };
  }
}
