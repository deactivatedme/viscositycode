/**
 * ViscosityCode: the fork-owned live_re setup-check channel
 * (`window.viscosityHost.liveRe`). Desktop only: it runs the staged
 * `viscosity-live-re --environment` (read-only probes) on this computer.
 * Remote, browser and PWA clients have no bridge. Main and preload ship in
 * one bundle, so the channel itself is unversioned; the report inside is
 * versioned by `LIVE_RE_ENVIRONMENT_VERSION`.
 */
import type { LiveReEnvironmentReply } from "@/shared/viscosity/liveRe";

export const LIVE_RE_IPC = { environment: "viscosity:live-re:environment" } as const;

/** One probe may take at most this long. */
export const LIVE_RE_PROBE_TIMEOUT_MS = 10_000;
/** Largest accepted `--environment` output, in bytes. */
export const LIVE_RE_PROBE_MAX_BYTES = 64 * 1024;

/** Preload namespace shape (`window.viscosityHost.liveRe`). */
export interface ViscosityLiveReBridge {
  readonly available: true;
  checkEnvironment(): Promise<LiveReEnvironmentReply>;
}
