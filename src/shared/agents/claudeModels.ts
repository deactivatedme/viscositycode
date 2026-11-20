// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { LabeledOption } from "@/shared/contracts";

// ViscosityCode: the 5.5 generation (Fable 5.2, Opus 5.5, Sonnet 5.5).
export const CLAUDE_FABLE_52_MODEL_ID = "claude-fable-5-2";
export const CLAUDE_OPUS_55_MODEL_ID = "claude-opus-5-5";
export const CLAUDE_SONNET_55_MODEL_ID = "claude-sonnet-5-5";
export const CLAUDE_FABLE_51_MODEL_ID = "claude-fable-5-1";
export const CLAUDE_FABLE_5_MODEL_ID = "claude-fable-5";
export const CLAUDE_OPUS_5_MODEL_ID = "claude-opus-5";
export const CLAUDE_OPUS_48_MODEL_ID = "claude-opus-4-8";
export const CLAUDE_OPUS_47_MODEL_ID = "claude-opus-4-7";
export const CLAUDE_OPUS_46_MODEL_ID = "claude-opus-4-6";
export const CLAUDE_SONNET_5_MODEL_ID = "claude-sonnet-5";
export const CLAUDE_HAIKU_MODEL_ID = "haiku";

export type ClaudeFamily = "fable" | "opus" | "sonnet" | "haiku" | "other";

export interface ParsedClaudeModel {
  family: ClaudeFamily;
  version: number;
  major: number;
  minor: number;
}

export function parseClaudeModelFamily(text: string): ClaudeFamily {
  const norm = text.toLowerCase();
  if (/\bfable\b/i.test(norm) || norm.includes("fable")) return "fable";
  if (/\bopus\b/i.test(norm) || norm.includes("opus")) return "opus";
  if (/\bsonnet\b/i.test(norm) || norm.includes("sonnet")) return "sonnet";
  if (/\bhaiku\b/i.test(norm) || norm.includes("haiku")) return "haiku";
  return "other";
}

export function parseClaudeModelVersion(text: string): {
  version: number;
  major: number;
  minor: number;
} {
  const norm = text.toLowerCase();

  // Dotted version e.g. "5.1", "5.2", "4.8", "3.7"
  const dottedMatch = /(?:^|\b|[a-z]-)(\d+)\.(\d+)(?:\b|$)/i.exec(norm);
  if (dottedMatch) {
    const major = Number(dottedMatch[1]);
    const minor = Number(dottedMatch[2]);
    return { version: Number(`${major}.${minor}`), major, minor };
  }

  // Hyphenated version e.g. "claude-fable-5-1" -> 5.1, "claude-opus-4-8" -> 4.8. The minor is
  // 1-2 digits so a snapshot date ("claude-opus-4-20250514") falls through to the single version.
  const hyphenMatch = /(?:fable|opus|sonnet|haiku)-(\d+)-(\d{1,2})(?!\d)/i.exec(norm);
  if (hyphenMatch) {
    const major = Number(hyphenMatch[1]);
    const minor = Number(hyphenMatch[2]);
    return { version: Number(`${major}.${minor}`), major, minor };
  }

  // Hyphenated single version e.g. "claude-fable-5" -> 5.0, "claude-opus-5" -> 5.0
  const hyphenSingleMatch = /(?:fable|opus|sonnet|haiku)-(\d+)(?![\d])/i.exec(norm);
  if (hyphenSingleMatch) {
    const major = Number(hyphenSingleMatch[1]);
    return { version: major, major, minor: 0 };
  }

  // Spaced version e.g. "Fable 5", "Opus 5" -> 5.0
  const spacedMatch = /(?:fable|opus|sonnet|haiku)\s+(\d+)(?!\d)/i.exec(norm);
  if (spacedMatch) {
    const major = Number(spacedMatch[1]);
    return { version: major, major, minor: 0 };
  }

  return { version: 0, major: 0, minor: 0 };
}

export function parseClaudeModel(idOrLabel: string): ParsedClaudeModel {
  const family = parseClaudeModelFamily(idOrLabel);
  const { version, major, minor } = parseClaudeModelVersion(idOrLabel);
  return { family, version, major, minor };
}

