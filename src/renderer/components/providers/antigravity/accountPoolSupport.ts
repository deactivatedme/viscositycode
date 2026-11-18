/**
 * ViscosityCode: why Antigravity cannot join an account pool (fork of Poracode).
 *
 * Account pools (src/shared/accountPools.ts) only accept providers that keep
 * several accounts as profiles (AGENT_PROFILE_DRIVERS). Antigravity is not one,
 * and it cannot become one until its own CLI can keep accounts apart:
 *
 * - Chat (`agy_acp_server`) stores its Google sign-in in one fixed system
 *   keychain item (service "gemini", account "antigravity-acp") and deletes and
 *   re-adds that item every time it starts. A second account would replace the
 *   first one's sign-in. The file fallback
 *   (`~/.gemini/antigravity-acp/acp_token.json`) is used only when the keychain
 *   is unavailable, and there is no documented switch to force it.
 * - Terminal (`agy`) keeps its sign-in in the system keyring and its state
 *   under `~/.gemini/antigravity-cli`. Neither runtime documents a config-home
 *   variable such as Gemini CLI's `GEMINI_CLI_HOME` or Codex's `CODEX_HOME`.
 * - Overriding `HOME` would not move the keychain item, and it would also
 *   change `HOME` for every git, ssh and package-manager command the agent runs.
 *
 * The settings UI shows this reason wherever pools or extra accounts are
 * offered. It reaches shared UI through the provider-agnostic
 * `NativeAgentRegistryEntry.accountPoolUnavailableReason` field, never through
 * a provider-name check.
 */
import { msg } from "@lingui/core/macro";

export const antigravityAccountPoolUnavailableReason = msg({
  message: "Antigravity keeps one sign-in per computer, so it can't join an account pool yet.",
  comment:
    "Account pools settings: shown for Antigravity, which cannot hold several accounts on one computer",
});
