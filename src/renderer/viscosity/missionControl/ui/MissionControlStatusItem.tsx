/**
 * ViscosityCode Mission Control: status bar item "N need you" (fork of
 * Poracode). Shown while at least one thread or Roundtable waits for an
 * approval or an answer; pressing it opens Mission Control on "Needs you".
 * It re-renders on status changes only, never on streaming text.
 */
import { Button, Tooltip } from "@heroui/react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Radar } from "lucide-react";
import { MISSION_AGENTS_TAB_ID, openMissionControl } from "../missionControlViewStore";
import { useNeedsYouCount } from "../missionSources";

export const MISSION_CONTROL_STATUS_ITEM_ID = "mission-control";

const ITEM_CLASS = "vc-statusbar__item h-full min-w-0 shrink-0 gap-1 rounded-none px-2 font-normal";

export function MissionControlStatusItem() {
  const { t } = useLingui();
  const count = useNeedsYouCount();
  if (count === 0) return null;
  const text = t`${plural(count, { one: "# needs you", other: "# need you" })}`;
  const label = t`Open Mission Control: ${text}`;
  return (
    <Tooltip delay={400}>
      <Tooltip.Trigger>
        <Button
          size="sm"
          variant="ghost"
          aria-label={label}
          data-vc-status-item={MISSION_CONTROL_STATUS_ITEM_ID}
          data-tone="attention"
          className={ITEM_CLASS}
          onPress={() => openMissionControl({ filter: "needs", tabId: MISSION_AGENTS_TAB_ID })}
        >
          <Radar aria-hidden="true" className="size-3 shrink-0" />
          <span className="tabular-nums">{text}</span>
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="top">{label}</Tooltip.Content>
    </Tooltip>
  );
}
