//! Compatibility constants shared with the TypeScript host. Keep in step with
//! `src/shared/viscosity/liveRe.ts` (a test there reads this file).

/// Tool contract (names, arguments, result shapes) and the `--environment`
/// report. Mirrors `LIVE_RE_PROTOCOL_VERSION`.
pub const TOOLS_PROTOCOL_VERSION: u64 = 1;

/// Shape of the `--environment` JSON. Mirrors `LIVE_RE_ENVIRONMENT_VERSION`.
pub const ENVIRONMENT_VERSION: u64 = 1;

/// The host sets this to the protocol it speaks; a mismatch exits non-zero
/// before MCP starts (fail closed). Mirrors `LIVE_RE_PROTOCOL_ENV`.
pub const PROTOCOL_ENV: &str = "VISCOSITY_LIVE_RE_PROTOCOL";