export function formatClaudeModelLabel(id: string, displayName?: string): string {
  if (displayName?.trim()) {
    const cleaned = displayName
      .replace(/^(?:Claude|Anthropic)\s+/i, "")
      .replace(/\s*\(.*?\)\s*/g, " ")
      .trim();
    if (cleaned) return cleaned;
  }
  const parsed = parseClaudeModel(id);
  const familyCap =
    parsed.family === "fable"
      ? "Fable"
      : parsed.family === "opus"
        ? "Opus"
        : parsed.family === "sonnet"
          ? "Sonnet"
          : parsed.family === "haiku"
            ? "Haiku"
            : id;
  if (parsed.version > 0) {
    return `${familyCap} ${parsed.version}`;
  }
  return familyCap;
}

/**
 * Checks whether a Claude model supports Auto approval mode.
 * Auto approval mode is supported for:
 * - Default model (empty / undefined)
 * - Fable >= 5.0
 * - Opus >= 4.6
 * - Sonnet >= 4.6 (and bare `sonnet` legacy alias)
 * - Any future non-Haiku / 5.x+ model
 * Filtered out for Haiku and legacy <4.6 models.
 */
export function isClaudeAutoCapable(modelId?: string): boolean {
  if (!modelId?.trim()) return true;
  const parsed = parseClaudeModel(modelId);
  if (parsed.family === "haiku") return false;
  if (parsed.family === "fable") {
    return parsed.version === 0 || parsed.version >= 5.0;
  }
  if (parsed.family === "opus") {
    return parsed.version === 0 || parsed.version >= 4.6;
  }
  if (parsed.family === "sonnet") {
    return parsed.version === 0 || parsed.version >= 4.6;
  }
  // For unknown future families or generic IDs, default to capable unless version is < 4.6
  return parsed.version === 0 || parsed.version >= 4.6;
}

/**
 * ViscosityCode: family and version used for ordering. A version-less alias
 * (`haiku`) takes its version from the label the SDK gave it ("Haiku 5.5").
 */
export function claudeModelRank(model: Pick<LabeledOption, "id" | "label">): ParsedClaudeModel {
  const parsed = parseClaudeModel(model.id || model.label);
  if (parsed.version > 0 || !model.label) return parsed;
  return { ...parsed, ...parseClaudeModelVersion(model.label) };
}

/**
 * ViscosityCode: hide a model by default when a newer version of the same named
 * family is in the list, so only the newest Fable/Opus/Sonnet/Haiku shows until
 * the user expands the picker. Third-party ("other") models are never hidden.
 * Relative rather than fixed thresholds, so it does not go stale each release.
 */
export function claudeDefaultHiddenModels(
  models: readonly Pick<LabeledOption, "id" | "label">[],
): string[] {
  const ranked = models.map((model) => ({ id: model.id, ...claudeModelRank(model) }));
  const newest = new Map<ClaudeFamily, number>();
  for (const model of ranked) {
    newest.set(model.family, Math.max(newest.get(model.family) ?? 0, model.version));
  }
  return ranked
    .filter((model) => model.family !== "other" && model.version < newest.get(model.family)!)
    .map((model) => model.id);
}

const CLAUDE_FAMILY_PRECEDENCE: Record<ClaudeFamily, number> = {
  fable: 0,
  opus: 1,
  sonnet: 2,
  haiku: 3,
  other: 4,
};

/**
 * Sort Claude models: Fable first, then Opus, Sonnet, Haiku, then others.
 * Within each family, models are sorted by version descending (e.g. 5.2 > 5.1 > 5.0 > 4.8).
 */
export function sortClaudeModels<T extends Pick<LabeledOption, "id" | "label">>(
  models: readonly T[],
): T[] {
  return [...models].sort((a, b) => {
    const parsedA = claudeModelRank(a);
    const parsedB = claudeModelRank(b);

    const famDiff =
      CLAUDE_FAMILY_PRECEDENCE[parsedA.family] - CLAUDE_FAMILY_PRECEDENCE[parsedB.family];
    if (famDiff !== 0) return famDiff;

    // Same family: sort by version descending (e.g. 5.2 > 5.1 > 5.0 > 4.8)
    const verDiff = parsedB.version - parsedA.version;
    if (verDiff !== 0) return verDiff;

    return a.label.localeCompare(b.label);
  });
}
