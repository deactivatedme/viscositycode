/**
 * ViscosityCode: adds bots and ready models to a composer's `@` mention list,
 * through upstream's plain-text crew-mention items (no new mention entry type).
 * Returns the base crew items untouched outside the desktop shell.
 */
import { useLingui } from "@lingui/react/macro";
import type { CrewMentionItem } from "@/renderer/components/composer/MentionInput";
import { useBots } from "../../bots/api";
import { useReadyAgentBrains } from "../api";
import { useRoundtableChatAvailable } from "./availability";
import { buildRoundtableMentionTargets, type RoundtableMentionTarget } from "./mentions";

const EMPTY_TARGETS: readonly RoundtableMentionTarget[] = [];

export interface RoundtableMentionItems {
  /** Crew items plus one item per bot / ready model. */
  items: readonly CrewMentionItem[];
  /** What the submit path matches `@<label>` text against. */
  targets: readonly RoundtableMentionTarget[];
}

export function useRoundtableMentionItems(
  projectId: string | undefined,
  crewItems: readonly CrewMentionItem[],
  options: { enabled?: boolean } = {},
): RoundtableMentionItems {
  const { t } = useLingui();
  const available = useRoundtableChatAvailable();
  const brains = useReadyAgentBrains(projectId);
  const bots = useBots();
  if (!available || options.enabled === false || !projectId) {
    return { items: crewItems, targets: EMPTY_TARGETS };
  }
  // A crew role keeps its name; a bot or model with the same label is not offered.
  const crewLabels = new Set(crewItems.map((item) => item.label.toLowerCase()));
  const targets = buildRoundtableMentionTargets(brains, bots).filter(
    (target) => !crewLabels.has(target.label.toLowerCase()),
  );
  if (targets.length === 0) return { items: crewItems, targets: EMPTY_TARGETS };
  return {
    items: [
      ...crewItems,
      ...targets.map((target) => ({
        label: target.label,
        detail: target.kind === "bot" ? t`Bot · Roundtable` : t`Invite to Roundtable`,
      })),
    ],
    targets,
  };
}
