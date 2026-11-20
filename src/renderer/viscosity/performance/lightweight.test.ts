import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePerformanceSettings } from "./performanceSettingsStore";
import {
  isLightweightActive,
  isLowMemoryDevice,
  isLowPowerDevice,
  resetLowMemoryCacheForTests,
  resolveLightweight,
} from "./lightweight";

const GiB = 1024 ** 3;

function setHostMemory(bytes: number | null | undefined): void {
  const host = bytes === undefined ? undefined : { system: { totalMemoryBytes: bytes } };
  (globalThis as { viscosityHost?: unknown }).viscosityHost = host;
}

describe("lightweight mode", () => {
  beforeEach(() => {
    localStorage.clear();
    usePerformanceSettings.getState().setLightweight("auto");
    resetLowMemoryCacheForTests();
  });

  afterEach(() => {
    delete (globalThis as { viscosityHost?: unknown }).viscosityHost;
    vi.unstubAllGlobals();
    resetLowMemoryCacheForTests();
  });

  it.each([
    ["8 GiB from the desktop host", () => setHostMemory(8 * GiB), true],
    ["16 GiB from the desktop host", () => setHostMemory(16 * GiB), false],
    ["unknown memory", () => setHostMemory(null), false],
    ["a 4 GiB browser", () => vi.stubGlobal("navigator", { deviceMemory: 4 }), true],
    ["an 8+ GiB browser", () => vi.stubGlobal("navigator", { deviceMemory: 8 }), false],
  ])("detects %s", (_label, arrange, low) => {
    arrange();
    expect(isLowMemoryDevice()).toBe(low);
  });

  it("counts software graphics or Remote Desktop as low-power on a 16 GiB machine", () => {
    (globalThis as { viscosityHost?: unknown }).viscosityHost = {
      system: { totalMemoryBytes: 16 * GiB, lowPowerGraphics: true },
    };
    expect(isLowMemoryDevice()).toBe(false);
    expect(isLowPowerDevice()).toBe(true);
    expect(isLightweightActive()).toBe(true);
  });

  it("keeps Auto off on a 16 GiB machine with a working GPU", () => {
    (globalThis as { viscosityHost?: unknown }).viscosityHost = {
      system: { totalMemoryBytes: 16 * GiB, lowPowerGraphics: false },
    };
    expect(isLightweightActive()).toBe(false);
  });

  describe("cold-launch WebGL probe", () => {
    function setHost(probeWebGl: boolean): void {
      (globalThis as { viscosityHost?: unknown }).viscosityHost = {
        system: { totalMemoryBytes: 16 * GiB, lowPowerGraphics: false, probeWebGl },
      };
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("turns Auto on when Windows refuses a hardware WebGL2 context the GPU status missed", () => {
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      setHost(true);
      expect(isLightweightActive()).toBe(true);
      expect(isLowPowerDevice()).toBe(true);
      // Probed once per session.
      expect(getContext).toHaveBeenCalledExactlyOnceWith("webgl2", {
        failIfMajorPerformanceCaveat: true,
      });
    });

    it("keeps Auto off on a working GPU and releases the probe context", () => {
      const loseContext = vi.fn<() => void>();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        getExtension: () => ({ loseContext }),
      } as unknown as WebGL2RenderingContext);
      setHost(true);
      expect(isLightweightActive()).toBe(false);
      expect(loseContext).toHaveBeenCalledOnce();
    });

    it("never probes on macOS, whose Auto stays memory-only", () => {
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      setHost(false);
      expect(isLightweightActive()).toBe(false);
      expect(getContext).not.toHaveBeenCalled();
    });
  });

  it("resolves each mode against the memory size", () => {
    expect(resolveLightweight("auto", true)).toBe(true);
    expect(resolveLightweight("auto", false)).toBe(false);
    expect(resolveLightweight("on", false)).toBe(true);
    expect(resolveLightweight("off", true)).toBe(false);
  });

  it("follows the stored mode", () => {
    setHostMemory(8 * GiB);
    expect(isLightweightActive()).toBe(true);
    usePerformanceSettings.getState().setLightweight("off");
    expect(isLightweightActive()).toBe(false);
  });
});
