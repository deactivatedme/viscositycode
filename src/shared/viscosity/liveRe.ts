/**
 * ViscosityCode: contract with the `viscosity-live-re` helper (native/live-re),
 * a stdio MCP server that drives LLDB so agents can debug running programs.
 * Browser-safe: no Node imports (the binary lookup is in `liveReBinary.ts`).
 *
 * Versions (mirrored in native/live-re/src/version.rs; a test keeps them equal):
 * - `LIVE_RE_PROTOCOL_VERSION`: tool names, arguments and result shapes. The
 *   supervisor passes it in `LIVE_RE_PROTOCOL_ENV`; a helper speaking another
 *   one exits before MCP starts (fail closed). Staging checks it via `--hello`.
 * - `LIVE_RE_ENVIRONMENT_VERSION`: the `--environment` report. Any other
 *   version reads as "update needed", never as a half-understood report.
 *
 * The per-chat switch is the reserved key `mcpServerOverrides[LIVE_RE_MCP_OVERRIDE_ID]`
 * in the existing thread config record: no new field, older apps ignore and keep it.
 */
import { z } from "zod";

export const LIVE_RE_PROTOCOL_VERSION = 1;
export const LIVE_RE_ENVIRONMENT_VERSION = 1;
export const LIVE_RE_BINARY_NAME = "viscosity-live-re";
/** Provider-visible MCP server name. Not reserved: a configured server with this name wins. */
export const LIVE_RE_MCP_SERVER_NAME = "live_re";
/** The `.` cannot collide with randomUUID server ids. */
export const LIVE_RE_MCP_OVERRIDE_ID = "viscosity.live-re";
export const LIVE_RE_PROTOCOL_ENV = "VISCOSITY_LIVE_RE_PROTOCOL";

const reasonSchema = z.string().regex(/^[a-z0-9-]{1,48}$/u);
const switchStateSchema = z.enum(["enabled", "disabled", "unknown", "not-applicable"]);
const targetSchema = z.object({
  state: z.enum(["ready", "limited", "unavailable"]),
  /** Stable code (`ready`, `no-debugger`, `sip-enabled`, …); clients map it to localized text. */
  reason: reasonSchema,
});

export const liveReEnvironmentSchema = z.object({
  environmentVersion: z.literal(LIVE_RE_ENVIRONMENT_VERSION),
  helperVersion: z.string().min(1).max(64),
  protocolVersion: z.number().int(),
  host: z.object({ os: z.string().max(32), arch: z.string().max(32) }),
  tools: z
    .array(
      z.object({
        id: reasonSchema,
        status: z.enum(["found", "missing", "unknown"]),
        path: z.string().max(4096).optional(),
        version: z.string().max(512).optional(),
      }),
    )
    .max(32),
  sip: switchStateSchema,
  devToolsSecurity: switchStateSchema,
  targets: z.object({
    macosApps: targetSchema,
    iosSimulator: targetSchema,
    iosDevice: targetSchema,
    android: targetSchema,
    windows: targetSchema,
  }),
});
export type LiveReEnvironment = z.infer<typeof liveReEnvironmentSchema>;

export type LiveReEnvironmentRead =
  | { status: "ok"; environment: LiveReEnvironment }
  | { status: "update-needed" }
  | { status: "malformed" };

/**
 * Reads parsed `--environment` output. A report from another environment or
 * tool protocol version (a stale or newer helper) is "update-needed".
 */
export function readLiveReEnvironment(raw: unknown): LiveReEnvironmentRead {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "malformed" };
  const { environmentVersion, protocolVersion } = raw as Record<string, unknown>;
  if (typeof environmentVersion !== "number") return { status: "malformed" };
  if (
    environmentVersion !== LIVE_RE_ENVIRONMENT_VERSION ||
    (typeof protocolVersion === "number" && protocolVersion !== LIVE_RE_PROTOCOL_VERSION)
  ) {
    return { status: "update-needed" };
  }
  const parsed = liveReEnvironmentSchema.safeParse(raw);
  return parsed.success ? { status: "ok", environment: parsed.data } : { status: "malformed" };
}

export const LIVE_RE_PROBE_ERROR_CODES = [
  "timeout",
  "too-large",
  "failed",
  "malformed",
  "unavailable",
] as const;
export type LiveReProbeErrorCode = (typeof LIVE_RE_PROBE_ERROR_CODES)[number];

/**
 * Desktop setup-check reply (`window.viscosityHost.liveRe.checkEnvironment()`).
 * `missing`: no helper in this build. `update-needed`: the helper speaks
 * another environment or tool protocol version.
 */
export type LiveReEnvironmentReply =
  | { status: "ok"; environment: LiveReEnvironment }
  | { status: "missing" }
  | { status: "update-needed" }
  | { status: "error"; code: LiveReProbeErrorCode };

const PROBE_ERROR_CODES: ReadonlySet<string> = new Set(LIVE_RE_PROBE_ERROR_CODES);

/**
 * Reads a reply crossing the IPC or context-bridge boundary: a fresh reply
 * with only known fields, or null when it is not a well-formed reply.
 */
export function readLiveReEnvironmentReply(value: unknown): LiveReEnvironmentReply | null {
  if (!value || typeof value !== "object") return null;
  const { status, environment, code } = value as Record<string, unknown>;
  if (status === "missing" || status === "update-needed") return { status };
  if (status === "error") {
    return typeof code === "string" && PROBE_ERROR_CODES.has(code)
      ? { status, code: code as LiveReProbeErrorCode }
      : null;
  }
  if (status !== "ok") return null;
  const read = readLiveReEnvironment(environment);
  return read.status === "ok" ? { status: "ok", environment: read.environment } : null;
}
