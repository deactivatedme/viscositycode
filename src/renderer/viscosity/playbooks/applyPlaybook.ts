/**
 * ViscosityCode: turning a playbook on or off for one chat, as a config patch.
 *
 * Pure. Reverts the MCP overrides the previous playbook switched on (unless
 * the server is on by default anyway), then writes a frozen v1 copy of the new
 * playbook and switches on the configured servers it names. It never writes a
 * server's global `enabled` flag and never touches mode, approval, sandbox or
 * bypass settings: a playbook is independent of Plan/Agent/Autopilot.
 * The name `live_re` means the app's LLDB helper, switched by its reserved
 * override id, unless a configured server already has that name.
 * A built-in browser the playbook switched on is recorded under
 * `PLAYBOOK_BROWSER_ID` in the binding's server ids, so leaving it turns it off.
 */
import type { McpServer, ThreadConfig } from "@/shared/contracts";
import { LIVE_RE_MCP_OVERRIDE_ID, LIVE_RE_MCP_SERVER_NAME } from "@/shared/viscosity/liveRe";
import {
  playbookBindingFromSaved,
  threadPlaybookBinding,
  type SavedPlaybook,
} from "@/shared/viscosity/playbook";

export interface PlaybookApplyContext {
  /** Global and project servers as launch merges them (`mergeMcpServers`). */
  servers: readonly Pick<McpServer, "id" | "name" | "enabled">[];
  /** The built-in browser can serve this agent and presentation. */
  browserAvailable: boolean;
  /** False when the host will drop live_re (WSL project, helper not staged). Default: available. */
  liveReAvailable?: boolean;
}

/**
 * Reserved entry in a binding's `mcpServerIds`: the playbook switched the
 * built-in browser on. Not an MCP server id; older bindings without it keep
 * the browser on when the playbook is left, as before.
 */
export const PLAYBOOK_BROWSER_ID = "viscosity.browser";

export interface PlaybookApplyResult {
  patch: Pick<ThreadConfig, "playbook" | "mcpServerOverrides" | "browserMcp">;
  /** Requested server names that are configured, in request order. */
  found: string[];
  /** Requested server names that are not configured here. */
  missing: string[];
  /** Requested host-provided servers this project or host cannot load (live_re). */
  unavailable: string[];
}

/** The host-provided LLDB helper: off unless a chat switches it on. */
const LIVE_RE_SERVER = {
  id: LIVE_RE_MCP_OVERRIDE_ID,
  name: LIVE_RE_MCP_SERVER_NAME,
  enabled: false,
} as const satisfies PlaybookApplyContext["servers"][number];

export function matchPlaybookServers(
  names: readonly string[] | undefined,
  servers: PlaybookApplyContext["servers"],
  liveReAvailable = true,
): Omit<PlaybookApplyResult, "patch"> & { matched: PlaybookApplyContext["servers"] } {
  const matched: PlaybookApplyContext["servers"][number][] = [];
  const found: string[] = [];
  const missing: string[] = [];
  const unavailable: string[] = [];
  // Configured servers come first, so one named live_re wins over the helper.
  const candidates = [...servers, LIVE_RE_SERVER];
  for (const name of names ?? []) {
    const server = candidates.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!server) {
      missing.push(name);
      continue;
    }
    if (server === LIVE_RE_SERVER && !liveReAvailable) {
      if (!unavailable.includes(server.name)) unavailable.push(server.name);
      continue;
    }
    if (!matched.includes(server)) matched.push(server);
    found.push(server.name);
  }
  return { matched, found, missing, unavailable };
}

