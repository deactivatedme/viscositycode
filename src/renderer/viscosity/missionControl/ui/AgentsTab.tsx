/**
 * ViscosityCode Mission Control: the built-in "Agents" tab (fork of
 * Poracode). A card for every active or recently finished thread (all
 * projects), every live Roundtable and every bot with a chat, waits for the
 * user first. Filters: All / Needs you / Working / Errors / Done (remembered
 * per viewer). The grid is one tab stop (each card's title button); arrow
 * keys, Home and End move between cards and Enter opens one.
 */
import { type KeyboardEvent, useRef, useState } from "react";
import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Radar } from "lucide-react";
import { useAccountLabelResolver } from "@/renderer/viscosity/accountPools/poolHooks";
import { countGridColumns, nextGridIndex } from "../missionGridNav";
import { missionFilterLabel } from "../missionLabels";
import {
  cardMatchesFilter,
  countMissionFilters,
  isMissionFilter,
  MISSION_FILTERS,
  type MissionCard,
  type MissionFilter,
} from "../missionModel";
import { type MissionPoolLookup, useMissionPoolViews } from "../missionPools";
import { useMissionCards } from "../missionSources";
import { setMissionControlFilter, useMissionControlViewStore } from "../missionControlViewStore";
import { MissionCardView } from "./MissionCardView";
import "./missionControl.css";

const FOCUS_SELECTOR = "[data-vc-mc-focus]";

function EmptyBoard(props: { filter: MissionFilter; total: number }) {
  const { t } = useLingui();
  let title: string;
  let hint: string;
  if (props.total === 0) {
    title = t`No agents running`;
    hint = t`Threads, Roundtables and bots show here while they work, wait for you or just finished.`;
  } else {
    switch (props.filter) {
      case "needs":
        title = t`Nothing needs you`;
        hint = t`Approvals and questions from your agents show here.`;
        break;
      case "working":
        title = t`No agents working`;
        hint = t`Agents in the middle of a turn show here.`;
        break;
      case "errors":
        title = t`No errors`;
        hint = t`Agents that stopped with an error show here.`;
        break;
      default:
        title = t`Nothing finished recently`;
        hint = t`Work that finished in the last two hours shows here.`;
    }
  }
  return (
    <div className="vc-mc-empty" role="status">
      <Radar aria-hidden="true" className="size-6" />
      <p className="vc-mc-empty__title">{title}</p>
      <p className="max-w-96">{hint}</p>
    </div>
  );
}

function MissionGrid(props: {
  cards: readonly MissionCard[];
  pools: MissionPoolLookup;
  agentLabel: (agentKind: string) => string;
}) {
  const { t } = useLingui();
  const listRef = useRef<HTMLUListElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tabStopKey = props.cards.some((card) => card.key === focusKey)
    ? focusKey
    : (props.cards[0]?.key ?? null);

  function onNavigate(event: KeyboardEvent<HTMLButtonElement>) {
    const targets = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(FOCUS_SELECTOR) ?? [],
    );
    const index = targets.indexOf(event.currentTarget);
    if (index < 0) return;
    const columns = countGridColumns(targets.map((target) => target.getBoundingClientRect().top));
    const next = nextGridIndex(event.key, index, targets.length, columns);
    if (next === null) return;
    event.preventDefault();
    const target = targets[next]!;
    setFocusKey(target.getAttribute("data-vc-mc-focus"));
    target.focus();
  }

  return (
    <ul ref={listRef} className="vc-mc-grid" aria-label={t`Agents`} data-vc-mc-grid="">
      {props.cards.map((card) => (
        <MissionCardView
          key={card.key}
          card={card}
          pools={props.pools}
          agentLabel={props.agentLabel}
          isTabStop={card.key === tabStopKey}
          onFocusCard={setFocusKey}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

export function AgentsTab() {
  const { t, i18n } = useLingui();
  const cards = useMissionCards();
  const filter = useMissionControlViewStore((state) => state.filter);
  const pools = useMissionPoolViews();
  const agentLabel = useAccountLabelResolver();
  const counts = countMissionFilters(cards);
  const visible = cards.filter((card) => cardMatchesFilter(card, filter));

  return (
    <div className="vc-mc-agents" data-vc-mc-agents="">
      <div className="vc-mc-agents__toolbar">
        <ToggleButtonGroup
          aria-label={t`Show agents`}
          selectionMode="single"
          disallowEmptySelection
          size="sm"
          selectedKeys={[filter]}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (isMissionFilter(next)) setMissionControlFilter(next);
          }}
        >
          {MISSION_FILTERS.map((option) => (
            <ToggleButton key={option} id={option} data-vc-mc-filter={option}>
              {missionFilterLabel(option, i18n)}
              <span
                className="vc-mc-filter__count"
                data-tone={option === "needs" && counts.needs > 0 ? "attention" : undefined}
              >
                {counts[option]}
              </span>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      {visible.length === 0 ? (
        <EmptyBoard filter={filter} total={cards.length} />
      ) : (
        <MissionGrid cards={visible} pools={pools} agentLabel={agentLabel} />
      )}
    </div>
  );
}
