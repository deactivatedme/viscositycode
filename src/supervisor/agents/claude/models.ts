// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import {
  claudeDefaultHiddenModels,
  formatClaudeModelLabel,
  isClaudeAutoCapable,
  parseClaudeModel,
  sortClaudeModels,
  CLAUDE_FABLE_52_MODEL_ID,
  CLAUDE_OPUS_55_MODEL_ID,
  CLAUDE_SONNET_55_MODEL_ID,
  CLAUDE_FABLE_51_MODEL_ID,
  CLAUDE_FABLE_5_MODEL_ID,
  CLAUDE_OPUS_5_MODEL_ID,
  CLAUDE_OPUS_48_MODEL_ID,
  CLAUDE_OPUS_47_MODEL_ID,
  CLAUDE_OPUS_46_MODEL_ID,
  CLAUDE_SONNET_5_MODEL_ID,
  CLAUDE_HAIKU_MODEL_ID,
} from "@/shared/agents/claudeModels";
import { CLAUDE_EFFORT_TIERS } from "@/shared/agents/claudeEfforts";
import type { AgentCapability } from "@/shared/contracts";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { claudeContextManagedModelId, CLAUDE_LONG_CONTEXT_SIZES } from "./contextWindow";

export {
  claudeDefaultHiddenModels,
  formatClaudeModelLabel,
  isClaudeAutoCapable,
  parseClaudeModel,
  sortClaudeModels,
  CLAUDE_FABLE_52_MODEL_ID,
  CLAUDE_OPUS_55_MODEL_ID,
  CLAUDE_SONNET_55_MODEL_ID,
  CLAUDE_FABLE_51_MODEL_ID,
  CLAUDE_FABLE_5_MODEL_ID,
  CLAUDE_OPUS_5_MODEL_ID,
  CLAUDE_OPUS_48_MODEL_ID,
  CLAUDE_OPUS_47_MODEL_ID,
  CLAUDE_OPUS_46_MODEL_ID,
  CLAUDE_SONNET_5_MODEL_ID,
  CLAUDE_HAIKU_MODEL_ID,
};

const MIN_CLAUDE_OPUS_47_CLI = [2, 1, 111] as const;
const MIN_CLAUDE_OPUS_48_CLI = [2, 1, 154] as const;
const MIN_CLAUDE_FABLE_5_CLI = [2, 1, 170] as const;
const MIN_CLAUDE_SONNET_5_CLI = [2, 1, 197] as const;
const MIN_CLAUDE_OPUS_5_CLI = [2, 1, 219] as const;
const MIN_CLAUDE_FABLE_51_CLI = [2, 1, 250] as const;
// ViscosityCode: oldest local CLI verified to ship Fable 5.2, Opus 5.5 and Sonnet 5.5.
const MIN_CLAUDE_GEN_55_CLI = [2, 1, 325] as const;
const CLAUDE_GEN_55_MODEL_IDS = [
  CLAUDE_FABLE_52_MODEL_ID,
  CLAUDE_OPUS_55_MODEL_ID,
  CLAUDE_SONNET_55_MODEL_ID,
] as const;

const CLAUDE_SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

/** Effort choices Poracode exposes for Claude's current frontier models. */
export const CLAUDE_PREMIUM_EFFORT_TIERS: string[] = [...CLAUDE_EFFORT_TIERS];

/**
 * Built-in catalog of explicit Claude Code model ids.
 *
 * Order is significant: the first model is Poracode's default for new Claude
 * threads and delegated runs.
 */
