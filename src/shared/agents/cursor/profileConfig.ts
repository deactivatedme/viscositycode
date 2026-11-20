import { z } from "zod";

/**
 * ViscosityCode: Cursor profile configuration, format 1 (pure schema, no Node
 * APIs, so the renderer can reuse it).
 *
 * A Cursor profile is an `AgentInstanceConfig` with `driver: "cursor"`; its
 * opaque `config` carries this schema. It says where the profile's threads run:
 *
 * - `runtimeTarget: "local"` (also an absent config, so every profile saved
 *   before this format keeps working unchanged) runs the SDK agent on this
 *   machine.
 * - `runtimeTarget: "cloud"` runs a Cursor cloud agent against the project's
 *   pushed origin branch with the profile's own CURSOR_API_KEY.
 * - `autoCreatePR` asks a cloud agent to open a pull request when it finishes.
 *
 * Format compatibility: an absent `format` means 1. Any other format is kept
 * verbatim and reported as unsupported, so the profile stays disabled instead
 * of a newer config being misread by this build. Unknown keys are retained.
 */
export const CURSOR_PROFILE_CONFIG_FORMAT = 1;

export const cursorProfileRuntimeTargetSchema = z.enum(["local", "cloud"]);
export type CursorProfileRuntimeTarget = z.infer<typeof cursorProfileRuntimeTargetSchema>;

export const cursorProfileConfigSchema = z
  .object({
    format: z.literal(CURSOR_PROFILE_CONFIG_FORMAT).optional(),
    runtimeTarget: cursorProfileRuntimeTargetSchema.optional(),
    autoCreatePR: z.boolean().optional(),
  })
  .passthrough();
export type CursorProfileConfig = z.infer<typeof cursorProfileConfigSchema>;

export type CursorProfileConfigParseResult =
  | { status: "ok"; config: CursorProfileConfig; runtimeTarget: CursorProfileRuntimeTarget }
  | { status: "unsupported-format"; reason: string }
  | { status: "invalid"; reason: string };

/** Parse a persisted `AgentInstanceConfig.config`; absent means a local profile. */
export function parseCursorProfileConfig(value: unknown): CursorProfileConfigParseResult {
  const format =
    value !== null && typeof value === "object"
      ? (value as { format?: unknown }).format
      : undefined;
  if (format !== undefined && format !== CURSOR_PROFILE_CONFIG_FORMAT) {
    return {
      status: "unsupported-format",
      reason: `Unknown Cursor profile config format ${String(format)}; the stored settings are kept but this profile stays disabled until ViscosityCode learns that format.`,
    };
  }
  const parsed = cursorProfileConfigSchema.safeParse(value ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "invalid",
      reason: issue
        ? `Invalid Cursor profile config at "${issue.path.join(".")}": ${issue.message}`
        : "Invalid Cursor profile config.",
    };
  }
  return {
    status: "ok",
    config: parsed.data,
    runtimeTarget: parsed.data.runtimeTarget ?? "local",
  };
}

/** `AgentProfileDriver.validateConfig` hook: throws on a config this build cannot use. */
export function validateCursorProfileConfig(value: unknown): void {
  const result = parseCursorProfileConfig(value);
  if (result.status !== "ok") throw new Error(result.reason);
}
