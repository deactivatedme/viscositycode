import { describe, expect, it } from "vitest";
import {
  LOW_POWER_GRAPHICS_ARGUMENT,
  USER_NAME_ARGUMENT_PREFIX,
  createViscositySystemPreloadBridge,
  lowPowerGraphicsArguments,
  userNameArguments,
} from "./systemInfoPreloadBridge";

describe("createViscositySystemPreloadBridge", () => {
  it("reports total memory in bytes", () => {
    const bridge = createViscositySystemPreloadBridge({
      getSystemMemoryInfo: () => ({ total: 8 * 1024 * 1024 }),
    });
    expect(bridge.totalMemoryBytes).toBe(8 * 1024 ** 3);
  });

  it("reports null when the API is missing, throws or returns nonsense", () => {
    expect(createViscositySystemPreloadBridge({}).totalMemoryBytes).toBeNull();
    expect(
      createViscositySystemPreloadBridge({
        getSystemMemoryInfo: () => {
          throw new Error("unavailable");
        },
      }).totalMemoryBytes,
    ).toBeNull();
    expect(
      createViscositySystemPreloadBridge({ getSystemMemoryInfo: () => ({ total: Number.NaN }) })
        .totalMemoryBytes,
    ).toBeNull();
  });

  it("asks the renderer for a WebGL probe on Windows and Linux, not macOS", () => {
    expect(createViscositySystemPreloadBridge({ platform: "win32" }).probeWebGl).toBe(true);
    expect(createViscositySystemPreloadBridge({ platform: "linux" }).probeWebGl).toBe(true);
    expect(createViscositySystemPreloadBridge({ platform: "darwin" }).probeWebGl).toBe(false);
    expect(createViscositySystemPreloadBridge({}).probeWebGl).toBe(false);
  });

  it("reports low-power graphics only when main passed the argument", () => {
    expect(createViscositySystemPreloadBridge({ argv: [] }).lowPowerGraphics).toBe(false);
    expect(createViscositySystemPreloadBridge({}).lowPowerGraphics).toBe(false);
    expect(
      createViscositySystemPreloadBridge({ argv: ["--lc-is-dev=0", LOW_POWER_GRAPHICS_ARGUMENT] })
        .lowPowerGraphics,
    ).toBe(true);
  });

  it("reads the OS account name main passed, and leaves it out otherwise", () => {
    const argv = ["--lc-is-dev=0", ...userNameArguments("Sam O'Neil / Ünï")];
    expect(argv[1]).toBe("--vc-user-name=Sam%20O'Neil%20%2F%20%C3%9Cn%C3%AF");
    expect(createViscositySystemPreloadBridge({ argv }).userName).toBe("Sam O'Neil / Ünï");
    // A main that knows no name, a pre-upgrade main, and a malformed argument all omit the field.
    expect(userNameArguments(null)).toEqual([]);
    for (const older of [undefined, [], [USER_NAME_ARGUMENT_PREFIX], ["--vc-user-name=%E0%A4%A"]]) {
      expect(createViscositySystemPreloadBridge(older ? { argv: older } : {})).not.toHaveProperty(
        "userName",
      );
    }
  });
});

describe("lowPowerGraphicsArguments", () => {
  const status = (gpu_compositing: string) => () => ({ gpu_compositing });

  it("flags software compositing (VM, blocklisted driver, --disable-gpu) off macOS", () => {
    for (const compositing of ["disabled_software", "unavailable_software", "disabled_off"]) {
      expect(
        lowPowerGraphicsArguments({
          readGpuFeatureStatus: status(compositing),
          platform: "win32",
          env: {},
        }),
      ).toEqual([LOW_POWER_GRAPHICS_ARGUMENT]);
    }
  });

  it("keeps macOS memory-only, even with software compositing", () => {
    expect(
      lowPowerGraphicsArguments({
        readGpuFeatureStatus: status("disabled_software"),
        platform: "darwin",
        env: {},
      }),
    ).toEqual([]);
  });

  it("leaves a GPU-composited Mac or PC alone", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(
        lowPowerGraphicsArguments({ readGpuFeatureStatus: status("enabled"), platform, env: {} }),
      ).toEqual([]);
    }
  });

  it("flags a Windows Remote Desktop session, not a console one", () => {
    const input = { readGpuFeatureStatus: status("enabled"), platform: "win32" as const };
    expect(lowPowerGraphicsArguments({ ...input, env: { SESSIONNAME: "RDP-Tcp#3" } })).toEqual([
      LOW_POWER_GRAPHICS_ARGUMENT,
    ]);
    expect(lowPowerGraphicsArguments({ ...input, env: { SESSIONNAME: "Console" } })).toEqual([]);
    expect(
      lowPowerGraphicsArguments({ ...input, platform: "darwin", env: { SESSIONNAME: "RDP-Tcp" } }),
    ).toEqual([]);
  });

  it("treats an unreadable status as capable", () => {
    expect(
      lowPowerGraphicsArguments({
        readGpuFeatureStatus: () => {
          throw new Error("not ready");
        },
        platform: "win32",
        env: {},
      }),
    ).toEqual([]);
  });
});