export const CLAUDE_BUILTIN_MODELS: AgentCapability["models"] = [
  // ViscosityCode: 5.5 generation; Fable 5.2 first, so it is the default.
  { id: CLAUDE_FABLE_52_MODEL_ID, label: "Fable 5.2" },
  { id: CLAUDE_OPUS_55_MODEL_ID, label: "Opus 5.5" },
  { id: CLAUDE_SONNET_55_MODEL_ID, label: "Sonnet 5.5" },
  { id: CLAUDE_FABLE_51_MODEL_ID, label: "Fable 5.1" },
  { id: CLAUDE_FABLE_5_MODEL_ID, label: "Fable 5" },
  { id: CLAUDE_OPUS_5_MODEL_ID, label: "Opus 5" },
  { id: CLAUDE_OPUS_48_MODEL_ID, label: "Opus 4.8" },
  { id: CLAUDE_OPUS_47_MODEL_ID, label: "Opus 4.7" },
  { id: CLAUDE_OPUS_46_MODEL_ID, label: "Opus 4.6" },
  { id: CLAUDE_SONNET_5_MODEL_ID, label: "Sonnet 5" },
  { id: CLAUDE_HAIKU_MODEL_ID, label: "Haiku" },
];

export const CLAUDE_BUILTIN_MODEL_EFFORTS: AgentCapability["modelEfforts"] = {
  // ViscosityCode: 5.5 generation.
  [CLAUDE_FABLE_52_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  [CLAUDE_OPUS_55_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  [CLAUDE_SONNET_55_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  [CLAUDE_FABLE_51_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  [CLAUDE_FABLE_5_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  [CLAUDE_OPUS_5_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  [CLAUDE_OPUS_48_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  [CLAUDE_OPUS_47_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  [CLAUDE_OPUS_46_MODEL_ID]: ["low", "medium", "high", "max"],
  [CLAUDE_SONNET_5_MODEL_ID]: CLAUDE_PREMIUM_EFFORT_TIERS,
  haiku: [],
};

export const CLAUDE_BUILTIN_MODEL_CONTEXT_SIZES: NonNullable<AgentCapability["modelContextSizes"]> =
  {
    // ViscosityCode: 5.5 generation.
    [CLAUDE_FABLE_52_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_OPUS_55_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_SONNET_55_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_FABLE_51_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_FABLE_5_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_OPUS_5_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_OPUS_48_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_OPUS_47_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_OPUS_46_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    [CLAUDE_SONNET_5_MODEL_ID]: CLAUDE_LONG_CONTEXT_SIZES,
    // Legacy `sonnet` alias retained for backward compatibility.
    sonnet: CLAUDE_LONG_CONTEXT_SIZES,
  };

export const CLAUDE_BUILTIN_FAST_MODELS: NonNullable<AgentCapability["fastModels"]> = [
  // ViscosityCode: the 2.1.329 SDK reports supportsFastMode for both.
  CLAUDE_FABLE_52_MODEL_ID,
  CLAUDE_OPUS_55_MODEL_ID,
  CLAUDE_OPUS_5_MODEL_ID,
  CLAUDE_OPUS_48_MODEL_ID,
  CLAUDE_OPUS_47_MODEL_ID,
  CLAUDE_OPUS_46_MODEL_ID,
];

/** Claude Code's ultracode workflow mode needs a model with xhigh effort. */
export function claudeWorkflowModels(
  modelEfforts: AgentCapability["modelEfforts"],
): NonNullable<AgentCapability["workflowModels"]> {
  return Object.entries(modelEfforts)
    .filter(([, efforts]) => efforts.includes("xHigh"))
    .map(([modelId]) => modelId);
}

export const CLAUDE_BUILTIN_WORKFLOW_MODELS = claudeWorkflowModels(CLAUDE_BUILTIN_MODEL_EFFORTS);

function parseSemverTriplet(version: string): [number, number, number] | null {
  const match = CLAUDE_SEMVER_RE.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function semverGte(
  actual: [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  if (actual[0] !== minimum[0]) return actual[0] > minimum[0];
  if (actual[1] !== minimum[1]) return actual[1] > minimum[1];
  return actual[2] >= minimum[2];
}

/** Built-in model ids the installed Claude Code predates (empty when the version is unknown). */
function claudeCliHiddenModelIds(version: string | undefined): Set<string> {
  const hiddenModelIds = new Set<string>();
  const triplet = version ? parseSemverTriplet(version) : null;
  if (!triplet) return hiddenModelIds;
  // ViscosityCode: hide the 5.5 generation on CLIs that predate it.
  if (!semverGte(triplet, MIN_CLAUDE_GEN_55_CLI)) {
    for (const modelId of CLAUDE_GEN_55_MODEL_IDS) hiddenModelIds.add(modelId);
  }
  if (!semverGte(triplet, MIN_CLAUDE_OPUS_5_CLI)) {
    hiddenModelIds.add(CLAUDE_OPUS_5_MODEL_ID);
  }
  if (!semverGte(triplet, MIN_CLAUDE_FABLE_5_CLI)) {
    hiddenModelIds.add(CLAUDE_FABLE_5_MODEL_ID);
  }
  if (!semverGte(triplet, MIN_CLAUDE_FABLE_51_CLI)) {
    hiddenModelIds.add(CLAUDE_FABLE_51_MODEL_ID);
  }
  if (!semverGte(triplet, MIN_CLAUDE_SONNET_5_CLI)) {
    hiddenModelIds.add(CLAUDE_SONNET_5_MODEL_ID);
  }
  if (!semverGte(triplet, MIN_CLAUDE_OPUS_48_CLI)) {
    hiddenModelIds.add(CLAUDE_OPUS_48_MODEL_ID);
  }
  if (!semverGte(triplet, MIN_CLAUDE_OPUS_47_CLI)) {
    hiddenModelIds.add(CLAUDE_OPUS_47_MODEL_ID);
  }
  return hiddenModelIds;
}

/** Hide model releases when the installed Claude Code predates their first catalog entry. */
export function claudeCapabilitiesFromCliVersion(
  version: string | undefined,
): Partial<AgentCapability> | undefined {
  const hiddenModelIds = claudeCliHiddenModelIds(version);
  if (hiddenModelIds.size === 0) return undefined;

  const models = CLAUDE_BUILTIN_MODELS.filter((model) => !hiddenModelIds.has(model.id));
  const defaultHiddenModels = claudeDefaultHiddenModels(models);
  const modelEfforts = { ...CLAUDE_BUILTIN_MODEL_EFFORTS };
  const modelContextSizes = { ...CLAUDE_BUILTIN_MODEL_CONTEXT_SIZES };
  for (const modelId of hiddenModelIds) {
    delete modelEfforts[modelId];
    delete modelContextSizes[modelId];
  }
  const fastModels = CLAUDE_BUILTIN_FAST_MODELS.filter((modelId) => !hiddenModelIds.has(modelId));
  return {
    models,
    defaultHiddenModels,
    modelEfforts,
    modelContextSizes,
    fastModels,
    workflowModels: claudeWorkflowModels(modelEfforts),
  };
}

function poracodeEffortId(effort: string): string {
  return effort === "xhigh" ? "xHigh" : effort;
}

/**
 * Dynamic model discovery and capability overlay reported by Claude Code SDK.
 *
 * Preserves built-in prior model versions while dynamically discovering new
 * model releases (e.g. Fable 5.2, Opus 5.1), assigning clean labels, placing them
 * in the proper family/version order, and updating effort and fast metadata.
 */
export function claudeCapabilitiesFromSdkModels(
  sdkModels: readonly ModelInfo[] | undefined,
  cliVersion?: string,
):
  | Pick<
      AgentCapability,
      | "models"
      | "defaultHiddenModels"
      | "modelEfforts"
      | "modelContextSizes"
      | "fastModels"
      | "workflowModels"
    >
  | undefined {
  if (!sdkModels?.length) return undefined;

  // ViscosityCode: seed only built-ins the installed CLI is known to run; the SDK
  // loop below re-adds any gated id the SDK itself reports.
  const unverified = claudeCliHiddenModelIds(cliVersion);
  const modelsMap = new Map<string, { id: string; label: string }>();
  for (const model of CLAUDE_BUILTIN_MODELS) {
    if (!unverified.has(model.id)) modelsMap.set(model.id, { ...model });
  }

  const modelEfforts: Record<string, string[]> = { ...CLAUDE_BUILTIN_MODEL_EFFORTS };
  const modelContextSizes: Record<string, string[]> = { ...CLAUDE_BUILTIN_MODEL_CONTEXT_SIZES };
  for (const modelId of unverified) {
    delete modelEfforts[modelId];
    delete modelContextSizes[modelId];
  }
  const fastModels = new Set(CLAUDE_BUILTIN_FAST_MODELS.filter((id) => !unverified.has(id)));
  let matched = false;

  // Keep the built-in selectable alias when the SDK resolves it to a native
  // Haiku release. External profile targets must retain their own identities.
  const aliasTargets = new Map<string, string>();
  for (const model of sdkModels) {
    const rawResolved = model.resolvedModel?.trim();
    const resolved = rawResolved
      ? (claudeContextManagedModelId(rawResolved) ?? rawResolved)
      : undefined;
    if (model.value === CLAUDE_HAIKU_MODEL_ID && resolved && resolved.startsWith("claude-haiku-")) {
      aliasTargets.set(resolved, CLAUDE_HAIKU_MODEL_ID);
    }
  }

  for (const sdkModel of sdkModels) {
    const rawId = sdkModel.resolvedModel || sdkModel.value;
    if (!rawId) continue;
    const resolvedId = claudeContextManagedModelId(rawId.trim()) ?? rawId.trim();
    const modelId = aliasTargets.get(resolvedId) ?? resolvedId;
    if (!modelId || modelId === "default" || modelId === "auto") continue;
    matched = true;

    if (!modelsMap.has(modelId)) {
      const label = formatClaudeModelLabel(
        modelId,
        sdkModel.value === "default" ? undefined : sdkModel.displayName,
      );
      modelsMap.set(modelId, { id: modelId, label });
    } else if (modelId !== resolvedId && sdkModel.displayName?.trim()) {
      // ViscosityCode: label the haiku alias with the release it resolves to ("Haiku 5.5").
      modelsMap.set(modelId, {
        id: modelId,
        label: formatClaudeModelLabel(resolvedId, sdkModel.displayName),
      });
    }

    if (sdkModel.supportsEffort === false) {
      modelEfforts[modelId] = [];
    } else if (sdkModel.supportedEffortLevels?.length) {
      modelEfforts[modelId] = sdkModel.supportedEffortLevels.map(poracodeEffortId);
    } else if (!modelEfforts[modelId]) {
      modelEfforts[modelId] = [...CLAUDE_PREMIUM_EFFORT_TIERS];
    }

    if (!modelContextSizes[modelId]) {
      const nativeId = /^claude-/i.test(resolvedId) ? resolvedId : undefined;
      const parsed = nativeId ? parseClaudeModel(nativeId) : undefined;
      const supportsLongContext =
        parsed &&
        // Preserve the SDK catalog's 1M fallback for newly released families.
        (parsed.family === "other" ||
          (parsed.family === "fable" && parsed.version >= 5) ||
          (parsed.family === "opus" && parsed.version >= 4.6) ||
          (parsed.family === "sonnet" && parsed.version >= 4.6) ||
          (parsed.family === "haiku" && parsed.version >= 5.5) ||
          /\[1m\]$/i.test(rawId));
      modelContextSizes[modelId] = supportsLongContext
        ? CLAUDE_LONG_CONTEXT_SIZES
        : nativeId
          ? ["200k"]
          : ["1m"];
    }

    if (sdkModel.supportsFastMode === true) {
      fastModels.add(modelId);
    } else if (sdkModel.supportsFastMode === false) {
      fastModels.delete(modelId);
    }
  }

  if (!matched) return undefined;

  const sortedModels = sortClaudeModels([...modelsMap.values()]);
  const defaultHiddenModels = claudeDefaultHiddenModels(sortedModels);

  return {
    models: sortedModels,
    defaultHiddenModels,
    modelEfforts,
    modelContextSizes,
    fastModels: [...fastModels],
    workflowModels: claudeWorkflowModels(modelEfforts),
  };
}
