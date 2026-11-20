/**
 * ViscosityCode: renderer access to the live_re setup check
 * (`window.viscosityHost.liveRe`). Only the desktop app on its own host has
 * it: browser, PWA and remote-attached windows get `undefined`, because the
 * probe would describe this computer, not the one running the agents.
 */
import { useEffect, useState } from "react";
import { isStandaloneAttachRuntime } from "@/renderer/clientRuntime";
import { hostRunsOnThisMachine } from "@/renderer/state/hostLocality";
import type { ProjectLocation } from "@/shared/contracts";
import { readLiveReEnvironmentReply, type LiveReEnvironmentReply } from "@/shared/viscosity/liveRe";

interface LiveReBridgeLike {
  available?: unknown;
  checkEnvironment?: unknown;
}

export type CheckLiveReEnvironment = () => Promise<LiveReEnvironmentReply>;

/** The setup check for this window, or undefined when it cannot run here. */
export function getLiveReEnvironmentCheck(): CheckLiveReEnvironment | undefined {
  if (typeof window === "undefined" || isStandaloneAttachRuntime()) return undefined;
  const host = (window as { viscosityHost?: { liveRe?: LiveReBridgeLike } }).viscosityHost;
  const bridge = host?.liveRe;
  if (bridge?.available !== true || typeof bridge.checkEnvironment !== "function") return undefined;
  if (cached?.bridge === bridge) return cached.check;
  const raw = bridge.checkEnvironment as () => Promise<unknown>;
  const check: CheckLiveReEnvironment = async () => {
    try {
      return readLiveReEnvironmentReply(await raw.call(bridge)) ?? malformed;
    } catch {
      // A preload without the main handler (an older main bundle) rejects.
      return { status: "error", code: "unavailable" };
    }
  };
  // Stable per bridge, so React effects keyed on it run once.
  cached = { bridge, check };
  return check;
}

let cached: { bridge: LiveReBridgeLike; check: CheckLiveReEnvironment } | undefined;

const malformed: LiveReEnvironmentReply = { status: "error", code: "malformed" };

let helperProbe: { check: CheckLiveReEnvironment; ready: Promise<boolean> } | undefined;

/** One probe per window: the staged helper does not change while the app runs. */
function probeHelper(check: CheckLiveReEnvironment): Promise<boolean> {
  if (helperProbe?.check !== check) {
    // "missing": not staged, so the host drops live_re; "update-needed": it exits before MCP starts.
    const ready = check().then(
      (reply) => reply.status !== "missing" && reply.status !== "update-needed",
    );
    helperProbe = { check, ready };
  }
  return helperProbe.ready;
}

export interface LiveReAvailability {
  /** What to show and apply now; true until the probe says otherwise. */
  available: boolean;
  /** False while the helper probe that decides `available` has not answered. */
  known: boolean;
  /** Runs (or reuses) the probe and returns the settled availability. */
  resolve: () => Promise<boolean>;
}

/**
 * False when the host will not attach live_re for this project: a WSL project
 * (the supervisor skips it there) or a desktop build without a usable helper.
 * Where the setup check cannot describe the host (browser, PWA, remote attach,
 * a remote server's project) the host decides, so this says true.
 *
 * The probe spawns xcrun, csrutil, adb and more, so it runs only once `probe`
 * turns true (the picker is open) or a caller asks through `resolve`.
 */
export function useLiveReAvailable(
  location: ProjectLocation | undefined,
  probe: boolean,
): LiveReAvailability {
  const wsl = location?.kind === "wsl";
  // A paired host's project runs on another machine; this probe would describe the wrong one.
  const check = wsl || !hostRunsOnThisMachine(location) ? undefined : getLiveReEnvironmentCheck();
  const [answer, setAnswer] = useState<{ check: CheckLiveReEnvironment; ready: boolean }>();
  const settled = check && answer?.check === check ? answer.ready : undefined;
  useEffect(() => {
    if (!check || !probe) return;
    let active = true;
    void probeHelper(check).then((ready) => {
      if (active) setAnswer({ check, ready });
    });
    return () => {
      active = false;
    };
  }, [check, probe]);
  return {
    available: !wsl && settled !== false,
    known: !check || settled !== undefined,
    resolve: async () => {
      if (wsl) return false;
      if (!check) return true;
      const ready = await probeHelper(check);
      setAnswer({ check, ready });
      return ready;
    },
  };
}