export function applyPlaybook(
  config: ThreadConfig,
  playbook: SavedPlaybook | null,
  context: PlaybookApplyContext,
): PlaybookApplyResult {
  const overrides: Record<string, boolean> = { ...config.mcpServerOverrides };
  const previousIds = threadPlaybookBinding(config)?.mcpServerIds ?? [];
  for (const id of previousIds) {
    const onByDefault = context.servers.find((server) => server.id === id)?.enabled === true;
    if (overrides[id] === true && !onByDefault) delete overrides[id];
  }
  const { matched, found, missing, unavailable } = matchPlaybookServers(
    playbook?.mcp,
    context.servers,
    context.liveReAvailable,
  );
  const switchedOn: string[] = [];
  if (playbook) {
    for (const server of matched) {
      if ((overrides[server.id] ?? server.enabled) === true) continue;
      overrides[server.id] = true;
      switchedOn.push(server.id);
    }
  }
  const browserWasOurs = previousIds.includes(PLAYBOOK_BROWSER_ID);
  const wantsBrowser = playbook?.browserMcp === true && context.browserAvailable;
  // The browser stays the playbook's while a playbook that wants it replaces one that turned it on.
  if (wantsBrowser && (config.browserMcp !== true || browserWasOurs)) {
    switchedOn.push(PLAYBOOK_BROWSER_ID);
  }
  const browserPatch =
    wantsBrowser && config.browserMcp !== true
      ? { browserMcp: true }
      : !wantsBrowser && browserWasOurs && config.browserMcp === true
        ? { browserMcp: false }
        : {};
  const changedOverrides =
    JSON.stringify(overrides) !== JSON.stringify(config.mcpServerOverrides ?? {});
  return {
    patch: {
      playbook: playbook ? playbookBindingFromSaved(playbook, switchedOn) : null,
      // An explicit map (even empty): an absent one would keep the old overrides.
      ...(changedOverrides ? { mcpServerOverrides: overrides } : {}),
      ...browserPatch,
    },
    found,
    missing,
    unavailable,
  };
}

/**
 * Carry the source chat's playbook into a provider switch. Custom servers are
 * not provider-specific, so the ids it switched on stay on for the target.
 */
export function withCarriedPlaybook(source: ThreadConfig, target: ThreadConfig): ThreadConfig {
  const binding = threadPlaybookBinding(source);
  if (!binding || target.playbook !== undefined) return target;
  const ids = (binding.mcpServerIds ?? []).filter((id) => id !== PLAYBOOK_BROWSER_ID);
  return {
    ...target,
    playbook: binding,
    ...(ids.length > 0
      ? {
          mcpServerOverrides: {
            ...target.mcpServerOverrides,
            ...Object.fromEntries(ids.map((id) => [id, true])),
          },
        }
      : {}),
  };
}

/**
 * A chat's copy differs from the current catalog entry (text, tools aside, or look).
 * `localized`: the entry is an unedited built-in whose label and description follow
 * the app language, so a language change alone must not count as an update.
 */
export function isPlaybookOutdated(
  config: ThreadConfig,
  latest: SavedPlaybook,
  localized = false,
): boolean {
  const binding = threadPlaybookBinding(config);
  if (!binding || binding.id !== latest.id) return false;
  const { mcpServerIds: _ids, ...current } = binding;
  const { mcpServerIds: _fresh, ...fresh } = playbookBindingFromSaved(latest);
  return (
    JSON.stringify(comparable(current, localized)) !== JSON.stringify(comparable(fresh, localized))
  );
}

function comparable(value: object, localized: boolean): [string, unknown][] {
  // shortcut: a renamed built-in label alone offers no update; instructions, tools and look still do.
  return sorted(value).filter(([key]) => !localized || (key !== "label" && key !== "description"));
}

function sorted(value: object): [string, unknown][] {
  return Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1));
}

/**
 * A draft keeps its playbook, and the server switches it made, beside the
 * provider draft config (which only holds the model selection), the way it
 * keeps a crew. These fields reach the launch config and the project draft.
 * The browser is not one of them: it goes through the draft's `@browser`
 * mention flag, so removing the browser chip still turns it off.
 */
export type DraftPlaybookFields = Pick<ThreadConfig, "playbook" | "mcpServerOverrides">;

/** The restorable part of a saved project draft: the playbook and its server switches. */
export function draftPlaybookFields(
  config: Pick<ThreadConfig, "playbook" | "mcpServerOverrides"> | undefined,
): DraftPlaybookFields {
  if (config?.playbook === undefined) return {};
  return {
    playbook: config.playbook,
    ...(config.mcpServerOverrides ? { mcpServerOverrides: config.mcpServerOverrides } : {}),
  };
}

/** Split a composer patch into the draft's playbook fields (when it sets a playbook) and the rest. */
export function splitDraftPlaybookPatch(
  current: DraftPlaybookFields,
  patch: Partial<ThreadConfig>,
): { fields?: DraftPlaybookFields; rest: Partial<ThreadConfig> } {
  if (patch.playbook === undefined) return { rest: patch };
  const { playbook, mcpServerOverrides, ...rest } = patch;
  const overrides = mcpServerOverrides ?? current.mcpServerOverrides;
  return {
    fields: { playbook, ...(overrides ? { mcpServerOverrides: overrides } : {}) },
    rest,
  };
}
